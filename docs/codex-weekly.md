# Codex Weekly-Only Quota Redesign

## Overview

In July 2026, OpenAI removed Codex's 5-hour session limit in favor of a single 7-day weekly quota. The `/backend-api/wham/usage` endpoint was updated accordingly:
- `rate_limit.primary_window`: 7-day weekly quota (`limit_window_seconds: 604800`).
- `rate_limit.secondary_window`: `null` (or absent).
- `rate_limit_reset_credits`: Available reset credit count.
- `additional_rate_limits[]`: Optional secondary models (e.g. `GPT-5.3-Codex-Spark`).

The extension adapts by replacing the two-window reveal behavior with an always-on status bar segment, while retaining legacy two-window fallback for unmigrated accounts.

---

## Status Bar Segment

```text
🟢 Codex  78% (5d) 🔥4
```

1. **Indicator Dot**: Color-coded by remaining quota (🟢 >30%, 🟡 ≤30%, 🔴 ≤10%, ⚪ error).
2. **Quota Remaining**: Rounded percentage (`100 − used_percent`).
3. **Reset Time**: Formatted duration until weekly reset (`5d`, or `19h`/`42m` when <1 day).
4. **Pace Glyph**:
   - `🔥`: Burning faster than even pace (`δ < −tol`).
   - `🧊`: Burning slower than even pace / surplus (`δ > +tol`).
   - Omitted when on pace.
5. **Reset Credits**: Appended when >0 (`🔥4` after a pace glyph, or `↺4` when on pace).

*Note: The `🗓` icon is omitted for Codex because a single window requires no distinction icon (Claude retains `⏱`/`🗓`).*

---

## Pace Model

```text
on_pace_remaining = (time_left_seconds / window_seconds) × 100
δ = actual_remaining − on_pace_remaining
```

- **Tolerance**: Configured via `usageQuotaBar.paceTolerance` (default: `5` points).
- **Verdicts**:
  - `δ < −tol`: Hot (`🔥`)
  - `|δ| ≤ tol`: On track (no glyph)
  - `δ > +tol`: Cool (`🧊`)

---

## Tooltip & Stability

### Hover Tooltip Layout

```text
Codex
Weekly: 78% left · resets Mon 9:12 AM (5d left)
🔥 Pace: −6 vs even burn (on-pace 84%)
↺ Rate-limit resets available: 4 · nearest expires Jul 18 (4d)
⚡ Spark: 100% left · resets Tue 10:16 AM
```

### Hover-Stability Contract

To prevent tooltip flicker (vscode#128887):
- Minute-rounded absolute reset timestamps (no live per-second countdowns).
- Gated rewrites via `nextTooltipWeekly`: Tooltip is re-rendered only on material changes (reset time shifted ≥2 min, quota drift ≥5%, pace verdict flipped, reset credit count/expiry changed, or error state transitioned).

---

## Architecture & Implementation

- **`lib.js`**: Pure functional helpers for parsing (`parseCodexUsage`, `parseCreditsDetail`), pace calculations (`paceDelta`, `paceState`, `fmtSigned`), segment formatting (`codexSegment`), and tooltip caching (`nextTooltipWeekly`).
- **`extension.js`**: API data fetching (`fetchCodex`), shape detection, and status bar rendering (`renderCodex`).
- **Tests**: Direct Node test runners (`test/lib.test.js`, `test/codex.test.js`, `test/refresh.test.js`).
