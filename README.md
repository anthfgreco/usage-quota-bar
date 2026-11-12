# Usage Quota Bar — Claude Code + Codex

A tiny VS Code status-bar indicator for your Claude Code and Codex subscription quota.

This fork keeps the original lightweight behavior but makes Codex pacing easier to manage:

- Spark is omitted from the Codex tooltip.
- Pace delta is shown as a signed percentage, e.g. `+2%` or `-8%`.
- Off-pace status-bar states include the delta directly, e.g. `🔥−8` / `🧊+9`.
- Hover shows precise time left, e.g. `6d 14h left`, while the status bar stays compact at `(6d)`.
- Hover shows the current 7-day target remaining percentage and `%/day` budget.
- Hover includes a separate Mon–Fri `Workweek` line showing workdays left, workweek delta/target (`0%` expected weekend burn), and `%/wd` allowance.
- The status-bar item is hover-only; use the command palette to refresh manually if needed.
- Reset credits stay separate as `↺N`.

Example status bar:

```text
🟢 Codex  96% (6d) ↺1
🟡 Codex  27% (2d) 🔥−9 ↺1
🟢 Codex  84% (1d) 🧊+63 ↺1
```

Example tooltip:

```text
Codex — 38% left (resets Fri 6:20 PM)
7-day (1d 21h left): 🧊 +11% vs 27% target · 19.9%/day
Mon–Fri (1.9 wd left): on track (0%) vs 38% target · 19.9%/wd
↺ 2 resets available · nearest expires Nov 30 (19d)
```

Status-bar pace remains the straight-line 7-day calculation (`on-pace remaining = time left / window * 100`), while the tooltip adds a Mon–Fri workweek breakdown (`workdays left / workdays in window * 100`):

```text
on-pace remaining = time left / window * 100
pace delta = actual remaining - on-pace remaining
```

The default ±5 point tolerance still controls whether the status bar shows 🔥 / 🧊.

## Install

In VS Code: `Ctrl+Shift+P` → `Extensions: Install from VSIX…` → choose the built VSIX.

## Build

Run `npm install` once, then `npm run build:vsix`. This creates
`usage-quota-bar-<version>.vsix` using the standard VS Code extension packager.

## Requirements

- Claude Code credentials in the normal local location.
- Codex credentials in `~/.codex/auth.json`.

## License

MIT; original project by achromichat.
