// Ported from thinking-orbs by Jakub Antalik (MIT) — engine/morph.ts
//
// Morph: a dotted outline cycling circle → triangle → square — the
// "shaping" state. Each shape is a continuous closed path parameterised
// by arc length (top-centre start, clockwise). Every frame the engine
// blends the two neighbouring paths, then lays the dots EVENLY along the
// blended outline — spacing stays uniform at every instant of the morph,
// holds and transitions alike. The fixed 160-sample polyline of each
// shape is precomputed; the per-frame blend + arc-length walk is
// verbatim from the original, working in per-runtime scratch arrays so
// a frame allocates nothing.

import type { DotBuffer, ModeOpts, ModeStaticData } from './types';

type Path = (f: number) => [number, number];

function smoothE(x: number): number {
  'worklet';
  return x * x * (3 - 2 * x);
}

function polyPath(verts: ReadonlyArray<readonly [number, number]>): Path {
  const V = verts.length;
  const L: number[] = [];
  let total = 0;
  for (let i = 0; i < V; i++) {
    const a = verts[i];
    const b = verts[(i + 1) % V];
    const l = Math.hypot(b[0] - a[0], b[1] - a[1]);
    L.push(l);
    total += l;
  }
  return (f) => {
    let target = f * total;
    let i = 0;
    while (target > L[i] && i < V - 1) {
      target -= L[i];
      i++;
    }
    const a = verts[i];
    const b = verts[(i + 1) % V];
    const ff = L[i] ? Math.min(1, target / L[i]) : 0;
    return [a[0] + (b[0] - a[0]) * ff, a[1] + (b[1] - a[1]) * ff];
  };
}

const CIRCLE: Path = (f) => {
  const a = -Math.PI / 2 + f * 2 * Math.PI;
  return [Math.cos(a) * 0.24, Math.sin(a) * 0.24];
};
const TRIANGLE = polyPath([
  [0.0, -0.26],
  [0.24, 0.16],
  [-0.24, 0.16],
]);
// 5-vertex walk so the path STARTS at top-centre like the other shapes
const SQUARE = polyPath([
  [0, -0.2],
  [0.2, -0.2],
  [0.2, 0.2],
  [-0.2, 0.2],
  [-0.2, -0.2],
]);
const CYCLE: Path[] = [CIRCLE, TRIANGLE, SQUARE];

// low floor keeps sparse outlines possible while never degenerating
function morphN(d: number): number {
  return Math.max(6, Math.round(34 * d));
}

const HOLD = 1.4;
const MORPH = 0.9;
const SEG = HOLD + MORPH;
const M = 160;

// Per-runtime scratch for the blended outline (fixed M samples).
interface MorphScratch {
  ptsX: Float32Array;
  ptsY: Float32Array;
  L: Float32Array;
}

interface MorphScratchGlobal {
  __expoThinkingOrbsMorph?: MorphScratch;
}

function acquireMorphScratch(): MorphScratch {
  'worklet';
  const g = globalThis as MorphScratchGlobal;
  let s = g.__expoThinkingOrbsMorph;
  if (s === undefined) {
    s = {
      ptsX: new Float32Array(M),
      ptsY: new Float32Array(M),
      L: new Float32Array(M),
    };
    g.__expoThinkingOrbsMorph = s;
  }
  return s;
}

export interface MorphData extends ModeStaticData {
  /** One 160-sample polyline (x/y) per shape in the cycle. */
  shapesX: Float32Array[];
  shapesY: Float32Array[];
  K: number;
}

export function precomputeMorph(o: ModeOpts): MorphData {
  const shapesX: Float32Array[] = [];
  const shapesY: Float32Array[] = [];
  for (let s = 0; s < CYCLE.length; s++) {
    const path = CYCLE[s];
    const xs = new Float32Array(M);
    const ys = new Float32Array(M);
    for (let i = 0; i < M; i++) {
      const p = path(i / M);
      xs[i] = p[0];
      ys[i] = p[1];
    }
    shapesX.push(xs);
    shapesY.push(ys);
  }
  return {
    shapesX,
    shapesY,
    K: CYCLE.length,
    dotCount: morphN(o.iconD ?? 1),
  };
}

export function buildMorph(
  buf: DotBuffer,
  size: number,
  t: number,
  o: ModeOpts,
  s: MorphData
): void {
  'worklet';
  const K = s.K;
  const tc = t % (SEG * K);
  const k = Math.floor(tc / SEG);
  const local = tc - k * SEG;
  const m = local > HOLD ? smoothE((local - HOLD) / MORPH) : 0;
  const sprd = o.spread ?? 1;

  // blend the two shape polylines at m, then measure the blended outline
  const sAx = s.shapesX[k];
  const sAy = s.shapesY[k];
  const sBx = s.shapesX[(k + 1) % K];
  const sBy = s.shapesY[(k + 1) % K];
  const scr = acquireMorphScratch();
  const ptsX = scr.ptsX;
  const ptsY = scr.ptsY;
  const L = scr.L;
  for (let i = 0; i < M; i++) {
    ptsX[i] = (sAx[i] + (sBx[i] - sAx[i]) * m) * sprd;
    ptsY[i] = (sAy[i] + (sBy[i] - sAy[i]) * m) * sprd;
  }
  let total = 0;
  for (let i = 0; i < M; i++) {
    const j = (i + 1) % M;
    const l = Math.hypot(ptsX[j] - ptsX[i], ptsY[j] - ptsY[i]);
    L[i] = l;
    total += l;
  }

  // dot radius depends ONLY on rDot (the size knob); the count sets the
  // gaps. Formed shapes breathe a little (uniform pulse).
  const n = s.dotCount;
  const re = (o.rDot ?? 0.021) * 1.35 * sprd;
  const pulse = 1 + 0.02 * Math.sin(local * 3.1);

  const c2 = size / 2;
  const rDot = Math.max(0.35, re * size);
  const xs = buf.xs;
  const ys = buf.ys;
  const zs = buf.zs;
  const brs = buf.rs;
  const bws = buf.ws;
  const bas = buf.as;
  let seg = 0;
  let acc = 0;
  for (let k2 = 0; k2 < n; k2++) {
    const target = (k2 / n) * total;
    while (acc + L[seg] < target && seg < M - 1) {
      acc += L[seg];
      seg++;
    }
    const j2 = (seg + 1) % M;
    const f = L[seg] ? Math.min(1, (target - acc) / L[seg]) : 0;
    const x = (ptsX[seg] + (ptsX[j2] - ptsX[seg]) * f) * pulse;
    const y = (ptsY[seg] + (ptsY[j2] - ptsY[seg]) * f) * pulse;
    const j = buf.count++;
    xs[j] = c2 + x * size;
    ys[j] = c2 + y * size;
    zs[j] = 0;
    brs[j] = rDot;
    bws[j] = 0.1;
    bas[j] = 1;
  }
}
