# Codex Weekly-Only Redesign (v1.2.0) Implementation Plan

> **For agentic workers:** Tasks 1–4 are implemented by Codex GPT-5.5 sub-agents
> (codex-build skill), one task per agent, in order (Task 2 depends on Task 1;
> Tasks 3 and 4 depend on 1–2 conceptually but touch disjoint files). Task 5 is
> done by the orchestrator. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the broken two-window Codex rendering with an always-on weekly
segment — `🟢 Codex  78% (5d) 🔥4` — per the approved spec
(`docs/superpowers/specs/2026-07-14-codex-weekly-design.md`).

**Architecture:** All new logic lands as pure, unit-testable helpers in `lib.js`
(parse → pace verdict → bar segment → tooltip → rewrite gate), mirroring the
existing pattern. `extension.js` only wires fetch/render. Claude's path is
untouched. Legacy two-window Codex accounts keep working via shape detection.

**Tech Stack:** Plain Node + VS Code API. **Zero npm dependencies** — do not add any.

## Global Constraints

- Zero npm deps; tests are plain Node scripts run with `node test/<file>.js` (exit code 1 on failure).
- Run tests directly with `node`, never via `npm test` (project policy for this run).
- Hover-stability invariants (vscode#128887) MUST hold: minute-rounded absolute reset clocks, no sub-day live countdowns in tooltips, tooltip strings rewritten only via a material-change gate.
- Pace glyphs: `🔥` faster than even burn, `🧊` slower, nothing when on pace. Tolerance ±`tol` points, from setting `usageQuotaBar.paceTolerance`, default `5`.
- Reset credits: hidden when 0/absent in the bar; `🔥4` (no space) after a pace glyph; `↺4` alone when on pace.
- No 🗓/⏱ icons on the Codex segment. Claude keeps them.
- Minus sign in deltas is U+2212 `−`, matching the codebase's typographic style.
- No PII in fixtures: strip `user_id`, `account_id`, `email` from captured payloads.
- Code comments follow the existing style: explain constraints/why, not what.

## Captured live payload (2026-07-14, sanitized) — the canonical fixture

```json
{
  "plan_type": "pro",
  "rate_limit": {
    "allowed": true,
    "limit_reached": false,
    "primary_window": {
      "used_percent": 22,
      "limit_window_seconds": 604800,
      "reset_after_seconds": 508511,
      "reset_at": 1784506301
    },
    "secondary_window": null
  },
  "additional_rate_limits": [
    {
      "limit_name": "GPT-5.3-Codex-Spark",
      "metered_feature": "codex_bengalfox",
      "rate_limit": {
        "allowed": true,
        "limit_reached": false,
        "primary_window": {
          "used_percent": 0,
          "limit_window_seconds": 604800,
          "reset_after_seconds": 604800,
          "reset_at": 1784602591
        },
        "secondary_window": null
      }
    }
  ],
  "credits": { "has_credits": false, "unlimited": false, "overage_limit_reached": false, "balance": "0" },
  "rate_limit_reset_credits": { "available_count": 4 }
}
```

---

### Task 1: lib.js pure helpers + unit tests

**Files:**
- Modify: `lib.js` (append new helpers before `module.exports`; extend exports)
- Test: `test/lib.test.js` (append new cases before the final `console.log`)

**Interfaces (Produces — Task 2 relies on these exact names):**
- `parseCodexUsage(json, httpStatus)` → `{ weekly:{rem,reset,win}, spark:{name,rem,reset}|null, resets:number|null }` for the new shape, `{ five, seven }` (existing shape) when `secondary_window` is present, or `{ error: string }`.
- `paceDelta(rem, timeLeftSec, windowSec)` → number|null (rem − on-pace-remaining)
- `paceState(rem, timeLeftSec, windowSec, tol)` → `"hot" | "on" | "cool" | null`
- `fmtSigned(delta)` → `"+41" | "−6" | "±0"` (U+2212)
- `codexSegment(rem, reset, win, tol, credits)` → bar text after the `{dot} Codex ` prefix
- `tooltipForCodexWeekly(name, d, nowMs, tol)` → multi-line tooltip string
- `nextTooltipWeekly(prev, name, d, nowMs, tol, driftPct = 5)` → `{tooltip, snap} | null`

- [ ] **Step 1: Write the failing tests** — append to `test/lib.test.js`:

```js
// ---- v1.2: Codex weekly-only (OpenAI removed the 5h window, July 2026) ----

// parseCodexUsage: new weekly-only shape (secondary_window null)
const WEEKLY_JSON = {
  rate_limit: {
    primary_window: { used_percent: 22, limit_window_seconds: 604800, reset_after_seconds: 508511 },
    secondary_window: null,
  },
  additional_rate_limits: [{
    limit_name: "GPT-5.3-Codex-Spark",
    rate_limit: { primary_window: { used_percent: 0, limit_window_seconds: 604800, reset_after_seconds: 604800 }, secondary_window: null },
  }],
  rate_limit_reset_credits: { available_count: 4 },
};
const pw = L.parseCodexUsage(WEEKLY_JSON, 200);
eq("parse weekly rem", pw.weekly.rem, 78);
eq("parse weekly reset", pw.weekly.reset, 508511);
eq("parse weekly win", pw.weekly.win, 604800);
eq("parse spark rem", pw.spark.rem, 100);
eq("parse resets", pw.resets, 4);
eq("parse weekly has no five", pw.five === undefined, true);

// legacy two-window shape still parses (accounts not yet migrated)
const LEGACY_JSON = { rate_limit: {
  primary_window: { used_percent: 40, limit_window_seconds: 18000, reset_after_seconds: 9000 },
  secondary_window: { used_percent: 10, limit_window_seconds: 604800, reset_after_seconds: 500000 },
} };
const pl = L.parseCodexUsage(LEGACY_JSON, 200);
eq("legacy five rem", pl.five.rem, 60);
eq("legacy seven rem", pl.seven.rem, 90);
eq("legacy has no weekly", pl.weekly === undefined, true);

// degenerate shapes -> error
eq("no windows -> error", L.parseCodexUsage({}, 200).error, "no quota windows (HTTP 200)");
eq("weekly-only null used -> error",
  L.parseCodexUsage({ rate_limit: { primary_window: {}, secondary_window: null } }, 500).error,
  "no quota windows (HTTP 500)");

// pace verdicts — tol 5; window 604800
eq("pace hot", L.paceState(78, 508511, 604800, 5), "hot");     // δ ≈ −6.08
eq("pace on (exactly -tol)", L.paceState(79, 508032, 604800, 5), "on"); // line 84, δ = −5 exactly
eq("pace cool", L.paceState(92, 129600, 604800, 5), "cool");   // line ≈ 21.4
eq("pace null rem", L.paceState(null, 1000, 604800, 5), null);
eq("pace null window", L.paceState(50, 1000, 0, 5), null);
eq("fmtSigned -6", L.fmtSigned(-6.08), "−6");
eq("fmtSigned +41", L.fmtSigned(40.6), "+41");
eq("fmtSigned zero", L.fmtSigned(0), "±0");

// bar segment — no 🗓, credits after glyph, ↺ when on pace, hidden at 0
eq("segment hot+credits", L.codexSegment(78, 508511, 604800, 5, 4), "78% (5d) 🔥4");
eq("segment hot no credits", L.codexSegment(78, 508511, 604800, 5, 0), "78% (5d) 🔥");
eq("segment on pace w/ credits", L.codexSegment(55, 336960, 604800, 5, 4), "55% (3d) ↺4");
eq("segment on pace bare", L.codexSegment(55, 336960, 604800, 5, null), "55% (3d)");
eq("segment cool", L.codexSegment(92, 129600, 604800, 5, 4), "92% (1d) 🧊4");
eq("segment unknown rem", L.codexSegment(null, null, 604800, 5, null), "— (?)");

// weekly tooltip — shape and stability
const WD = { weekly: { rem: 78, reset: 508511, win: 604800 },
             spark: { name: "GPT-5.3-Codex-Spark", rem: 100, reset: 604800 }, resets: 4 };
const wt = L.tooltipForCodexWeekly("Codex", WD, T0, 5);
eq("weekly tooltip first line", wt.split("\n")[0], "Codex");
eq("weekly tooltip has weekly line", wt.includes("Weekly: 78% left · resets "), true);
eq("weekly tooltip day suffix", wt.includes("(5d left)"), true);
eq("weekly tooltip pace", wt.includes("🔥 Pace: −6 vs even burn (on-pace 84%)"), true);
eq("weekly tooltip resets", wt.includes("↺ Rate-limit resets available: 4"), true);
eq("weekly tooltip spark", wt.includes("⚡ Spark: 100% left · resets "), true);
eq("weekly tooltip no calendar icon", wt.includes("🗓"), false);
// byte-stable across one refresh tick (same quota, ~60s lower reset + API jitter;
// −58 not −62: keeps the reset epoch inside the same rounded minute — boundary
// wobble is the gate's job, not the builder's)
const wt2 = L.tooltipForCodexWeekly("Codex",
  { ...WD, weekly: { rem: 78, reset: 508511 - 58, win: 604800 } }, T0 + 60000, 5);
eq("weekly tooltip stable across tick", wt, wt2);
// on-pace copy, no spark/resets lines when absent
const wtOn = L.tooltipForCodexWeekly("Codex",
  { weekly: { rem: 55, reset: 336960, win: 604800 }, spark: null, resets: null }, T0, 5);
eq("on-pace copy", wtOn.includes("Pace: on track ("), true);
eq("no resets line when null", wtOn.includes("↺"), false);
eq("no spark line when null", wtOn.includes("⚡"), false);

// weekly rewrite gate
const gw1 = L.nextTooltipWeekly(null, "Codex", WD, T0, 5);
eq("weekly gate first render commits", gw1 !== null, true);
eq("weekly gate tooltip matches builder", gw1.tooltip, wt);
// one tick later: rem drifts 1, reset −60s -> frozen
eq("weekly 1% drift no rewrite", L.nextTooltipWeekly(gw1.snap, "Codex",
  { ...WD, weekly: { rem: 77, reset: 508449, win: 604800 } }, T0 + 62000, 5), null);
// 5-point drift -> rewrite
eq("weekly 5% drift rewrites", L.nextTooltipWeekly(gw1.snap, "Codex",
  { ...WD, weekly: { rem: 73, reset: 508000, win: 604800 } }, T0 + 300000, 5) !== null, true);
// pace verdict flip is material even under drift threshold: rem 78→80 crosses δ −6→−4 (hot→on)
eq("verdict flip rewrites", L.nextTooltipWeekly(gw1.snap, "Codex",
  { ...WD, weekly: { rem: 80, reset: 508511, win: 604800 } }, T0, 5) !== null, true);
// credits change is material
eq("credits change rewrites", L.nextTooltipWeekly(gw1.snap, "Codex",
  { ...WD, resets: 3 }, T0, 5) !== null, true);
// spark disappearing is material
eq("spark vanish rewrites", L.nextTooltipWeekly(gw1.snap, "Codex",
  { ...WD, spark: null }, T0, 5) !== null, true);
// error flip both ways, frozen while persisting
const gwE = L.nextTooltipWeekly(gw1.snap, "Codex", { error: "no Codex credentials found" }, T0, 5);
eq("weekly error rewrites", gwE !== null, true);
eq("weekly error text", gwE.tooltip, "Codex: no Codex credentials found");
eq("weekly same error frozen", L.nextTooltipWeekly(gwE.snap, "Codex",
  { error: "no Codex credentials found" }, T0 + 62000, 5), null);
eq("weekly error clear rewrites", L.nextTooltipWeekly(gwE.snap, "Codex", WD, T0, 5) !== null, true);
```

- [ ] **Step 2: Run to verify failure** — `node test/lib.test.js` → FAILs / crashes on missing exports.

- [ ] **Step 3: Implement in `lib.js`** (before `module.exports`; then extend exports). Reference implementation:

```js
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
  if (d.spark) lines.push(`⚡ Spark: ${d.spark.rem == null ? "—" : d.spark.rem + "% left"} · resets ${clockLong(d.spark.reset, nowMs)}`);
  return lines.join("\n");
}

// Weekly analogue of nextTooltip: same materiality machinery, weekly-only snapshot.
// Extra material events: pace verdict flip, reset-credit count change, spark
// appear/vanish/move/drift.
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
        sparkM: d.spark ? resetEpochMin(d.spark.reset, nowMs) : "none",
      };
  let material;
  if (!prev) material = true;
  else if ((prev.error || null) !== (snap.error || null)) material = true;
  else if (snap.error) material = false;
  else {
    material =
      resetMoved(prev.m, snap.m) ||
      remDelta(prev.rem, snap.rem) >= driftPct ||
      prev.st !== snap.st ||
      prev.resets !== snap.resets ||
      resetMoved(prev.sparkM, snap.sparkM) ||
      remDelta(prev.sparkRem, snap.sparkRem) >= driftPct;
  }
  if (!material) return null;
  const tooltip = d.error ? `${name}: ${d.error}` : tooltipForCodexWeekly(name, d, nowMs, tol);
  return { tooltip, snap };
}
```

Extend exports:

```js
module.exports = {
  fmtShort, fmtLong, parseUtil, parseResetHeader, accountFromJwt,
  dotFor, paceLine, reveal5h, reveal7d, tooltipFor, nextTooltip,
  parseCodexUsage, paceDelta, paceState, fmtSigned, codexSegment,
  tooltipForCodexWeekly, nextTooltipWeekly,
};
```

- [ ] **Step 4: Run** — `node test/lib.test.js` → all pass (existing cases must stay green).
- [ ] **Step 5: Commit** — `git add lib.js test/lib.test.js && git commit -m "feat: weekly-only Codex helpers (parse, pace verdict, segment, tooltip, gate)"`

---

### Task 2: extension.js wiring + paceTolerance setting + codex fetch/render test

**Files:**
- Modify: `extension.js` (`fetchCodex` ~lines 225–244, `refresh` ~lines 272–287, `_internal` export line)
- Modify: `package.json` (`contributes.configuration.properties`, `scripts.test`, `description`)
- Create: `test/codex.test.js`

**Interfaces:**
- Consumes (from Task 1): `L.parseCodexUsage`, `L.codexSegment`, `L.nextTooltipWeekly`, `L.dotFor`.
- Produces: `_internal.renderCodex(item, name, d, opt, nowMs)` where `opt = { tol, fiveFloor }` — the test file and future callers rely on this exact signature.

- [ ] **Step 1: Write the failing test** — create `test/codex.test.js`:

```js
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
```

- [ ] **Step 2: Run to verify failure** — `node test/codex.test.js` → FAIL (`renderCodex` undefined, weekly shape missing).

- [ ] **Step 3: Implement in `extension.js`.**

Replace the body of `fetchCodex` from `let j;` down (keep the auth/request part unchanged):

```js
  let j;
  try { j = JSON.parse(res.body); } catch (_) { return { error: `bad response (HTTP ${res.status})` }; }
  return L.parseCodexUsage(j, res.status);
```

Add `renderCodex` directly below `renderProvider`:

```js
// Codex went weekly-only (July 2026): one always-on segment — dot, remaining %,
// days left, pace glyph, reset credits. No 🗓: a single limit needs no icon
// anchor. Legacy two-window accounts fall back to the reveal-gated renderer.
function renderCodex(it, name, d, opt, nowMs = Date.now()) {
  if (d.five || d.seven) return renderProvider(it, name, d, opt.fiveFloor, nowMs);
  const t = L.nextTooltipWeekly(tipSnaps[name] || null, name, d, nowMs, opt.tol);
  if (t) { it.tooltip = t.tooltip; tipSnaps[name] = t.snap; }
  if (d.error) {
    it.text = `⚪ ${name} —`;
    it.color = colorFor(null);
    return;
  }
  const w = d.weekly;
  it.text = `${L.dotFor(w.rem)} ${name}  ${L.codexSegment(w.rem, w.reset, w.win, opt.tol, d.resets)}`;
  it.color = colorFor(w.rem);
}
```

In `refresh()`, replace the Codex branch:

```js
  if (cfg.get("showCodex", true)) {
    items.codex.show();
    const opt = { tol: cfg.get("paceTolerance", 5), fiveFloor };
    try { renderCodex(items.codex, "Codex", await fetchCodex(), opt); }
    catch (e) { renderCodex(items.codex, "Codex", { error: e.message }, opt); }
  } else items.codex.hide();
```

Extend `_internal` exports with `fetchCodex` and `renderCodex`:

```js
module.exports._internal = { readClaudeCreds, refreshClaudeToken, fetchClaude, parseClaudeCreds, renderProvider, fetchCodex, renderCodex };
```

Update the file-top banner comment (lines 2–6) to describe the split behavior:
Claude = quiet 5h+7d; Codex = always-on weekly with pace glyph + reset credits.

- [ ] **Step 4: package.json.** Add to `contributes.configuration.properties`:

```json
"usageQuotaBar.paceTolerance": {
  "type": "number", "default": 5, "minimum": 0, "maximum": 50,
  "description": "Codex weekly pace tolerance: ± this many points of the weekly limit counts as on-pace (no 🔥/🧊)."
}
```

Set `scripts.test` to `node test/lib.test.js && node test/refresh.test.js && node test/codex.test.js`,
and set `description` to `Claude Code (5h + 7d) and Codex (weekly) subscription quota in the VS Code status bar — quiet, pace-aware, % remaining, not dollars.`

- [ ] **Step 5: Run all tests** — `node test/lib.test.js && node test/refresh.test.js && node test/codex.test.js` → all green.
- [ ] **Step 6: Commit** — `git add extension.js package.json test/codex.test.js && git commit -m "feat: always-on weekly Codex segment with pace glyph + reset credits"`

---

### Task 3: docs/index.html interactive demo — weekly-only Codex

**Files:**
- Modify: `docs/index.html`

No unit tests (browser page); verify by opening in a browser. Keep the page's existing visual language and file structure (single file, inline CSS/JS).

- [ ] **Step 1: Update the Codex model.** Replace Codex's four sliders (`x5, x5t, x7, x7t`) with three: `xw` (weekly used %, default 22), `xwt` (days left, range 0–7 step 0.1, default 5.9), `xcr` (reset credits, range 0–8 step 1, default 4). Claude sliders unchanged.
- [ ] **Step 2: Codex renderer.** New `codexHTML(name, usedPct, leftD, credits)` mirroring lib.js v1.2 exactly: `rem = 100 − used`; segment `= rem% (fmtDays) [🔥|🧊][credits | ↺credits]`; verdict via `δ = rem − leftD/7×100`, tol 5; **no 🗓 icon**; dot/color from rem. Tooltip (title attr): the weekly + pace + resets lines from the spec.
- [ ] **Step 3: Why-panel.** Codex card becomes a pace explainer: shows `δ`, on-pace %, verdict word ("faster than pace / on pace / slower than pace"), and resets count. Claude card unchanged.
- [ ] **Step 4: Scenario buttons.** `▶ Burn 5h` now only animates Claude; `▶ Busy week` / `▶ Lazy week` animate Claude 7d + Codex weekly; `Reset` restores defaults above.
- [ ] **Step 5: Legend + copy.** Legend gains: `Codex: one weekly limit — 🔥 faster / 🧊 slower than even pace · ↺N = rate-limit resets left`. Update the lede sentence to note Codex is always-on since OpenAI's July 2026 weekly-only change.
- [ ] **Step 6: Verify in browser** — `open docs/index.html`; drag each slider; confirm glyph flips at δ = ±5 and credits render as 🔥4 / ↺4 / hidden at 0.
- [ ] **Step 7: Commit** — `git add docs/index.html && git commit -m "docs: demo page reflects weekly-only Codex with pace glyph + reset credits"`

---

### Task 4: README rewrite

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Rewrite the hero.** New framing: two providers, two behaviors —
  **Claude** (5h + 7d, quiet until it matters — unchanged) and **Codex** (single weekly limit since OpenAI's July 2026 change — always-on segment). Update the example block to:

```
Claude (quiet until it matters):   🟢 Claude        🟡 Claude  ⏱ 12% (4h19m)
Codex (always on, weekly):         🟢 Codex  78% (5d) 🔥4      🔴 Codex  6% (1d)
```

- [ ] **Step 2: Add a "What changed in v1.2" section** near the top: OpenAI removed the 5h Codex window (weekly-only now); older versions of this extension show `🗓 — (?)` for Codex — upgrade fixes it. One short paragraph.
- [ ] **Step 3: Document the Codex segment**: remaining % · (days left) · pace glyph (🔥 faster / 🧊 slower than even burn, nothing when on pace, tolerance ±5 pts via `usageQuotaBar.paceTolerance`) · reset credits (`🔥4`; `↺4` when on pace; hidden at 0). Hover shows exact reset time, δ vs even burn, resets, and the Spark limit when present. Note explicitly: no 🗓 icon on Codex anymore — icons exist to tell Claude's two windows apart.
- [ ] **Step 4: Settings table** — add the `usageQuotaBar.paceTolerance` row (default `5`).
- [ ] **Step 5: Keep** install / requirements / privacy / build sections; adjust any "5h + 7d for both providers" phrasing; keep the live-demo link.
- [ ] **Step 6: Commit** — `git add README.md && git commit -m "docs: README for v1.2 weekly-only Codex"`

---

### Task 5: Ship v1.2.0 (orchestrator, not a Codex agent)

**Files:**
- Modify: `package.json` (version → `1.2.0`), `build-vsix.sh` (manifest `<Description>` → match new package.json description)

- [ ] **Step 1:** Clean-context adversarial test pass (sub-agent, told only the goal + spec, not the implementation).
- [ ] **Step 2:** Live smoke test with real local auth: fetchCodex + renderCodex against the production endpoint; confirm segment string.
- [ ] **Step 3:** Bump version to 1.2.0; update build-vsix.sh description; `./build-vsix.sh` → `usage-quota-bar-1.2.0.vsix`; remove stale 1.1.x vsix files from the repo.
- [ ] **Step 4:** `node test/lib.test.js && node test/refresh.test.js && node test/codex.test.js` — all green.
- [ ] **Step 5:** Commit remaining files (spec, plan, vsix, version bump), push to `origin main`.
- [ ] **Step 6:** GitHub release `v1.2.0` (gh CLI) with the .vsix attached and notes explaining OpenAI's weekly-only change; verify GitHub Pages demo updated; verify release + README render on github.com.
