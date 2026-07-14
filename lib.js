"use strict";
// Pure helpers (no vscode dependency) so they can be unit-tested with plain Node.

// 5h window reset: "1h23m" or "12m".
function fmtShort(seconds) {
  if (seconds == null || seconds < 0) return "?";
  const m = Math.floor(seconds / 60);
  const h = Math.floor(m / 60);
  const mm = m % 60;
  if (h >= 1) return mm > 0 ? `${h}h${mm}m` : `${h}h`;
  return `${mm}m`;
}

// 7d window reset: "5d" when >= 1 day, else hours & minutes.
function fmtLong(seconds) {
  if (seconds == null || seconds < 0) return "?";
  const days = Math.floor(seconds / 86400);
  if (days >= 1) return `${days}d`;
  return fmtShort(seconds);
}

// utilization header may be a 0..1 fraction or already a percentage -> percent USED
function parseUtil(v) {
  if (v == null) return null;
  const n = parseFloat(v);
  if (isNaN(n)) return null;
  return n <= 1 ? n * 100 : n;
}

// reset header is RFC3339 timestamp or epoch seconds -> seconds-from-now
function parseResetHeader(v, nowMs) {
  if (v == null) return null;
  const now = nowMs == null ? Date.now() : nowMs;
  if (/^\d+$/.test(String(v).trim())) {
    return Math.max(0, parseInt(v, 10) - Math.floor(now / 1000));
  }
  const t = Date.parse(v);
  if (isNaN(t)) return null;
  return Math.max(0, Math.floor((t - now) / 1000));
}

function accountFromJwt(idToken) {
  try {
    const payload = JSON.parse(
      Buffer.from(idToken.split(".")[1], "base64").toString("utf8")
    );
    const auth = payload["https://api.openai.com/auth"] || {};
    return auth.chatgpt_account_id || payload.account_id || null;
  } catch (_) {
    return null;
  }
}

// Emoji dot — renders in-color in ANY theme (incl. High Contrast, which suppresses
// custom status-bar text colors). remaining %: >30 green | <=30 amber | <=10 red.
function dotFor(rem) {
  if (rem == null) return "⚪";
  if (rem <= 10) return "🔴";
  if (rem <= 30) return "🟡";
  return "🟢";
}

// "on-pace" remaining % for a window that fully resets at its reset time:
// linear burn => remaining should track the fraction of the window still ahead.
function paceLine(timeLeftSec, windowSec) {
  if (!windowSec || windowSec <= 0 || timeLeftSec == null) return null;
  return Math.max(0, Math.min(100, (timeLeftSec / windowSec) * 100));
}

// 5h reveal (option 01): show when at/under the floor OR burning faster than pace.
// Markers intentionally omitted — the dot color + the appearance itself are the signal.
function reveal5h(rem, timeLeftSec, windowSec, opt) {
  if (rem == null) return true; // unknown -> show "—"
  if (rem <= opt.floor) return true;
  const line = paceLine(timeLeftSec, windowSec);
  if (line != null && rem < line - opt.fastMargin) return true; // too fast
  return false;
}

// 7d reveal (two-sided pace): too fast, OR surplus (lots left + reset soon), OR scarce.
function reveal7d(rem, timeLeftSec, windowSec, opt) {
  if (rem == null) return true;
  const line = paceLine(timeLeftSec, windowSec);
  if (line != null && rem < line - opt.fastMargin) return true; // too fast
  const frac = windowSec ? timeLeftSec / windowSec : 1;
  if (frac <= opt.soonFrac && rem >= opt.high) return true; // surplus -> use it
  if (rem <= opt.scarce) return true; // genuinely scarce
  return false;
}

// ---- tooltip (hover) ------------------------------------------------------
// VS Code kills an open status-bar hover whenever the tooltip STRING changes
// (vscode#128887: a mid-hover update dismisses the tooltip until you re-hover).
// So the tooltip must be a STABLE function of the quota state: absolute reset
// times rounded to the minute, and no live countdown ("in 1h23m") — countdowns
// churn every refresh and made the hover flash and vanish.

function resetClock(resetSec, nowMs) {
  if (resetSec == null) return null;
  const epoch = nowMs + resetSec * 1000;
  return new Date(Math.round(epoch / 60000) * 60000); // minute-rounded: absorbs API jitter
}

// 5h reset: "4:59 PM"
function clockShort(resetSec, nowMs) {
  if (resetSec != null && resetSec <= 0) return "soon"; // elapsed: constant, never now-anchored
  const d = resetClock(resetSec, nowMs);
  if (!d) return "unknown";
  return d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
}

// 7d reset: "Thu 3:00 PM"
function clockLong(resetSec, nowMs) {
  if (resetSec != null && resetSec <= 0) return "soon"; // elapsed: constant, never now-anchored
  const d = resetClock(resetSec, nowMs);
  if (!d) return "unknown";
  return d
    .toLocaleString(undefined, { weekday: "short", hour: "numeric", minute: "2-digit" })
    .replace(",", "");
}

// Additional Codex limits can report a full-window reset without ticking down in
// lockstep with the primary window. Display and gate both stay hour-granular so
// that sliding reset epochs don't look material while an untouched limit sits full.
function clockLongCoarse(resetSec, nowMs) {
  if (resetSec != null && resetSec <= 0) return "soon";
  const d = resetClock(resetSec, nowMs);
  if (!d) return "unknown";
  return d
    .toLocaleString(undefined, { weekday: "short", hour: "numeric" })
    .replace(",", "");
}

function tooltipFor(name, five, seven, nowMs) {
  return (
    `${name}\n` +
    `⏱ 5h: ${five.rem == null ? "—" : five.rem + "% left"} · resets ${clockShort(five.reset, nowMs)}\n` +
    `🗓 Weekly resets ${clockLong(seven.reset, nowMs)} (${seven.rem == null ? "—" : seven.rem + "% left"})`
  );
}

// Byte-stability above is necessary but not sufficient: VS Code (1.117.0
// statusbarItem.ts -> updatableHoverWidget.ts) DISPOSES an open hover whenever the
// tooltip string changes, and a provider under active use has genuine data churn
// (measured: Codex used_percent ticks ~1%/min), so even a jitter-proof tooltip is
// rewritten every refresh and the hover still dies mid-read. Gate rewrites on
// MATERIAL change only: reset clock rolled to a new window, error state flipped,
// or rem drifted >= driftPct from what the shown tooltip already says. Between
// commits the shown string is frozen (worst case ~driftPct-1 points stale), so an
// idle provider's hover lives forever and an active one survives ~5 min of ticks.

function remDelta(a, b) {
  if (a == null && b == null) return 0;
  if (a == null || b == null) return Infinity; // shape change ("—" <-> "N%") is material
  return Math.abs(a - b);
}

// Reset-time change detection uses minute-rounded EPOCHS, not rendered clock strings:
// when the true reset epoch sits within jitter range of an exact :30s-in-minute
// boundary, minute-rounding flips the rendered clock between adjacent minutes on
// every tick — a string compare would rewrite (and kill the hover) all window long.
// ±1 minute of movement is rounding wobble; >=2 is a real shift (rollovers jump hours).
function resetEpochMin(resetSec, nowMs) {
  if (resetSec == null) return "unknown";
  if (resetSec <= 0) return "soon"; // elapsed sentinel, matches clockShort/clockLong
  return Math.round((nowMs + resetSec * 1000) / 60000);
}

function resetEpochHour(resetSec, nowMs) {
  if (resetSec == null) return "unknown";
  if (resetSec <= 0) return "soon"; // elapsed sentinel, same as the minute gate
  return Math.round((nowMs + resetSec * 1000) / 3600000);
}

function resetMoved(a, b) {
  if (typeof a !== typeof b) return true; // epoch unit <-> "soon"/"unknown"
  if (typeof a === "string") return a !== b; // sentinel change
  return Math.abs(a - b) >= 2; // tolerate ±1 rounding wobble in the caller's unit
}

// prev: the snapshot committed with the currently-shown tooltip (null on first render).
// d: fetcher result — { error } or { five, seven }. Returns { tooltip, snap } to
// commit, or null to leave the shown string (and any open hover) untouched.
function nextTooltip(prev, name, d, nowMs, driftPct = 5) {
  const snap = d.error
    ? { error: String(d.error) }
    : {
        error: null,
        rem5: d.five.rem, rem7: d.seven.rem,
        m5: resetEpochMin(d.five.reset, nowMs), m7: resetEpochMin(d.seven.reset, nowMs),
      };
  let material;
  if (!prev) material = true;
  else if ((prev.error || null) !== (snap.error || null)) material = true;
  else if (snap.error) material = false; // same error string -> keep frozen
  else {
    material =
      resetMoved(prev.m5, snap.m5) || resetMoved(prev.m7, snap.m7) ||
      remDelta(prev.rem5, snap.rem5) >= driftPct ||
      remDelta(prev.rem7, snap.rem7) >= driftPct;
  }
  if (!material) return null;
  const tooltip = d.error ? `${name}: ${d.error}` : tooltipFor(name, d.five, d.seven, nowMs);
  return { tooltip, snap };
}

// ---- Codex weekly-only (v1.2) ---------------------------------------------
// July 2026: OpenAI removed Codex's 5h session window. The usage endpoint now
// returns the WEEKLY window in primary_window and secondary_window: null.
// Accounts not yet migrated still send the old two-window shape, so parsing is
// shape-detected: secondary present -> legacy {five, seven}; absent -> weekly.

const WEEK = 7 * 24 * 3600;

function parseCodexUsage(j, httpStatus) {
  const rl = j.rate_limit || j;
  const p = rl.primary_window || rl.primaryWindow || j.primary_window || null;
  const s = rl.secondary_window || rl.secondaryWindow || j.secondary_window || null;
  const rem = (u) => (u == null ? null : Math.max(0, Math.round(100 - u)));
  if (s) { // legacy two-window shape
    if ((p ? p.used_percent : null) == null && s.used_percent == null)
      return { error: `no quota windows (HTTP ${httpStatus})` };
    return {
      five: { rem: rem(p ? p.used_percent : null), reset: p ? p.reset_after_seconds : null, win: (p && p.limit_window_seconds) || 5 * 3600 },
      seven: { rem: rem(s.used_percent), reset: s.reset_after_seconds, win: s.limit_window_seconds || WEEK },
    };
  }
  if (!p || p.used_percent == null) return { error: `no quota windows (HTTP ${httpStatus})` };
  const extra = Array.isArray(j.additional_rate_limits) ? j.additional_rate_limits[0] : null;
  const ew = extra && extra.rate_limit && extra.rate_limit.primary_window;
  const rc = j.rate_limit_reset_credits;
  return {
    weekly: { rem: rem(p.used_percent), reset: p.reset_after_seconds, win: p.limit_window_seconds || WEEK },
    spark: ew && ew.used_percent != null
      ? { name: extra.limit_name || "Spark", rem: rem(ew.used_percent), reset: ew.reset_after_seconds }
      : null,
    resets: rc && typeof rc.available_count === "number" ? rc.available_count : null,
  };
}

// δ = remaining − on-pace remaining. Negative -> burning faster than even pace.
function paceDelta(rem, timeLeftSec, windowSec) {
  const line = paceLine(timeLeftSec, windowSec);
  if (rem == null || line == null) return null;
  return rem - line;
}

// Verdict with ±tol points of the weekly limit counted as on pace.
function paceState(rem, timeLeftSec, windowSec, tol) {
  const d = paceDelta(rem, timeLeftSec, windowSec);
  if (d == null) return null;
  if (d < -tol) return "hot";
  if (d > tol) return "cool";
  return "on";
}

function fmtSigned(d) {
  const r = Math.round(d);
  return r > 0 ? `+${r}` : r < 0 ? `−${Math.abs(r)}` : "±0"; // U+2212, house style
}

// Bar segment after "{dot} Codex ": no 🗓 (a single limit needs no icon anchor).
// Credits ride the pace glyph ("🔥4"); with no glyph they get ↺ so the count
// doesn't float alone; 0/absent stays hidden.
function codexSegment(rem, reset, win, tol, credits) {
  const base = `${rem == null ? "—" : rem + "%"} (${fmtLong(reset)})`;
  const st = paceState(rem, reset, win, tol);
  const glyph = st === "hot" ? "🔥" : st === "cool" ? "🧊" : "";
  const cr = credits != null && credits > 0 ? String(credits) : "";
  if (glyph) return cr ? `${base} ${glyph}${cr}` : `${base} ${glyph}`;
  return cr ? `${base} ↺${cr}` : base;
}

// Weekly tooltip. Same stability contract as tooltipFor: minute-rounded absolute
// clocks; the day-granular "(5d left)" suffix only appears at >= 1 day so the
// string can't churn per-minute (rewrites are gated by nextTooltipWeekly anyway).
function tooltipForCodexWeekly(name, d, nowMs, tol) {
  const w = d.weekly;
  const lines = [name];
  const days = w.reset != null && w.reset >= 86400 ? ` (${fmtLong(w.reset)} left)` : "";
  lines.push(`Weekly: ${w.rem == null ? "—" : w.rem + "% left"} · resets ${clockLong(w.reset, nowMs)}${days}`);
  const st = paceState(w.rem, w.reset, w.win, tol);
  if (st != null) {
    const sd = fmtSigned(paceDelta(w.rem, w.reset, w.win));
    const line = Math.round(paceLine(w.reset, w.win));
    lines.push(st === "on"
      ? `Pace: on track (${sd} vs even burn)`
      : `${st === "hot" ? "🔥" : "🧊"} Pace: ${sd} vs even burn (on-pace ${line}%)`);
  }
  if (d.resets != null) lines.push(`↺ Rate-limit resets available: ${d.resets}`);
  if (d.spark) lines.push(`⚡ Spark: ${d.spark.rem == null ? "—" : d.spark.rem + "% left"} · resets ${clockLongCoarse(d.spark.reset, nowMs)}`);
  return lines.join("\n");
}

// Weekly analogue of nextTooltip: same materiality machinery, weekly-only snapshot.
// Extra material events: pace verdict flip, reset-credit count change, spark
// appear/vanish/move/drift. Spark uses hour epochs to match clockLongCoarse:
// untouched full-window limits slide by minutes, but real rollovers jump by days.
function nextTooltipWeekly(prev, name, d, nowMs, tol, driftPct = 5) {
  const snap = d.error
    ? { error: String(d.error) }
    : {
        error: null,
        rem: d.weekly.rem,
        m: resetEpochMin(d.weekly.reset, nowMs),
        st: paceState(d.weekly.rem, d.weekly.reset, d.weekly.win, tol),
        resets: d.resets == null ? null : d.resets,
        sparkRem: d.spark ? d.spark.rem : null,
        sparkM: d.spark ? resetEpochHour(d.spark.reset, nowMs) : "none",
      };
  let material;
  if (!prev) material = true;
  else if ((prev.error || null) !== (snap.error || null)) material = true;
  else if (snap.error) material = false;
  else {
    // A ±1 rem wobble at the tolerance boundary can flip the displayed verdict
    // every tick; require the new verdict to survive tol+1 before rewriting.
    // A real trend crosses that band soon enough, and driftPct still cuts through.
    material =
      resetMoved(prev.m, snap.m) ||
      remDelta(prev.rem, snap.rem) >= driftPct ||
      (snap.st !== prev.st &&
        paceState(d.weekly.rem, d.weekly.reset, d.weekly.win, tol + 1) === snap.st) ||
      prev.resets !== snap.resets ||
      resetMoved(prev.sparkM, snap.sparkM) ||
      remDelta(prev.sparkRem, snap.sparkRem) >= driftPct;
  }
  if (!material) return null;
  const tooltip = d.error ? `${name}: ${d.error}` : tooltipForCodexWeekly(name, d, nowMs, tol);
  return { tooltip, snap };
}

module.exports = {
  fmtShort, fmtLong, parseUtil, parseResetHeader, accountFromJwt,
  dotFor, paceLine, reveal5h, reveal7d, tooltipFor, nextTooltip,
  parseCodexUsage, paceDelta, paceState, fmtSigned, codexSegment,
  tooltipForCodexWeekly, nextTooltipWeekly,
};
