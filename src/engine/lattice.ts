// Ported from thinking-orbs by Jakub Antalik (MIT) — engine/lattice.ts
//
// The sphere-lattice modes: globe (searching), rubik (solving) and
// wave (listening). All draw a lat/long dot field with mode-specific
// motion. The static lat/long lattice is built once per preset on the JS
// thread; the per-frame motion runs in a worklet writing straight into
// the reused structure-of-arrays dot buffer.

import { angleDelta, hashD, makeProj, radiusScale } from './core';
import type {
  DotBuffer,
  ModeDynamics,
  ModeOpts,
  ModeStaticData,
} from './types';

// --- the shared solver heartbeat (rubik) ------------------------------
// Rapid eased moves scramble, then replay in reverse (palindrome) so
// everything clicks back to solved, rests, repeats.

export interface Move {
  axis: 0 | 1 | 2;
  lo: number;
  hi: number;
  ang: number;
}

interface SolveState {
  amount: number[];
  active: number;
}

export function solveCycle(
  time: number,
  count: number,
  slotDur: number,
  rest: number
): SolveState {
  'worklet';
  const cyc = 2 * count * slotDur + rest;
  const tc = time % cyc;
  const amount = new Array<number>(count).fill(0);
  let active = -1;
  if (tc < 2 * count * slotDur) {
    const slot = Math.floor(tc / slotDur);
    const p = (tc - slot * slotDur) / slotDur;
    const cl = Math.min(1, p / 0.7);
    const ep = 1 - (1 - cl) ** 3; // machine ease-out
    if (slot < count) {
      for (let i = 0; i < slot; i++) amount[i] = 1;
      amount[slot] = ep;
      active = slot;
    } else {
      const u = 2 * count - 1 - slot;
      for (let i = 0; i < u; i++) amount[i] = 1;
      amount[u] = 1 - ep;
      active = u;
    }
  }
  return { amount, active };
}

export function applyMoves(
  px3: number,
  py3: number,
  pz3: number,
  moves: Move[],
  sc: SolveState,
  out: Float32Array
): boolean {
  'worklet';
  let x = px3;
  let y = py3;
  let z = pz3;
  let inActive = false;
  for (let i = 0; i < moves.length; i++) {
    if (sc.amount[i] <= 0) continue;
    const mv = moves[i];
    const coord = mv.axis === 0 ? x : mv.axis === 1 ? y : z;
    if (coord < mv.lo || coord >= mv.hi) continue;
    if (i === sc.active) inActive = true;
    const a = mv.ang * sc.amount[i];
    const ca = Math.cos(a);
    const sa = Math.sin(a);
    if (mv.axis === 0) {
      const y2 = y * ca - z * sa;
      z = y * sa + z * ca;
      y = y2;
    } else if (mv.axis === 1) {
      const x2 = x * ca + z * sa;
      z = -x * sa + z * ca;
      x = x2;
    } else {
      const x2 = x * ca - y * sa;
      y = x * sa + y * ca;
      x = x2;
    }
  }
  out[0] = x;
  out[1] = y;
  out[2] = z;
  return inActive;
}

/** Deterministic scramble move list — pure in the hashes, so hoisted. */
export function makeMoves(count: number): Move[] {
  const moves: Move[] = [];
  for (let i = 0; i < count; i++) {
    const axis = Math.min(2, Math.floor(hashD(i, 2.3) * 3)) as 0 | 1 | 2;
    const lo = -1.0 + 0.5 * Math.min(3, Math.floor(hashD(i, 5.9) * 4));
    const dir = hashD(i, 7.7) < 0.5 ? 1 : -1;
    moves.push({ axis, lo, hi: lo + 0.5, ang: (dir * Math.PI) / 2 });
  }
  return moves;
}

// --- lat/long lattice: unit-sphere positions, hoisted -----------------

// Float64 on purpose: rubik's band test (`coord < lo || coord >= hi`)
// compares against exact 0.5-multiple boundaries, and rings at ±30° sit a
// half-ulp below ±0.5 — float32 storage would round them ONTO the
// boundary and flip the whole ring into a different rotation band.
interface LatticeData extends ModeStaticData {
  /** Flat unit-sphere positions, one entry per dot. */
  ux: Float64Array;
  uy: Float64Array;
  uz: Float64Array;
  /** Longitude angle per dot — the globe scan needs it. */
  lon: Float64Array;
}

function buildLattice(rings: number, lonDensity: number): LatticeData {
  const ux: number[] = [];
  const uy: number[] = [];
  const uz: number[] = [];
  const lonArr: number[] = [];
  for (let li = 0; li <= rings; li++) {
    const lat = -Math.PI / 2 + (li / rings) * Math.PI;
    const cosLat = Math.cos(lat);
    const sinLat = Math.sin(lat);
    const lonCount = Math.max(1, Math.round(Math.abs(cosLat) * lonDensity));
    for (let lj = 0; lj < lonCount; lj++) {
      const lon = (lj / lonCount) * 2 * Math.PI;
      ux.push(cosLat * Math.cos(lon));
      uy.push(sinLat);
      uz.push(cosLat * Math.sin(lon));
      lonArr.push(lon);
    }
  }
  return {
    ux: Float64Array.from(ux),
    uy: Float64Array.from(uy),
    uz: Float64Array.from(uz),
    lon: Float64Array.from(lonArr),
    dotCount: ux.length,
  };
}

// --- Globe: lat/long field, a scan meridian sweeps — searching --------

export interface GlobeData extends LatticeData {}

export function precomputeGlobe(o: ModeOpts): GlobeData {
  return buildLattice(o.latRings ?? 17, o.lonDensity ?? 44);
}

export function buildGlobe(
  buf: DotBuffer,
  size: number,
  t: number,
  o: ModeOpts,
  s: GlobeData,
  dyn: ModeDynamics
): void {
  'worklet';
  const spin = 0.5;
  const cx = size / 2;
  const cy = size / 2;
  const radius = (size / 2) * 0.82;
  const tilt = 0.4 + 0.06 * Math.sin(t * 0.35);
  const pt = makeProj(
    t * spin + dyn.yaw,
    tilt + dyn.pitch,
    cx,
    cy,
    radius,
    dyn.roll,
    dyn.orient
  );
  // scan sweeps relative to the spin; scanMul scales that relative rate
  const scan = t * (spin + (1.7 - spin) * (o.scanMul ?? 1));
  const rs = radiusScale(size, o.rsPow ?? 0.6);
  const dimBase = o.dimBase ?? 1;
  const rBase = o.rBase ?? 0.6;
  const rDepth = o.rDepth ?? 1.7;
  const rBoost = o.rBoost ?? 1;
  const inkFar = o.inkFar ?? 0.62;
  const inkSpan = o.inkSpan ?? 0.54;

  const p = new Float32Array(3);
  const xs = buf.xs;
  const ys = buf.ys;
  const zs = buf.zs;
  const brs = buf.rs;
  const bws = buf.ws;
  const bas = buf.as;
  for (let i = 0; i < s.dotCount; i++) {
    pt(s.ux[i], s.uy[i], s.uz[i], p);
    const z = p[2];
    const depth = (z + 1) / 2;
    // the scan: a moving meridian read as a size ripple, not a shine
    const d = angleDelta(s.lon[i] + t * spin, scan);
    const boost = Math.exp(-(d * d) / 0.18) * Math.max(0, z);
    const j = buf.count++;
    xs[j] = p[0];
    ys[j] = p[1];
    zs[j] = z;
    brs[j] = (rBase + rDepth * depth + rBoost * boost) * rs;
    bws[j] = inkFar - inkSpan * depth;
    // dimBase < 1 fades un-scanned dots so the meridian reads clearly
    bas[j] = dimBase + (1 - dimBase) * Math.min(1, boost);
  }
}

// --- Rubik: bands twist in quarter turns, scramble → solve — solving --

export interface RubikData extends LatticeData {
  moves: Move[];
}

export function precomputeRubik(o: ModeOpts): RubikData {
  const lattice = buildLattice(o.latRings ?? 15, o.lonDensity ?? 40);
  return { ...lattice, moves: makeMoves(o.moveCount ?? 14) };
}

export function buildRubik(
  buf: DotBuffer,
  size: number,
  t: number,
  o: ModeOpts,
  s: RubikData,
  dyn: ModeDynamics
): void {
  'worklet';
  const cx = size / 2;
  const cy = size / 2;
  const R = (size / 2) * 0.82;
  const pt = makeProj(
    t * 0.55 + dyn.yaw,
    0.35 + 0.1 * Math.sin(t * 0.9) + dyn.pitch,
    cx,
    cy,
    R,
    dyn.roll,
    dyn.orient
  );
  const rs = radiusScale(size, o.rsPow ?? 0.6);
  const sc = solveCycle(t, s.moves.length, 0.42, 1.2);
  const rBase = o.rBase ?? 0.6;
  const rDepth = o.rDepth ?? 1.7;
  const rActive = o.rActive ?? 0.3;
  const inkFar = o.inkFar ?? 0.62;
  const inkSpan = o.inkSpan ?? 0.54;

  const m = new Float32Array(3);
  const p = new Float32Array(3);
  const xs = buf.xs;
  const ys = buf.ys;
  const zs = buf.zs;
  const brs = buf.rs;
  const bws = buf.ws;
  const bas = buf.as;
  for (let i = 0; i < s.dotCount; i++) {
    const inActive = applyMoves(s.ux[i], s.uy[i], s.uz[i], s.moves, sc, m);
    pt(m[0], m[1], m[2], p);
    const zr = p[2];
    const depth = (zr + 1) / 2;
    // the band being turned inks a touch darker — the "hand"
    const j = buf.count++;
    xs[j] = p[0];
    ys[j] = p[1];
    zs[j] = zr;
    brs[j] = (rBase + rDepth * depth + (inActive ? rActive : 0)) * rs;
    bws[j] = inkFar - inkSpan * depth - (inActive ? 0.14 : 0);
    bas[j] = 1;
  }
}

// --- Wave: a waveform rolls through the rings — listening -------------

interface WaveRing {
  sinLat: number;
  cosLat: number;
  cosLon: Float32Array;
  sinLon: Float32Array;
}

export interface WaveData extends ModeStaticData {
  rings: WaveRing[];
}

export function precomputeWave(o: ModeOpts): WaveData {
  const rings = o.rings ?? 15;
  const lonDensity = o.lonDensity ?? 40;
  const out: WaveRing[] = [];
  let dotCount = 0;
  for (let ri = 0; ri <= rings; ri++) {
    const lat = -Math.PI / 2 + (ri / rings) * Math.PI;
    const cosLat = Math.cos(lat);
    const sinLat = Math.sin(lat);
    const lonCount = Math.max(1, Math.round(Math.abs(cosLat) * lonDensity));
    const cosLon = new Float32Array(lonCount);
    const sinLon = new Float32Array(lonCount);
    for (let lj = 0; lj < lonCount; lj++) {
      const lon = (lj / lonCount) * 2 * Math.PI;
      cosLon[lj] = Math.cos(lon);
      sinLon[lj] = Math.sin(lon);
    }
    out.push({ sinLat, cosLat, cosLon, sinLon });
    dotCount += lonCount;
  }
  return { rings: out, dotCount };
}

export function buildWave(
  buf: DotBuffer,
  size: number,
  t: number,
  o: ModeOpts,
  s: WaveData,
  dyn: ModeDynamics
): void {
  'worklet';
  const cx = size / 2;
  const cy = size / 2;
  // 0.76 base × 1.15 — the undulation pulls the sphere inward, so wave
  // read ~15% smaller than the other lattice modes; scaled up to match
  const R = (size / 2) * 0.874;
  const pt = makeProj(
    t * 0.18 + dyn.yaw,
    0.38 + dyn.pitch,
    cx,
    cy,
    1,
    dyn.roll,
    dyn.orient
  );
  const rs = radiusScale(size, o.rsPow ?? 0.6);
  const rBase = o.rBase ?? 0.6;
  const rDepth = o.rDepth ?? 1.7;

  const p = new Float32Array(3);
  const xs = buf.xs;
  const ys = buf.ys;
  const zs = buf.zs;
  const brs = buf.rs;
  const bws = buf.ws;
  const bas = buf.as;
  const rings = s.rings;
  for (let ri = 0; ri < rings.length; ri++) {
    const ring = rings[ri];
    const cosLat = ring.cosLat;
    const sinLat = ring.sinLat;
    // two waves, different tempi — organic, never quite repeating
    const w =
      0.62 * Math.sin(t * 2.1 - ri * 0.52) +
      0.38 * Math.sin(t * 1.27 + ri * 0.83);
    const rr = R * (0.88 + 0.105 * w);
    const crest = Math.max(0, w);
    const cosLon = ring.cosLon;
    const sinLon = ring.sinLon;
    for (let lj = 0; lj < cosLon.length; lj++) {
      pt(cosLat * cosLon[lj] * rr, sinLat * rr, cosLat * sinLon[lj] * rr, p);
      const z = p[2];
      const depth = (z / R + 1) / 2;
      const j = buf.count++;
      xs[j] = p[0];
      ys[j] = p[1];
      zs[j] = z;
      brs[j] = (rBase + rDepth * depth) * (1 + 0.4 * crest) * rs;
      bws[j] = 0.66 - 0.56 * depth - 0.1 * crest;
      bas[j] = 1;
    }
  }
}
