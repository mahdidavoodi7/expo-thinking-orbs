// Ported from thinking-orbs by Jakub Antalik (MIT) — presets.ts
//
// The shipped tunings: six states × two design sizes, baked from the
// inkform mini-page tuning session. `count`/`size` are multipliers over
// the base fine profiles; `speed` multiplies the shared clock. Resolved
// once per (state, designSize) pair and cached — the render loop sees
// plain numbers. The public `size` prop is any number; `pickDesignSize`
// snaps it to a tuned design, and the engine (size-relative) scales.

import type { ModeOpts } from './engine/profiles';
import { BASE_PROFILES, scaleCounts, scaleRadii } from './engine/profiles';
import type { OrbSize, OrbState } from './types';

export type ModeKey =
  'orbits' | 'globe' | 'rubik' | 'wave' | 'ribbon' | 'morph';

export const STATE_TO_MODE: Record<OrbState, ModeKey> = {
  working: 'orbits',
  searching: 'globe',
  solving: 'rubik',
  listening: 'wave',
  composing: 'ribbon',
  shaping: 'morph',
};

/**
 * Below this rendered size the 20-tuned design (fewer, chunkier dots)
 * reads better; at or above it the 64-tuned design is used. Either design
 * then scales vectorially to the actual `size`.
 */
export const DESIGN_CUTOFF = 36;

/** Snap any rendered size to the nearer tuned design. */
export function pickDesignSize(size: number): OrbSize {
  return size >= DESIGN_CUTOFF ? 64 : 20;
}

interface Preset {
  speed: number;
  count: number;
  size: number;
  /** Extra mode opts merged verbatim after scaling. */
  extra?: ModeOpts;
}

const PRESETS: Record<ModeKey, Record<OrbSize, Preset>> = {
  orbits: {
    64: { speed: 1.885, count: 1, size: 1 },
    20: { speed: 3.9, count: 0.238, size: 2.4 },
  },
  globe: {
    64: {
      speed: 2.015,
      count: 0.42,
      size: 1.15,
      extra: { scanMul: 4.08, dimBase: 0.45 },
    },
    20: {
      speed: 2.665,
      count: 0.105,
      size: 1.75,
      extra: { scanMul: 4.335, dimBase: 0.45 },
    },
  },
  rubik: {
    64: { speed: 1.82, count: 0.35, size: 1.05 },
    20: { speed: 1.95, count: 0.088, size: 1.9 },
  },
  wave: {
    64: { speed: 4.388, count: 0.341, size: 1 },
    20: { speed: 3.998, count: 0.105, size: 1.6 },
  },
  ribbon: {
    64: {
      speed: 2.34,
      count: 0.25,
      size: 0.85,
      extra: { spin: 0, bandMul: 3.9, wobMul: 1 },
    },
    20: {
      speed: 3.12,
      count: 0.051,
      size: 1.073,
      extra: { spin: 0, bandMul: 4.94, wobMul: 1 },
    },
  },
  morph: {
    64: { speed: 2.405, count: 0.54, size: 0.395, extra: { spread: 1.45 } },
    20: { speed: 2.08, count: 0.53, size: 1.011, extra: { spread: 1.45 } },
  },
};

export interface Resolved {
  mode: ModeKey;
  speed: number;
  opts: ModeOpts;
}

const cache = new Map<string, Resolved>();

/**
 * Resolve a (state, designSize) pair to its mode + fully-scaled draw
 * options. `designSize` is one of the two tuned designs (see
 * `pickDesignSize`).
 */
export function resolvePreset(state: OrbState, designSize: OrbSize): Resolved {
  const key = `${state}-${designSize}`;
  const hit = cache.get(key);
  if (hit) return hit;

  const mode = STATE_TO_MODE[state];
  const preset = PRESETS[mode][designSize];
  let opts: ModeOpts = { ...BASE_PROFILES[mode] };
  if (preset.count !== 1) opts = scaleCounts(opts, preset.count);
  if (preset.size !== 1) opts = scaleRadii(opts, preset.size);
  if (preset.extra) opts = { ...opts, ...preset.extra };

  const resolved: Resolved = { mode, speed: preset.speed, opts };
  cache.set(key, resolved);
  return resolved;
}
