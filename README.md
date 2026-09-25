# Usage Quota Bar — Claude Code + Codex

A tiny VS Code status-bar indicator for your Claude Code and Codex subscription quota.

This fork keeps the original lightweight behavior but makes Codex pacing easier to manage:

- Spark is omitted from the Codex tooltip.
- Pace delta is shown as a signed percentage, e.g. `+2%` or `-8%`.
- Off-pace status-bar states include the delta directly, e.g. `🔥−8` / `🧊+9`.
- Hover shows precise time left, e.g. `6d 14h left`, while the status bar stays compact at `(6d)`.
- Hover shows the current target remaining percentage.
- Hover shows the sustainable remaining budget in `%/day` until reset.
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
Codex
Weekly: 96% left · resets Thu 12:47 PM · 6d 14h left
Pace: on track (+2%) · target 94% remaining now
Budget: 14.9%/day until reset
↺ Rate-limit resets available: 1 · nearest expires Oct 22 (28d)
```

Pace remains the original straight-line 7-day calculation:

```text
on-pace remaining = time left / window * 100
pace delta = actual remaining - on-pace remaining
```

The default ±5 point tolerance still controls whether the status bar shows 🔥 / 🧊.

## Install

In VS Code: `Ctrl+Shift+P` → `Extensions: Install from VSIX…` → choose the built VSIX.

## Requirements

- Claude Code credentials in the normal local location.
- Codex credentials in `~/.codex/auth.json`.

## License

MIT; original project by achromichat.
