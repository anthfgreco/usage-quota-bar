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

function tooltipFor(name, five, seven, nowMs) {
  return (
    `${name}\n` +
    `⏱ 5h: ${five.rem == null ? "—" : five.rem + "% left"} · resets ${clockShort(five.reset, nowMs)}\n` +
    `🗓 Weekly resets ${clockLong(seven.reset, nowMs)} (${seven.rem == null ? "—" : seven.rem + "% left"})`
  );
}

module.exports = {
  fmtShort, fmtLong, parseUtil, parseResetHeader, accountFromJwt,
  dotFor, paceLine, reveal5h, reveal7d, tooltipFor,
};
