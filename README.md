# Usage Quota Bar — Claude Code + Codex

A tiny VS Code status-bar indicator for your **Claude Code** and **Codex**
**subscription** quota — shown as **% remaining**, with different behavior per
provider:

```
Claude (quiet until it matters):   🟢 Claude        🟡 Claude  ⏱ 12% (4h19m)
Codex (always on, weekly):         🟢 Codex  78% (5d) 🔥4      🔴 Codex  6% (1d)
```

- **Claude is unchanged:** rolling **5-hour** + **7-day** windows, quiet until it
  matters, using **⏱ / 🗓** so the two windows are easy to tell apart.
- **Codex is weekly-only in v1.2:** one always-on segment. No 🗓 icon, because
  there is only one Codex limit now.
- **Dot** = remaining quota: 🟢 >30% · 🟡 ≤30% · 🔴 ≤10%.

### What changed in v1.2

In July 2026, OpenAI removed Codex's 5-hour session window. Codex now has a
single weekly limit. The API moved weekly data into the slot older extension
versions treated as the 5h window, and nulled the old weekly slot, so old builds
show Codex as `🗓 — (?)`. Upgrade to v1.2.0 or later: it parses the new shape and
still falls back to the old two-window rendering for accounts not yet migrated.

### ▶ Try it live (no install)

**[Open the interactive demo →](https://achromichat.github.io/usage-quota-bar/)**
— drag the sliders and watch the status bar react. The demo now simulates the new
always-on Codex weekly segment.

## Codex segment

```
🟢 Codex  78% (5d) 🔥4
```

- `78%` = weekly limit remaining.
- `(5d)` = days until reset, floored; under 1 day → hours/minutes.
- `🔥` = faster than even weekly burn; `🧊` = slower/surplus; no glyph = on pace.
- Reset credits ride the glyph (`🔥4` / `🧊4`), show as `↺4` when on pace, and
  are hidden at 0.

Pace is straight-line burn across 7 days:

```
on-pace remaining = time left / window * 100
δ = actual remaining - on-pace remaining
```

`δ < -tolerance` → 🔥, `δ > +tolerance` → 🧊, otherwise on pace. Default tolerance
is ±5 points (`usageQuotaBar.paceTolerance`). Hover shows exact reset day/time,
δ vs even burn with the on-pace %, reset credits available, and the extra
`GPT-5.3-Codex-Spark` weekly limit when the API reports one.

## When does a window appear? (Claude only)

Claude is unchanged: 5h + 7d windows, quiet until a window matters, with ⏱/🗓
icons so the two windows are distinct. It reveals when:

- **5h:** at/under the floor (default **50%**) **or** burning faster than pace.
- **7d:** burning too fast for the week, **or** holding surplus you'll waste
  before reset, **or** genuinely scarce (≤25%).

Codex does not use reveal rules anymore. Its weekly segment is always on.

## Install

1. Download the latest `usage-quota-bar-X.Y.Z.vsix` from the
   [**Releases**](https://github.com/achromichat/usage-quota-bar/releases) page.
2. In VS Code: `Cmd/Ctrl+Shift+P` → **Extensions: Install from VSIX…** → pick the file.
   (Or from a terminal: `code --install-extension usage-quota-bar-X.Y.Z.vsix`.)
3. Reload the window. The items appear on the right of the status bar.

## Requirements

You need to be **logged in locally** to whichever you want to track:

- **Claude Code** — reads `~/.claude/.credentials.json` (or the macOS Keychain item
  `Claude Code-credentials`).
- **Codex** — reads `~/.codex/auth.json`.

If a provider isn't set up, just turn it off with `usageQuotaBar.showClaude` /
`usageQuotaBar.showCodex`.

## Settings

| Setting | Default | What |
|---|---|---|
| `usageQuotaBar.refreshSeconds` | `60` | Refresh interval (min 15). |
| `usageQuotaBar.fiveFloor` | `50` | Claude's 5h window reveals at/below this % remaining. |
| `usageQuotaBar.paceTolerance` | `5` | ± points of the weekly limit counted as on-pace for Codex. |
| `usageQuotaBar.showClaude` | `true` | Show the Claude item. |
| `usageQuotaBar.showCodex` | `true` | Show the Codex item. |

## Privacy & honest caveats

- **No telemetry, no servers of mine.** Your credentials are read locally and used
  only to ask each provider for *your own* quota.
- **It uses each provider's own usage endpoint:** a 1-token `POST` to
  `api.anthropic.com` to read rate-limit headers (so it makes a tiny API call each
  refresh), and a `GET` to ChatGPT's usage endpoint for Codex.
- **These are unofficial/internal endpoints.** They can change or break without
  notice — if numbers stop showing, that's the likely cause (open an issue).
- Zero npm dependencies — just the VS Code API + Node built-ins.

## Build from source

No npm/vsce needed — a `.vsix` is just a zip:

```bash
npm test          # run the unit tests (plain node, no deps)
./build-vsix.sh   # produces usage-quota-bar-<version>.vsix
```

## License

[MIT](./LICENSE)
