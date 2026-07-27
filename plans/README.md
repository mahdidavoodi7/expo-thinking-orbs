# Animation & performance plans

Findings from an audit of the voice orb work at commit `596a089`. Only plans
marked with a file have been written; the rest are vetted findings awaiting
selection.

## Written plans

| # | Title | Severity | Category | Status |
| --- | --- | --- | --- | --- |
| [001](001-drawatlas-batching.md) | Batch dot drawing into a single `drawAtlas` call | HIGH | Performance | TODO |

## Already landed (not plans — applied directly)

| Change | Why |
| --- | --- |
| `CADisableMinimumFrameDuration` in `example/app.json` + README section | iOS caps `CADisplayLink` at 60 fps on ProMotion without it. Nothing else in this list can matter until this is set. |
| Counting sort replacing the comparator sort in `src/engine/paint.ts` | ~4,300 JS closure calls per frame → three linear passes. Equal-z emission order preserved (the flat morph outline depends on it). |
| Cached bounds `SkRect` in `src/engine/paint.ts` | One native allocation per frame removed; `size` changes on remount, not per frame. |

## Vetted findings, no plan written yet

Ordered by leverage. Say which you want and it becomes a plan.

| # | Severity | Category | Location | Finding |
| --- | --- | --- | --- | --- |
| ~~A~~ | — | — | — | **FIXED** in `586d81d`. Note the original characterisation was wrong: the phase offset at the reversal does grow with uptime, but `ripplePulse` has period TAU, so the *visible* jump is bounded and identical at t = 1 s and t = 86400 s (measured 0.6238 both). It was a snap on every barge-in, not a late-session latent bug, and the bounded-shear rule was **not** violated. Worst single-frame crest jump 0.6238 → 0.0487. |
| ~~B~~ | — | — | — | **FIXED** in `586d81d`. Losing the amplitude source is now a target of 0 rather than an assignment of 0, releasing through the existing one-pole filter (1/e at 233 ms against `RELEASE_MS = 240`). Removed one `useEffect`. |
| C | MEDIUM | Interruptibility | `src/useThinkingOrbPicture.ts` | **PARTLY FIXED** in `d38ebe3` — now starts the new blend from whichever endpoint the pose is nearer, halving the worst-case jump (\|B−A\| → 0.5·\|B−A\|). Not eliminated: the on-screen pose is a lerp of two behaviours and `from` can only name one. Full fix needs a three-way blend, or snapshotting the current per-ring pose and blending from that — the snapshot must be per-orb, since the engine's scratch buffers are shared across orbs on `globalThis`. |
| ~~D~~ | — | — | — | **FIXED.** Reduced motion no longer freezes; it runs at `REDUCED_SPEED = 0.3` with the voice level held at `REDUCED_AMP = 0.85`. The distinction is restored through **tempo**, not instantaneous shape: rate of change per second is `idle` 0.012, `listening` 0.040, `thinking` 0.082, `speaking` 0.192 — a 3.4× separation on the pair that a still frame could not separate at all. Instantaneous shape RMS for `idle` vs `listening` is essentially unchanged (0.041 mean vs 0.043 frozen), which is exactly why freezing failed. **Behaviour change for the six non-voice animations too** — they previously rendered a static frame under reduced motion and now animate slowly. |
| E | MEDIUM | Cohesion | `src/engine/voice.ts:321-323` | `idle` hand-inlines an exact copy of `waveW(t * 0.5, ri)` (`2.1 × 0.5 = 1.05`, `1.27 × 0.5 = 0.635`, coefficients byte-identical to lines 77–79). A future tweak to `waveW` silently desynchronises `idle` from `thinking`. |
| F | MEDIUM | Cohesion | `src/engine/voice.ts:110` and 5 call sites | `WAVE_BASE = 0.88`, documented as "the family's scale", is used by only 2 of 8 behaviours. The rest hardcode near-neighbours: `0.9` (213, 245, 324), `0.78` (228), `0.85` (258), `0.8` (309). Retuning the family scale in one place is currently impossible. |
| G | LOW | Performance | `src/engine/voice.ts:423, 449-452` | `listening` sets `spike = -(0.05 + 0.17 * amp)`, non-zero at silence, so the per-dot `Math.sqrt` + `ripplePulse` runs for every dot every frame even with no voice present — for a 0.05 displacement. Note this is a **visual** change if "fixed", not a pure win: the faint ripple is presumably deliberate. |
| H | LOW | Performance | `src/engine/voice.ts:382` | `const p = new Float32Array(3);` per frame. Pre-existing house style (`lattice.ts:186`, `orbits.ts:102`, `ribbon.ts:98` all match), so fixing it here alone adds inconsistency — but it contradicts `paint.ts`'s header claim that a frame "allocates only the picture itself", and `voice.ts` itself caches `ra`/`rb` on `globalThis` at 344–354 to avoid exactly this. |
| I | LOW | Doc drift | `src/engine/profiles.ts:130`, `src/useThinkingOrbPicture.ts:212` | "One row for all five voice states" — there are eight behaviours and nine states. "420ms of travel" — `BLEND_MS` is 280. |

## Categories audited clean

Purpose & frequency; easing & duration (`BLEND_MS = 280` is inside the <300 ms
budget, `ATTACK_MS`/`RELEASE_MS` asymmetric in the correct direction); buffer
reuse in `scratch.ts`; `registry.ts`; `types.ts`; physicality (no `scale(0)`
equivalent — `RF_CEILING` is enforced and `initializing`'s scatter floor keeps
dots inside the shell).

**Bounded-shear rule** (never `t * rate` growing without limit): obeyed
everywhere except finding A. Every other travelling phase is `t * rate`
*inside* a periodic function, which is the correct form.

## Not verified

No change on this branch has been run on hardware. The simulator has no 120 Hz
mode and renders Skia through a different path, so any timing it reports is
misleading. Findings A, B and C are arithmetically derived and need to be
watched during a real barge-in to confirm they are perceptible.
