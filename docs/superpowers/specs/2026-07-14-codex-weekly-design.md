# Codex weekly-only redesign — v1.2.0 design spec

**Date:** 2026-07-14 · **Status:** approved (Direction A + Spark line, picked by Evan)
· **Mockups:** https://claude.ai/code/artifact/bf01a4a4-9c16-4b55-8638-c30cf7493f56

## Why

OpenAI removed Codex's 5-hour session limit; Codex now has a single 7-day limit.
`GET chatgpt.com/backend-api/wham/usage` changed shape (verified live 2026-07-14):

- **Before:** `rate_limit.primary_window` = 5h session, `rate_limit.secondary_window` = 7d weekly.
- **Now:** `primary_window` = **7d weekly** (`limit_window_seconds: 604800`), `secondary_window` = **null**.

The extension maps primary→5h segment and secondary→weekly segment, so the Codex
item permanently renders `🗓 — (?)` (null weekly) and hides the real weekly data.

The response also now exposes `additional_rate_limits[]` (observed: a separate
weekly limit named `GPT-5.3-Codex-Spark`) and `rate_limit_reset_credits`.

## What the Codex segment becomes

Codex drops "quiet until it matters" and is **always visible** with four facts:

```
🟢 Codex  78% (5d) 🔥4
```

1. **Remaining %** of the weekly limit (`100 − used_percent`, rounded, floored at 0).
2. **Days left** until reset — existing `fmtLong`: `5d` (floor); under 1 day → hours/minutes (`19h`, `42m`).
3. **Pace verdict** (Direction A — heat glyph):
   - `🔥` appended when burning **faster** than pace
   - `🧊` appended when **slower** than pace (surplus)
   - **nothing** when on pace (stays quiet and narrow)
4. **Rate-limit reset credits** (`rate_limit_reset_credits.available_count`),
   shown only when > 0: the number sits directly after the pace emoji (`🔥4`);
   when on pace (no emoji) it renders as `↺4` so the count doesn't float alone.

**No 🗓 icon for Codex** (Evan's call): the ⏱/🗓 anchors exist to tell two windows
apart; Codex now has one limit, so the icon is redundant. Claude keeps both icons.

Dot/item color unchanged in meaning, keyed to weekly remaining only:
🟢 >30 · 🟡 ≤30 · 🔴 ≤10 (`dotFor`/`colorFor` as today). Error state unchanged: `⚪ Codex —`.

**Claude's item is untouched** — still 5h + 7d, still reveal-gated.

## Pace model

```
on_pace_remaining = time_left / window × 100     // straight-line burn
δ = actual_remaining − on_pace_remaining
δ < −tol → faster than pace (🔥) · |δ| ≤ tol → on pace · δ > +tol → slower (🧊)
```

Tolerance `tol` ships as setting **`usageQuotaBar.paceTolerance`**, default **5**
(points of the weekly limit). Reuses the existing `paceLine` helper.

## Fetch: shape detection

In `fetchCodex`:

- If `rate_limit.secondary_window` is **null/absent** → **weekly-only mode**: read
  `primary_window` as the weekly window (`win` falls back to 604800).
- If both windows present → **legacy mode**, current behavior (some accounts may
  still be on the old API during rollout).
- Weekly-only result shape:
  `{ weekly: {rem, reset, win}, spark: {name, rem, reset} | null, resets: number | null }`,
  where `spark` comes from `additional_rate_limits[0].rate_limit.primary_window`
  and `resets` from `rate_limit_reset_credits.available_count` when present.
  Legacy shape stays `{ five, seven }`.

## Hover tooltip (weekly-only mode)

```
Codex
Weekly: 78% left · resets Mon 9:12 AM (5d left)
🔥 Pace: −6 vs even burn (on-pace 84%)
↺ Rate-limit resets available: 4
⚡ Spark: 100% left · resets Tue 10:16 AM
```

- Pace line always present; verb matches verdict (`🔥 Pace: −6 …` / `Pace: on track (+2 vs even burn)` / `🧊 Pace: +41 …` — exact copy up to implementer, must state δ and on-pace %).
- Resets line only when `available_count` is present (0 is fine to show here even though the bar hides it).
- Spark line only when the API reports it (Evan opted in).
- **Stability rules carry over** (vscode#128887 hover-flash work): absolute
  minute-rounded reset clocks, no live countdowns, rewrites gated on material
  change via the `nextTooltip` mechanism extended for the weekly-only snapshot:
  reset epoch moved ≥2 min, rem drift ≥ driftPct, **pace verdict flip**, spark
  appear/disappear, or error flip.

## Settings

| Setting | Default | Change |
|---|---|---|
| `usageQuotaBar.paceTolerance` | `5` | **new** — ± points vs even burn counted as on-pace |
| everything else | — | unchanged |

## Tests

- Real captured 2026-07-14 payload as fixture (weekly-only, secondary null, Spark present).
- Legacy two-window payload still parses (regression).
- Pace boundaries: δ exactly ±tol → on pace; just beyond → 🔥/🧊.
- fmtLong day/hour boundaries; rem clamping; error/logged-out path.
- Tooltip gate: verdict flip is material; sub-threshold drift is not; reset-credit
  count change is material (it moves in whole units, rarely).
- Reset credits: hidden at 0/absent in the bar; `🔥4` when a pace emoji is shown, `↺4` when on pace.

## Docs & ship

- README: rewrite Codex sections — what OpenAI changed, the always-on segment, glyph legend, new setting.
- docs/index.html demo: Codex side becomes weekly-only (used % + elapsed sliders, pace verdict in the why-panel).
- Version **1.2.0** → `./build-vsix.sh` → commit, push, GitHub release with notes for existing users.

## Execution

Each piece implemented by a **Codex GPT-5.5 sub-agent** (codex-build skill);
Claude specs, reviews, verifies; clean-context sub-agent runs the adversarial
test pass before ship.
