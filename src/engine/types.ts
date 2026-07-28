// Ported from thinking-orbs by Jakub Antalik (MIT) — engine/types.ts
//
// Engine-level contracts shared by every mode implementation. The web
// original had a single `ModeDraw(ctx, …)` per mode. The RN port splits
// that in two: a `precompute` that runs once per resolved preset on the
// JS thread (hoisting everything the original recomputed every frame),
// and a `build` worklet that runs each frame on the UI thread, filling a
// structure-of-arrays dot buffer — no captures beyond its parameters.

import type { Mat3 } from './core';

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
 * The per-frame inputs that are NOT fixed by the preset — the live audio
 * level and, for the voice mode, which behaviour is being blended into
 * which. Passed as one object (a reused per-runtime scratch, never
 * allocated per frame) so modes can grow inputs without changing every
 * signature.
 *
 * The six ported modes ignore this entirely.
 */
export interface ModeDynamics {
  /** Smoothed audio level, 0–1. `0` when no amplitude is being driven. */
  amp: number;
  /** Behaviour index being blended FROM (see `voice.ts`). */
  from: number;
  /** Behaviour index being blended TO. */
  to: number;
  /** Blend position: 0 = fully `from`, 1 = fully `to`. */
  mix: number;
  /**
   * Extra yaw in radians, added to whatever rotation the mode already
   * applies. Meant for device orientation: because it enters the
   * PROJECTION rather than being a transform on the rendered view, the far
   * side of the globe genuinely rotates into sight. A transform on the
   * container can only skew the finished 2-D picture, which reads as a
   * tilted photograph of a sphere rather than a sphere being tilted.
   *
   * `0` when nothing is driving it — every mode adds it unconditionally,
   * and adding zero is free.
   */
  yaw: number;
  /** Extra pitch in radians, added to the mode's own tilt. Same contract. */
  pitch: number;
  /**
   * Extra roll in radians about the VIEW axis — leans the globe's pole
   * sideways on screen. Independent of `yaw`/`pitch`: it is applied after
   * projection and does not touch depth.
   */
  roll: number;
  /**
   * The globe's own orientation, applied to each point BEFORE `yaw`,
   * `pitch` and `roll`. `null` when nothing is driving it.
   *
   * This is the difference between turning the globe and turning the
   * camera. The three angles above are camera-side — the mode's idle spin
   * and the device's parallax — and they compose by addition because each
   * is a small independent nudge about a fixed axis. An orientation cannot
   * work that way: adding Euler angles is not composing rotations, so a
   * caller wanting "spin the globe about whatever axis this force implies,
   * from wherever it currently is" has no way to express it through them.
   * A matrix does, and it costs nine multiplies per dot only when supplied.
   */
  orient: Mat3 | null;
}

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
  staticData: any,
  dyn: ModeDynamics
) => void;

export interface ModeImpl {
  precompute: ModePrecompute;
  build: ModeBuild;
}
