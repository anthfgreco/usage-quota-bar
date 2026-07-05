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

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
