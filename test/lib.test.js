"use strict";
// Plain-Node unit tests for the pure logic in lib.js. Run: npm test  (or: node test/lib.test.js)
const L = require("../lib");
let pass = 0, fail = 0;
function eq(name, got, want) {
  if (got === want) pass++;
  else { fail++; console.log("FAIL", name, "got", JSON.stringify(got), "want", JSON.stringify(want)); }
}

// formatting
eq("fmtShort 1h23m", L.fmtShort(83 * 60), "1h23m");
eq("fmtShort 2h (no 0m)", L.fmtShort(2 * 3600), "2h");
eq("fmtShort 45m", L.fmtShort(45 * 60), "45m");
eq("fmtLong 6d", L.fmtLong(6.8 * 86400), "6d");
eq("fmtLong 20h (no 0m)", L.fmtLong(20 * 3600), "20h");

// dots
eq("dot green", L.dotFor(82), "🟢");
eq("dot amber", L.dotFor(30), "🟡");
eq("dot red", L.dotFor(8), "🔴");
eq("dot unknown", L.dotFor(null), "⚪");

// utilization / reset parsing
eq("util fraction -> pct", L.parseUtil("0.6"), 60);
eq("util already pct", L.parseUtil("83"), 83);
const now = 1700000000000;
eq("reset epoch +1h", L.parseResetHeader(String(1700000000 + 3600), now), 3600);
eq("reset rfc3339 +2h", L.parseResetHeader(new Date(now + 7200000).toISOString(), now), 7200);

// pace line
eq("pace 90", Math.round(L.paceLine(16200, 18000)), 90);
eq("pace null window", L.paceLine(100, 0), null);

// 5h reveal (floor 50, fast margin 12)
const o5 = { floor: 50, fastMargin: 12 };
eq("5h on-track hidden", L.reveal5h(82, 16200, 18000, o5), false);
eq("5h floor", L.reveal5h(45, 16200, 18000, o5), true);
eq("5h too-fast above floor", L.reveal5h(60, 16200, 18000, o5), true); // the key case
eq("5h unknown shows", L.reveal5h(null, 1, 1, o5), true);

// 7d reveal (fast margin 15, surplus, scarce 25)
const o7 = { fastMargin: 15, soonFrac: 2 / 7, high: 50, scarce: 25 };
eq("7d on-track hidden", L.reveal7d(84, 6.77 * 86400, 604800, o7), false); // loosened margin
eq("7d too-fast", L.reveal7d(40, 5 * 86400, 604800, o7), true);
eq("7d surplus", L.reveal7d(88, 1.5 * 86400, 604800, o7), true);
eq("7d scarce", L.reveal7d(20, 6 * 86400, 604800, o7), true);

// tooltip stability — VS Code kills an open status-bar hover whenever the tooltip
// STRING changes (vscode#128887), so the tooltip must be byte-identical across refresh
// ticks when the quota hasn't changed. Countdown text ("in 1h23m") and un-rounded
// clock times violate this: they churn every cycle and make the hover flash/vanish.
const T0 = 1700000000000;
const tipA = L.tooltipFor("Claude", { rem: 78, reset: 5000 }, { rem: 74, reset: 400000 }, T0);
// one refresh tick later: now +60s, resets ~60s lower with ±2-3s of API jitter
const tipB = L.tooltipFor("Claude", { rem: 78, reset: 5000 - 62 }, { rem: 74, reset: 400000 - 57 }, T0 + 60000);
eq("tooltip identical across tick (same quota)", tipA, tipB);
eq("tooltip has no countdown churn", tipA.includes("(in "), false);
eq("tooltip changes when quota changes",
  L.tooltipFor("Claude", { rem: 77, reset: 5000 }, { rem: 74, reset: 400000 }, T0) === tipA, false);
const tipNull = L.tooltipFor("Codex", { rem: null, reset: null }, { rem: null, reset: null }, T0);
eq("tooltip null rem shows dash", tipNull.includes("—"), true);
eq("tooltip null reset shows unknown", tipNull.includes("unknown"), true);

// elapsed resets (0, negative, or stale-past epochs clamped to 0) must render a
// CONSTANT string — anchoring them to "now" makes the tooltip advance one minute
// per refresh tick, re-triggering the flashing-hover bug while the API serves a
// stale window.
const el1 = L.tooltipFor("Claude", { rem: 78, reset: 0 }, { rem: 74, reset: 0 }, T0);
const el2 = L.tooltipFor("Claude", { rem: 78, reset: 0 }, { rem: 74, reset: 0 }, T0 + 60000);
eq("tooltip stable when reset elapsed (0)", el1, el2);
const ng1 = L.tooltipFor("Codex", { rem: 50, reset: -300 }, { rem: 60, reset: -300 }, T0);
const ng2 = L.tooltipFor("Codex", { rem: 50, reset: -300 }, { rem: 60, reset: -300 }, T0 + 60000);
eq("tooltip stable when reset elapsed (negative)", ng1, ng2);
eq("elapsed reset renders 'soon'", el1.includes("resets soon"), true);

// tooltip rewrite gating — byte-stability (above) is necessary but NOT sufficient:
// VS Code (verified in 1.117.0 statusbarItem.ts + updatableHoverWidget.ts) disposes an
// open hover whenever the tooltip STRING changes, and a provider under active use has
// GENUINE data churn (Codex used_percent ticks ~1%/min), so an always-fresh tooltip
// still kills the hover every refresh. Fix: commit a new tooltip string only on a
// MATERIAL change — reset clock rolled to a new window, error state flipped, or rem
// drifted >= driftPct from what the shown tooltip already says. nextTooltip(prev, name,
// d, nowMs) returns {tooltip, snap} to commit, or null to leave the shown string alone.
eq("nextTooltip exported", typeof L.nextTooltip, "function");
const D = (r5, s5, r7, s7) => ({ five: { rem: r5, reset: s5 }, seven: { rem: r7, reset: s7 } });

// first render always commits, with the same string tooltipFor builds
const g1 = L.nextTooltip(null, "Codex", D(12, 1778, 86, 588578), T0);
eq("first render commits", g1 !== null, true);
eq("first render tooltip matches tooltipFor", g1.tooltip,
  L.tooltipFor("Codex", { rem: 12, reset: 1778 }, { rem: 86, reset: 588578 }, T0));

// THE Codex bug: one tick later rem drifts 1% (12->11), resets ~60s lower -> no rewrite
eq("1% drift does not rewrite", L.nextTooltip(g1.snap, "Codex", D(11, 1712, 86, 588512), T0 + 65000), null);

// drift just under threshold (12 -> 8) -> still no rewrite
eq("4% drift does not rewrite", L.nextTooltip(g1.snap, "Codex", D(8, 1500, 86, 588300), T0 + 300000), null);

// drift at threshold (12 -> 7) -> rewrite, and the tooltip shows the fresh value
const g2 = L.nextTooltip(g1.snap, "Codex", D(7, 1400, 86, 588200), T0 + 360000);
eq("5% drift rewrites", g2 !== null, true);
eq("rewrite shows fresh rem", g2.tooltip.includes("7% left"), true);

// 7d drift gates independently
eq("7d 5% drift rewrites",
  L.nextTooltip(g1.snap, "Codex", D(12, 1700, 81, 588500), T0 + 65000) !== null, true);

// new 5h window: reset jumps forward -> clock changes -> rewrite even with rem stable
eq("new window rewrites",
  L.nextTooltip(g1.snap, "Codex", D(12, 1778 + 7200, 86, 588578), T0) !== null, true);

// null<->number rem shape change -> rewrite
eq("rem null->number rewrites",
  L.nextTooltip(g1.snap, "Codex", D(null, 1778, 86, 588578), T0) !== null, true);

// error transitions: appear -> rewrite (error text), persist -> frozen, clear -> rewrite
const gE = L.nextTooltip(g1.snap, "Codex", { error: "no quota headers (HTTP 500)" }, T0);
eq("error appearing rewrites", gE !== null, true);
eq("error tooltip text", gE.tooltip, "Codex: no quota headers (HTTP 500)");
eq("same error does not rewrite",
  L.nextTooltip(gE.snap, "Codex", { error: "no quota headers (HTTP 500)" }, T0 + 65000), null);
eq("error clearing rewrites",
  L.nextTooltip(gE.snap, "Codex", D(12, 1778, 86, 588578), T0 + 130000) !== null, true);

// rounding-boundary wobble — if a window's true reset epoch sits within jitter range
// of an exact :30s-in-minute boundary, minute-rounding flips the rendered clock
// between adjacent minutes on every tick. Comparing rendered clock strings therefore
// reintroduces per-tick rewrites (hover death) for that whole window. The gate must
// compare minute-rounded reset EPOCHS with ±1 min tolerance instead.
// T0 % 60000 == 20000, so reset=970s puts the reset epoch exactly at :30.000.
const gW = L.nextTooltip(null, "Codex", D(12, 970, 86, 588578), T0);
// next tick renders 200ms early: epoch reconstructs to :29.800 -> rounds to the LOWER
// minute. A string-comparing gate sees a "clock change" and rewrites; it must not.
eq("±1min rounding wobble does not rewrite (5h)",
  L.nextTooltip(gW.snap, "Codex", D(12, 905, 86, 588513), T0 + 64800), null);
// and the same wobble on the 7d window (reset epoch at :30.000 too: 588550s from T0)
const gW7 = L.nextTooltip(null, "Codex", D(12, 1778, 86, 588550), T0);
eq("±1min rounding wobble does not rewrite (7d)",
  L.nextTooltip(gW7.snap, "Codex", D(12, 1713, 86, 588485), T0 + 64800), null);
// genuine movement is still material: a 2-minute shift of the same window rewrites
eq("2min reset shift rewrites",
  L.nextTooltip(gW.snap, "Codex", D(12, 970 + 120, 86, 588578), T0) !== null, true);
// zero-crossing to elapsed ("soon") is material exactly once, then frozen
const gZ = L.nextTooltip(gW.snap, "Codex", D(12, 0, 86, 588578 - 970), T0 + 970000);
eq("reset elapsing rewrites once", gZ !== null, true);
eq("elapsed stays frozen",
  L.nextTooltip(gZ.snap, "Codex", D(12, -60, 86, 588578 - 1030), T0 + 1030000), null);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
