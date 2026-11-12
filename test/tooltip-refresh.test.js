"use strict";
const assert = require("node:assert/strict");
const Module = require("module");
const L = require("../lib");

// Exercise repeated renders on one status item without credentials or network.
const originalLoad = Module._load;
Module._load = function (name, ...args) {
  if (name === "vscode") return { ThemeColor: class {} };
  return originalLoad.call(this, name, ...args);
};
const { renderCodex } = require("../extension")._internal;
Module._load = originalLoad;

const now = Date.UTC(2026, 8, 28, 12);
const opt = { tol: 5, fiveFloor: 50 };
const data = { weekly: { rem: 83, reset: 480000, win: 604800 }, resets: 1 };
let tooltip, writes = 0;
const item = {
  get tooltip() { return tooltip; },
  set tooltip(value) { tooltip = value; writes++; },
};
renderCodex(item, "Codex", data, opt, now);
renderCodex(item, "Codex", data, opt, now);
assert.equal(writes, 1, "identical refresh preserves hover");

for (const rem of [82, 81, 80, 79]) {
  const fresh = { ...data, weekly: { ...data.weekly, rem } };
  renderCodex(item, "Codex", fresh, opt, now);
  assert.ok(item.text.includes(`${rem}%`));
  assert.ok(item.tooltip.includes(`Weekly: ${rem}% left`));
  assert.equal(item.tooltip, L.tooltipForCodexWeekly("Codex", fresh, now, opt.tol));
}
assert.ok(item.tooltip.includes("Budget: 14.2%/day"));
assert.ok(item.tooltip.includes("Pace: on track (0%)"));
assert.ok(item.tooltip.includes("Workweek ("));

// Time-derived content must refresh even without a change in remaining quota.
const later = { ...data, weekly: { ...data.weekly, rem: 79, reset: 476400 } };
renderCodex(item, "Codex", later, opt, now + 3600000);
assert.ok(item.tooltip.includes("Budget: 14.3%/day"));
const short = { ...data, weekly: { rem: 1, reset: 1800, win: 604800 } };
renderCodex(item, "Codex", short, opt, now);
renderCodex(item, "Codex", { ...short, weekly: { ...short.weekly, reset: 1740 } }, opt, now + 60000);
assert.ok(item.tooltip.includes("29m left"));

renderCodex(item, "Codex", { error: "offline" }, opt, now);
assert.equal(item.tooltip, "Codex: offline");
const errorWrites = writes;
renderCodex(item, "Codex", { error: "offline" }, opt, now + 60000);
assert.equal(writes, errorWrites);
renderCodex(item, "Codex", data, opt, now);
assert.ok(item.tooltip.includes("Weekly: 83% left"));
console.log("Tooltip refresh regression checks passed");
