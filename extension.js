"use strict";
// Usage Quota Bar — Claude Code + Codex subscription quota in the VS Code status bar.
// Claude stays quiet until its 5h/7d windows matter; Codex is weekly-only and
// always shows remaining %, days left, pace glyph, and reset credits.
// Icon anchors: ⏱ = 5h session, 🗓 = 7d week for multi-window providers.
// No dollars, no tokens. Zero npm deps. Reads local auth at runtime; embeds no secret.

const vscode = require("vscode");
const https = require("https");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { execFile } = require("child_process");
const L = require("./lib");

const CLOCK = "⏱"; // 5h session window
const CAL = "🗓"; // 7d weekly window
const WIN5 = 5 * 3600; // 5h in seconds
const WIN7 = 7 * 24 * 3600; // 7d in seconds

// reveal tuning (see spec). fiveFloor is user-configurable.
// fastMargin 15 (not 5): the linear pace line sits near 100% early in a rolling
// 7d window, so a tight margin falsely reads normal early-week use as "too fast".
// Proper fix is the velocity model (spec §3a); 15 is a pragmatic default for now.
const O7 = { fastMargin: 15, soonFrac: 2 / 7, high: 50, scarce: 25 };

// Claude OAuth refresh — values lifted verbatim from the Claude Code binary so we
// speak its exact protocol. Claude Code's cached access token expires ~8h out and is
// only refreshed by Claude Code itself; when it sits idle the token goes stale and our
// probe 401s (the "white dot" bug). We refresh it ourselves, but ONLY within REFRESH_GRACE
// of expiry — while Claude Code is active it keeps the token fresh, so this never fires
// then, which means we never race Claude Code's own refresh. The refresh endpoint often
// returns no new refresh_token (no rotation); when it does, we write it back so Claude
// Code stays in sync. Refreshed creds are persisted to the same store we read from.
const CLAUDE_CLIENT_ID = "9d1c250a-e61b-44d9-88ed-5944d1962f5e"; // public Claude Code OAuth client
const CLAUDE_TOKEN_HOST = "platform.claude.com";
const CLAUDE_TOKEN_PATH = "/v1/oauth/token";
const REFRESH_GRACE_SEC = 600; // refresh when <10m from expiry (only true when Claude Code is idle)

function colorFor(rem) {
  if (rem == null) return new vscode.ThemeColor("charts.yellow");
  if (rem <= 10) return new vscode.ThemeColor("charts.red");
  if (rem <= 30) return new vscode.ThemeColor("charts.yellow");
  return new vscode.ThemeColor("charts.green");
}

// tooltip writes are gated by L.nextTooltip — VS Code disposes an open hover whenever
// the tooltip string changes (vscode#128887), so the string must be byte-stable across
// refreshes (L.tooltipFor) AND only rewritten on material quota change (L.nextTooltip):
// a provider under active use has genuine ~1%/min data churn that would otherwise
// rewrite (and kill the hover) every tick. text/color updates are hover-safe.

// ---- credential readers --------------------------------------------------
const CLAUDE_FILE = () => path.join(os.homedir(), ".claude", ".credentials.json");
const CLAUDE_KEYCHAIN_SERVICE = "Claude Code-credentials";

// Parse a credentials JSON blob into our shape, tagging where it came from so we can
// write the refreshed token back to the same store. Returns null if unusable.
function parseClaudeCreds(jsonStr, source, account) {
  try {
    const raw = JSON.parse(jsonStr);
    const o = raw.claudeAiOauth || raw;
    if (!o || !o.accessToken) return null;
    return {
      accessToken: o.accessToken,
      refreshToken: o.refreshToken || null,
      expiresAt: typeof o.expiresAt === "number" ? o.expiresAt : null, // ms epoch
      raw, source, account,
    };
  } catch (_) { return null; }
}

// Read full Claude creds (token + refresh token + expiry + provenance). File first,
// then macOS Keychain. We also grab the Keychain account name so write-back targets
// the exact same item.
function readClaudeCreds() {
  try {
    const c = parseClaudeCreds(fs.readFileSync(CLAUDE_FILE(), "utf8"), "file", null);
    if (c) return Promise.resolve(c);
  } catch (_) {}
  if (process.platform !== "darwin") return Promise.resolve(null);
  return new Promise((resolve) => {
    execFile("security",
      ["find-generic-password", "-s", CLAUDE_KEYCHAIN_SERVICE, "-w"],
      (err, secret) => {
        if (err) return resolve(null);
        // separate call (no -w) to recover the account attr for write-back
        execFile("security",
          ["find-generic-password", "-s", CLAUDE_KEYCHAIN_SERVICE],
          (e2, attrs) => {
            let account = os.userInfo().username;
            const m = !e2 && /"acct"<blob>="([^"]*)"/.exec(attrs);
            if (m) account = m[1];
            resolve(parseClaudeCreds(secret.trim(), "keychain", account));
          });
      });
  });
}

// Persist refreshed creds back to whichever store we read them from, preserving the
// surrounding JSON shape. Keychain update via `add-generic-password -U` is silent and
// non-destructive (verified). Best-effort: a failed write just means we refresh again
// next cycle. Returns a promise that always resolves.
function writeClaudeCreds(creds, updated) {
  const out = creds.raw && creds.raw.claudeAiOauth ? creds.raw : { claudeAiOauth: {} };
  const t = out.claudeAiOauth || out;
  t.accessToken = updated.accessToken;
  if (updated.refreshToken) t.refreshToken = updated.refreshToken;
  t.expiresAt = updated.expiresAt;
  const json = JSON.stringify(out);
  if (creds.source === "file") {
    try { fs.writeFileSync(CLAUDE_FILE(), json, { mode: 0o600 }); } catch (_) {}
    return Promise.resolve();
  }
  return new Promise((resolve) => {
    execFile("security",
      ["add-generic-password", "-U", "-a", creds.account || os.userInfo().username,
       "-s", CLAUDE_KEYCHAIN_SERVICE, "-w", json],
      () => resolve());
  });
}

// Exchange the refresh token for a fresh access token, write it back, return the new
// token. Single-flight so overlapping refreshes (e.g. fast manual clicks) collapse to one
// network call. Throws on any failure so the caller can fall back to the stale token.
let claudeRefreshInFlight = null;
function refreshClaudeToken(creds) {
  if (!creds.refreshToken) return Promise.reject(new Error("no refresh token"));
  if (claudeRefreshInFlight) return claudeRefreshInFlight;
  claudeRefreshInFlight = (async () => {
    const body = JSON.stringify({
      grant_type: "refresh_token",
      refresh_token: creds.refreshToken,
      client_id: CLAUDE_CLIENT_ID,
    });
    const res = await request({
      method: "POST", hostname: CLAUDE_TOKEN_HOST, path: CLAUDE_TOKEN_PATH,
      headers: {
        "content-type": "application/json",
        "anthropic-beta": "oauth-2025-04-20",
        "content-length": Buffer.byteLength(body),
      },
    }, body);
    if (res.status !== 200) throw new Error(`refresh HTTP ${res.status}`);
    const j = JSON.parse(res.body);
    if (!j.access_token) throw new Error("refresh: no access_token in response");
    const updated = {
      accessToken: j.access_token,
      refreshToken: j.refresh_token || creds.refreshToken, // omitted => no rotation, keep old
      expiresAt: Date.now() + (j.expires_in ? j.expires_in * 1000 : WIN5 * 1000),
    };
    await writeClaudeCreds(creds, updated);
    return updated.accessToken;
  })();
  return claudeRefreshInFlight.finally(() => { claudeRefreshInFlight = null; });
}

function readCodexAuth() {
  try {
    const p = path.join(os.homedir(), ".codex", "auth.json");
    const j = JSON.parse(fs.readFileSync(p, "utf8"));
    const tokens = j.tokens || j;
    const access = tokens.access_token || j.access_token;
    let account = tokens.account_id || j.account_id || j.accountId;
    if (!account && tokens.id_token) account = L.accountFromJwt(tokens.id_token);
    if (access) return { access, account };
  } catch (_) {}
  return null;
}

// ---- HTTP ----------------------------------------------------------------
function request(opts, body) {
  return new Promise((resolve, reject) => {
    const req = https.request(opts, (res) => {
      let data = "";
      res.on("data", (c) => (data += c));
      res.on("end", () => resolve({ status: res.statusCode, headers: res.headers, body: data }));
    });
    req.on("error", reject);
    req.setTimeout(15000, () => req.destroy(new Error("timeout")));
    if (body) req.write(body);
    req.end();
  });
}

// fetchers return { five:{rem,reset,win}, seven:{rem,reset,win} } or { error }
async function fetchClaude() {
  const creds = await readClaudeCreds();
  if (!creds) return { error: "no Claude credentials found" };
  let token = creds.accessToken;
  // Self-heal the stale-token "white dot": if the cached token is at/near expiry
  // (only happens when Claude Code has been idle), refresh it ourselves before probing.
  let refreshFailed = false;
  if (creds.expiresAt != null && Date.now() >= creds.expiresAt - REFRESH_GRACE_SEC * 1000) {
    try { token = await refreshClaudeToken(creds); }
    catch (_) { refreshFailed = true; }
  }
  const body = JSON.stringify({
    model: "claude-haiku-4-5-20251001", max_tokens: 1,
    messages: [{ role: "user", content: "." }],
  });
  const res = await request({
    method: "POST", hostname: "api.anthropic.com", path: "/v1/messages",
    headers: {
      "content-type": "application/json", "anthropic-version": "2023-06-01",
      "anthropic-beta": "oauth-2025-04-20", authorization: `Bearer ${token}`,
      "content-length": Buffer.byteLength(body),
    },
  }, body);
  const h = res.headers;
  const fiveUsed = L.parseUtil(h["anthropic-ratelimit-unified-5h-utilization"]);
  const sevenUsed = L.parseUtil(h["anthropic-ratelimit-unified-7d-utilization"]);
  if (fiveUsed == null && sevenUsed == null) {
    if (refreshFailed || res.status === 401)
      return { error: "token expired — open Claude Code to re-auth" };
    return { error: `no quota headers (HTTP ${res.status})` };
  }
  const rem = (u) => (u == null ? null : Math.max(0, Math.round(100 - u)));
  return {
    five: { rem: rem(fiveUsed), reset: L.parseResetHeader(h["anthropic-ratelimit-unified-5h-reset"]), win: WIN5 },
    seven: { rem: rem(sevenUsed), reset: L.parseResetHeader(h["anthropic-ratelimit-unified-7d-reset"]), win: WIN7 },
  };
}

async function fetchCodex() {
  const auth = readCodexAuth();
  if (!auth || !auth.access) return { error: "no Codex credentials found" };
  const headers = { authorization: `Bearer ${auth.access}` };
  if (auth.account) headers["chatgpt-account-id"] = auth.account;
  const res = await request({
    method: "GET", hostname: "chatgpt.com", path: "/backend-api/wham/usage", headers,
  });
  let j;
  try { j = JSON.parse(res.body); } catch (_) { return { error: `bad response (HTTP ${res.status})` }; }
  return L.parseCodexUsage(j, res.status);
}

// Reset-credit details live on a separate endpoint. Credits change rarely, so
// don't hit it every 60s refresh: refetch only when the count from the main
// usage call changes, or hourly as a staleness backstop. Failures keep the
// count-only tooltip line (cache marked fresh so we don't hammer a broken
// endpoint every tick).
let creditsCache = { key: null, at: 0, nearestExpiry: null };
async function fetchCodexCreditsExpiry(count) {
  if (creditsCache.key === count && Date.now() - creditsCache.at < 3600e3)
    return creditsCache.nearestExpiry;
  creditsCache = { key: count, at: Date.now(), nearestExpiry: creditsCache.nearestExpiry };
  try {
    const auth = readCodexAuth();
    if (!auth || !auth.access) return creditsCache.nearestExpiry;
    const headers = { authorization: `Bearer ${auth.access}` };
    if (auth.account) headers["chatgpt-account-id"] = auth.account;
    const res = await request({
      method: "GET", hostname: "chatgpt.com",
      path: "/backend-api/wham/rate-limit-reset-credits", headers,
    });
    const det = L.parseCreditsDetail(JSON.parse(res.body));
    creditsCache.nearestExpiry = det.nearestExpiry;
  } catch (_) {}
  return creditsCache.nearestExpiry;
}

// ---- status bar (one item per provider) ----------------------------------
let items = {}; // claude, codex
const tipSnaps = {}; // per provider: snapshot committed with the shown tooltip (lib.nextTooltip)

function renderProvider(it, name, d, fiveFloor, nowMs = Date.now()) {
  // tooltip first, via the rewrite gate — an unchanged string leaves an open hover alive
  const t = L.nextTooltip(tipSnaps[name] || null, name, d, nowMs);
  if (t) { it.tooltip = t.tooltip; tipSnaps[name] = t.snap; }
  if (d.error) {
    it.text = `⚪ ${name} —`;
    it.color = colorFor(null);
    return;
  }
  const f = d.five, s = d.seven;
  const worst = Math.min(f.rem == null ? 101 : f.rem, s.rem == null ? 101 : s.rem);
  const parts = [`${L.dotFor(worst === 101 ? null : worst)} ${name}`];
  if (L.reveal5h(f.rem, f.reset, f.win, { floor: fiveFloor, fastMargin: 12 })) {
    parts.push(`${CLOCK} ${f.rem == null ? "—" : f.rem + "%"} (${L.fmtShort(f.reset)})`);
  }
  if (L.reveal7d(s.rem, s.reset, s.win, O7)) {
    parts.push(`${CAL} ${s.rem == null ? "—" : s.rem + "%"} (${L.fmtLong(s.reset)})`);
  }
  it.text = parts.join("  "); // two spaces between windows; icons self-segment
  it.color = colorFor(worst === 101 ? null : worst);
}

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

async function loadCodexData() {
  const d = await fetchCodex();
  if (d.weekly && d.resets > 0) d.resetsExpiry = await fetchCodexCreditsExpiry(d.resets);
  else d.resetsExpiry = null;
  return d;
}

async function refresh() {
  const cfg = vscode.workspace.getConfiguration("usageQuotaBar");
  const fiveFloor = cfg.get("fiveFloor", 50);

  if (cfg.get("showClaude", true)) {
    items.claude.show();
    try { renderProvider(items.claude, "Claude", await fetchClaude(), fiveFloor); }
    catch (e) { renderProvider(items.claude, "Claude", { error: e.message }, fiveFloor); }
  } else items.claude.hide();

  if (cfg.get("showCodex", true)) {
    items.codex.show();
    const opt = { tol: cfg.get("paceTolerance", 5), fiveFloor };
    try { renderCodex(items.codex, "Codex", await loadCodexData(), opt); }
    catch (e) { renderCodex(items.codex, "Codex", { error: e.message }, opt); }
  } else items.codex.hide();
}

let timer = null;
function scheduleLoop() {
  if (timer) clearInterval(timer);
  const secs = Math.max(15, vscode.workspace.getConfiguration("usageQuotaBar").get("refreshSeconds", 60));
  timer = setInterval(refresh, secs * 1000);
}

function activate(context) {
  // priority desc => Claude left of Codex on the right side
  items.claude = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
  items.codex = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 99);
  for (const k of Object.keys(items)) {
    items[k].text = "…";
    context.subscriptions.push(items[k]);
  }
  context.subscriptions.push(
    vscode.commands.registerCommand("usageQuotaBar.refresh", refresh),
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration("usageQuotaBar")) { scheduleLoop(); refresh(); }
    })
  );
  refresh();
  scheduleLoop();
}

function deactivate() { if (timer) clearInterval(timer); }

module.exports = { activate, deactivate };
// test hooks (VS Code only invokes activate/deactivate; exposing these is harmless and
// lets the credential/refresh paths be exercised without a VS Code host).
module.exports._internal = { readClaudeCreds, refreshClaudeToken, fetchClaude, parseClaudeCreds, renderProvider, fetchCodex, fetchCodexCreditsExpiry, renderCodex, loadCodexData };
