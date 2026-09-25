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

// Precise time-left for tooltips: "6d 14h", "4h 19m", or "12m".
function fmtPrecise(seconds) {
  if (seconds == null || seconds < 0) return "?";
  const totalMinutes = Math.floor(seconds / 60);
  const days = Math.floor(totalMinutes / 1440);
  const hours = Math.floor((totalMinutes % 1440) / 60);
  const minutes = totalMinutes % 60;
  if (days >= 1) return hours > 0 ? `${days}d ${hours}h` : `${days}d`;
  if (hours >= 1) return minutes > 0 ? `${hours}h ${minutes}m` : `${hours}h`;
  return `${minutes}m`;
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
  const rc = j.rate_limit_reset_credits;
  return {
    weekly: { rem: rem(p.used_percent), reset: p.reset_after_seconds, win: p.limit_window_seconds || WEEK },
    resets: rc && typeof rc.available_count === "number" ? rc.available_count : null,
  };
}

// Reset-credit detail endpoint: nearest expiry among AVAILABLE credits.
// expires_at may be null (never expires) — such credits count but never win
// "nearest". Returns { count, nearestExpiry } where nearestExpiry is ms epoch
// or null (none expire / no details / no credits).
function parseCreditsDetail(j) {
  const list = Array.isArray(j && j.credits) ? j.credits : [];
  const avail = list.filter((c) => c && c.status === "available");
  const count = typeof (j && j.available_count) === "number" ? j.available_count : avail.length;
  let nearest = null;
  for (const c of avail) {
    if (c.expires_at == null) continue;
    const t = Date.parse(c.expires_at);
    if (!isNaN(t) && (nearest == null || t < nearest)) nearest = t;
  }
  return { count, nearestExpiry: nearest };
}

// "Jul 18" — absolute, no countdown churn (stability contract).
function fmtDateShort(epochMs) {
  return new Date(epochMs).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

// Whole days until expiry, ceiling. This churns at most once a day.
function daysUntil(epochMs, nowMs) {
  return Math.ceil((epochMs - nowMs) / 86400000);
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

function fmtSignedPercent(d) {
  const r = Math.round(d);
  return r > 0 ? `+${r}%` : r < 0 ? `-${Math.abs(r)}%` : "0%";
}

// Bar segment after "{dot} Codex ": no 🗓 (a single limit needs no icon anchor).
// Off-pace states include their delta directly (🔥−8 / 🧊+9). Reset credits stay
// separate as ↺N so the two numbers cannot be confused.
function codexSegment(rem, reset, win, tol, credits) {
  const base = `${rem == null ? "—" : rem + "%"} (${fmtLong(reset)})`;
  const st = paceState(rem, reset, win, tol);
  const delta = paceDelta(rem, reset, win);
  const glyph = st === "hot"
    ? `🔥${fmtSigned(delta)}`
    : st === "cool"
      ? `🧊${fmtSigned(delta)}`
      : "";
  const cr = credits != null && credits > 0 ? `↺${credits}` : "";
  return [base, glyph, cr].filter(Boolean).join(" ");
}

// Weekly tooltip. Same stability contract as tooltipFor: minute-rounded absolute
// clocks; the day-granular "(5d left)" suffix only appears at >= 1 day so the
// string can't churn per-minute (rewrites are gated by nextTooltipWeekly anyway).
function tooltipForCodexWeekly(name, d, nowMs, tol) {
  const w = d.weekly;
  const lines = [name];
  const timeLeft = w.reset == null ? "unknown" : `${fmtPrecise(w.reset)} left`;
  lines.push(`Weekly: ${w.rem == null ? "—" : w.rem + "% left"} · resets ${clockLong(w.reset, nowMs)} · ${timeLeft}`);
  const st = paceState(w.rem, w.reset, w.win, tol);
  if (st != null) {
    const sd = fmtSignedPercent(paceDelta(w.rem, w.reset, w.win));
    const target = Math.round(paceLine(w.reset, w.win));
    lines.push(st === "on"
      ? `Pace: on track (${sd}) · target ${target}% remaining now`
      : `${st === "hot" ? "🔥" : "🧊"} Pace: ${sd} · target ${target}% remaining now`);
  }
  if (w.rem != null && w.reset != null && w.reset > 0) {
    const budget = w.rem / (w.reset / 86400);
    lines.push(`Budget: ${budget.toFixed(1)}%/day until reset`);
  }
  if (d.resets != null) {
    let line = `↺ Rate-limit resets available: ${d.resets}`;
    if (d.resetsExpiry != null && d.resets > 0) {
      const dd = daysUntil(d.resetsExpiry, nowMs);
      if (dd > 0) line += ` · nearest expires ${fmtDateShort(d.resetsExpiry)} (${dd}d)`;
    }
    lines.push(line);
  }
  return lines.join("\n");
}

// Weekly analogue of nextTooltip: same materiality machinery, weekly-only snapshot.
// Extra material events include pace verdict flips, reset-credit changes, and the
// hour-granular precise time-left suffix.
function nextTooltipWeekly(prev, name, d, nowMs, tol, driftPct = 5) {
  const snap = d.error
    ? { error: String(d.error) }
    : {
        error: null,
        rem: d.weekly.rem,
        m: resetEpochMin(d.weekly.reset, nowMs),
        st: paceState(d.weekly.rem, d.weekly.reset, d.weekly.win, tol),
        resets: d.resets == null ? null : d.resets,
        expDays: d.resetsExpiry == null ? null : daysUntil(d.resetsExpiry, nowMs),
        leftHour: d.weekly.reset == null ? null : Math.floor(d.weekly.reset / 3600),
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
      // The nearest-expiry suffix is intentionally day-granular: a new expiry or
      // the daily countdown tick is material; minute-level clock churn is not.
      prev.expDays !== snap.expDays ||
      // The precise "6d 14h left" suffix changes hourly, not every refresh.
      prev.leftHour !== snap.leftHour;
  }
  if (!material) return null;
  const tooltip = d.error ? `${name}: ${d.error}` : tooltipForCodexWeekly(name, d, nowMs, tol);
  return { tooltip, snap };
}

module.exports = {
  fmtShort, fmtLong, fmtPrecise, parseUtil, parseResetHeader, accountFromJwt,
  dotFor, paceLine, reveal5h, reveal7d, tooltipFor, nextTooltip,
  parseCodexUsage, parseCreditsDetail, fmtDateShort, daysUntil,
  paceDelta, paceState, fmtSigned, codexSegment,
  tooltipForCodexWeekly, nextTooltipWeekly,
};
