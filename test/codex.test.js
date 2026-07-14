// Codex weekly-only end-to-end: mocked https serves the sanitized 2026-07-14
// payload; fetchCodex must parse the new shape and renderCodex must produce the
// always-on segment. Also guards the legacy two-window fallback.
const fs = require("fs");
const path = require("path");

const HOME = "/tmp/uqb_fakehome_codex";
process.env.HOME = HOME;
fs.rmSync(HOME, { recursive: true, force: true });
fs.mkdirSync(path.join(HOME, ".codex"), { recursive: true });
fs.writeFileSync(path.join(HOME, ".codex", "auth.json"),
  JSON.stringify({ tokens: { access_token: "CODEX_TOKEN", account_id: "acct_test" } }));

const WEEKLY_BODY = JSON.stringify({
  plan_type: "pro",
  rate_limit: {
    allowed: true, limit_reached: false,
    primary_window: { used_percent: 22, limit_window_seconds: 604800, reset_after_seconds: 508511 },
    secondary_window: null,
  },
  additional_rate_limits: [{
    limit_name: "GPT-5.3-Codex-Spark",
    rate_limit: { primary_window: { used_percent: 0, limit_window_seconds: 604800, reset_after_seconds: 604800 }, secondary_window: null },
  }],
  rate_limit_reset_credits: { available_count: 4 },
});

const Module = require("module");
const vscodeStub = {
  workspace: { getConfiguration: () => ({ get: (_k, d) => d }) },
  window: { createStatusBarItem: () => ({ show() {}, hide() {} }) },
  StatusBarAlignment: { Right: 2 },
  ThemeColor: class { constructor(id) { this.id = id; } },
  commands: { registerCommand: () => ({}) },
};
const seen = { auth: null, account: null };
const httpsStub = {
  request(opts, cb) {
    seen.auth = opts.headers.authorization;
    seen.account = opts.headers["chatgpt-account-id"];
    const res = { statusCode: 200, headers: {},
      on(ev, fn) { if (ev === "data") fn(WEEKLY_BODY); if (ev === "end") fn(); return this; } };
    return { on() { return this; }, setTimeout() { return this; }, write() {}, end() { cb(res); } };
  },
};
const origLoad = Module._load;
Module._load = function (req, ...a) {
  if (req === "vscode") return vscodeStub;
  if (req === "https") return httpsStub;
  return origLoad.call(this, req, ...a);
};

const ext = require(path.join(__dirname, "..", "extension.js"));
const I = ext._internal;

(async () => {
  const d = await I.fetchCodex();
  const item = {};
  const T0 = 1700000000000;
  I.renderCodex(item, "Codex", d, { tol: 5, fiveFloor: 50 }, T0);

  const checks = [
    ["fetch sent bearer token", seen.auth === "Bearer CODEX_TOKEN"],
    ["fetch sent account header", seen.account === "acct_test"],
    ["weekly shape parsed", !d.error && d.weekly && d.weekly.rem === 78],
    ["spark parsed", d.spark && d.spark.rem === 100],
    ["resets parsed", d.resets === 4],
    ["bar text (hot, credits after glyph, no calendar)", item.text === "🟢 Codex  78% (5d) 🔥4"],
    ["item color green", item.color && item.color.id === "charts.green"],
    ["tooltip committed", typeof item.tooltip === "string" && item.tooltip.startsWith("Codex\n")],
    ["tooltip pace line", item.tooltip.includes("🔥 Pace: −6 vs even burn (on-pace 84%)")],
    ["tooltip resets line", item.tooltip.includes("↺ Rate-limit resets available: 4")],
    ["tooltip spark line", item.tooltip.includes("⚡ Spark: 100% left")],
  ];

  // legacy two-window shape still renders through the old reveal-gated path
  const legacy = {
    five: { rem: 60, reset: 9000, win: 18000 },
    seven: { rem: 90, reset: 500000, win: 604800 },
  };
  const li = {};
  I.renderCodex(li, "CodexLegacy", legacy, { tol: 5, fiveFloor: 50 }, T0);
  checks.push(["legacy fallback renders", typeof li.text === "string" && li.text.includes("CodexLegacy")]);

  // error path
  const ei = {};
  I.renderCodex(ei, "Codex2", { error: "no Codex credentials found" }, { tol: 5, fiveFloor: 50 }, T0);
  checks.push(["error renders white dash", ei.text === "⚪ Codex2 —"]);
  checks.push(["error tooltip", ei.tooltip === "Codex2: no Codex credentials found"]);

  let ok = true;
  for (const [name, pass] of checks) { console.log((pass ? "PASS" : "FAIL") + " — " + name); if (!pass) ok = false; }
  console.log(ok ? "\nALL GREEN ✅" : "\nFAILURES ❌");
  fs.rmSync(HOME, { recursive: true, force: true });
  process.exit(ok ? 0 : 1);
})().catch((e) => { console.error("HARNESS ERROR", e); process.exit(1); });
