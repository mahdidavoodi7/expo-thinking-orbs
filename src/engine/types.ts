// Ported from thinking-orbs by Jakub Antalik (MIT) — engine/types.ts
//
// Engine-level contracts shared by every mode implementation. The web
// original had a single `ModeDraw(ctx, …)` per mode. The RN port splits
// that in two: a `precompute` that runs once per resolved preset on the
// JS thread (hoisting everything the original recomputed every frame),
// and a `build` worklet that runs each frame on the UI thread, filling a
// structure-of-arrays dot buffer — no captures beyond its parameters.

import type { DotBuffer } from './scratch';
import type { ModeOpts } from './profiles';

export type { DotBuffer } from './scratch';
export type { ModeOpts } from './profiles';

/**
 * Base shape of the time-independent data a mode hoists out of the
 * per-frame loop. Each mode extends this with its own precomputed tables.
 */
export interface ModeStaticData {
  /**
   * Exact number of dots the mode emits per frame — constant for a
   * resolved preset, so the {@linkcode DotBuffer} can be sized once.
   */
  dotCount: number;
}

/** Runs once per resolved preset, on the JS thread. */
export type ModePrecompute = (opts: ModeOpts) => ModeStaticData;

/**
 * One frame: fills `buf` (already reset to `count` 0) with the mode's dot
 * cloud at time `t` for the given rendered `size`. A Reanimated worklet —
 * it may only touch its parameters plus module-level worklet helpers.
 */
export type ModeBuild = (
  buf: DotBuffer,
  size: number,
  t: number,
  opts: ModeOpts,
  staticData: any
) => void;

export interface ModeImpl {
  precompute: ModePrecompute;
  build: ModeBuild;
}
