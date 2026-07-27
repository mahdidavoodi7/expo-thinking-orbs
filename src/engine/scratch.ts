// Ported from thinking-orbs by Jakub Antalik (MIT) — engine/scratch.ts
//
// Reusable per-runtime scratch storage for the render hot path. The web
// original allocated a fresh Dot object (plus a projection tuple) per dot
// per frame; at 60 fps × many orbs that is tens of thousands of short-
// lived objects per second on the UI-thread Hermes heap. Instead, dots
// live in structure-of-arrays Float32Array buffers that are created once
// per JS runtime and reused by every orb: the UI thread runs derived
// values sequentially and each build → record pass completes atomically
// inside one invocation, so a shared buffer can never interleave between
// orbs.

import type { ModeDynamics } from './types';

/**
 * Structure-of-arrays dot storage filled by a mode's `build` function
 * each frame and consumed by `recordPicture`.
 *
 * Acquired via {@linkcode acquireDotBuffer}. The buffer is a shared
 * per-runtime scratch: its contents are only valid until the next
 * `acquireDotBuffer` call, so build and paint from it before yielding.
 */
export interface DotBuffer {
  /** Projected x position per dot, in points. */
  xs: Float32Array;
  /** Projected y position per dot, in points. */
  ys: Float32Array;
  /** Depth per dot — painted far→near by ascending z. */
  zs: Float32Array;
  /** Rendered radius per dot, in points (floored at the mode's rMin). */
  rs: Float32Array;
  /** Ink value per dot: 0 = darkest ink on paper. Mirrored on dark themes. */
  ws: Float32Array;
  /** Alpha per dot (1 when the mode does not set one). */
  as: Float32Array;
  /** Number of dots written this frame. Reset by `acquireDotBuffer`. */
  count: number;
  /** Allocated capacity (grows, never shrinks). */
  capacity: number;
}

interface ScratchGlobal {
  __expoThinkingOrbsScratch?: DotBuffer;
  __expoThinkingOrbsDyn?: ModeDynamics;
}

/**
 * Return the runtime's shared {@linkcode ModeDynamics} record, with the
 * given per-frame values written into it. Reused rather than allocated so
 * a frame still allocates only the picture itself.
 */
export function acquireDynamics(
  amp: number,
  from: number,
  to: number,
  mix: number,
  yaw: number = 0,
  pitch: number = 0,
  roll: number = 0
): ModeDynamics {
  'worklet';
  const g = globalThis as ScratchGlobal;
  let d = g.__expoThinkingOrbsDyn;
  if (d === undefined) {
    d = { amp, from, to, mix, yaw, pitch, roll };
    g.__expoThinkingOrbsDyn = d;
    return d;
  }
  d.amp = amp;
  d.from = from;
  d.to = to;
  d.mix = mix;
  d.yaw = yaw;
  d.pitch = pitch;
  d.roll = roll;
  return d;
}

/**
 * Return the runtime's shared {@linkcode DotBuffer}, grown to at least
 * `capacity` dots, with `count` reset to 0. Callable from both the React
 * runtime and the Reanimated UI runtime — each keeps its own buffer.
 */
export function acquireDotBuffer(capacity: number): DotBuffer {
  'worklet';
  const g = globalThis as ScratchGlobal;
  let buf = g.__expoThinkingOrbsScratch;
  if (buf === undefined || buf.capacity < capacity) {
    buf = {
      xs: new Float32Array(capacity),
      ys: new Float32Array(capacity),
      zs: new Float32Array(capacity),
      rs: new Float32Array(capacity),
      ws: new Float32Array(capacity),
      as: new Float32Array(capacity),
      count: 0,
      capacity,
    };
    g.__expoThinkingOrbsScratch = buf;
  }
  buf.count = 0;
  return buf;
}
