// Ported from thinking-orbs by Jakub Antalik (MIT) — engine/registry.ts
//
// Mode key → { precompute, build }. Kept separate from the presets so
// tree shaking can in principle drop unused modes in custom builds.

import type { ModeKey } from '../presets';
import {
  buildGlobe,
  buildRubik,
  buildWave,
  precomputeGlobe,
  precomputeRubik,
  precomputeWave,
} from './lattice';
import { buildMorph, precomputeMorph } from './morph';
import { buildOrbits, precomputeOrbits } from './orbits';
import { buildRibbon, precomputeRibbon } from './ribbon';
import type { ModeImpl } from './types';
import { buildVoice, precomputeVoice } from './voice';

export const MODES: Record<ModeKey, ModeImpl> = {
  orbits: { precompute: precomputeOrbits, build: buildOrbits },
  globe: { precompute: precomputeGlobe, build: buildGlobe },
  rubik: { precompute: precomputeRubik, build: buildRubik },
  wave: { precompute: precomputeWave, build: buildWave },
  ribbon: { precompute: precomputeRibbon, build: buildRibbon },
  morph: { precompute: precomputeMorph, build: buildMorph },
  voice: { precompute: precomputeVoice, build: buildVoice },
};
