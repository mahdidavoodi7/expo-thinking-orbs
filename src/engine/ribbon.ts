// Ported from thinking-orbs by Jakub Antalik (MIT) — engine/ribbon.ts
//
// Ribbon: an undulating sash of parallel strands rides a great circle —
// the "composing" state. The tuned preset freezes the 3D tumble
// (spin 0), leaving the traveling undulation on a fixed band. The ghost
// directions and the per-segment angle tables are hoisted; the band
// plane and the traveling wobble are recomputed each frame.

import { fibDir, makeProj, radiusScale } from './core';
import type {
  DotBuffer,
  ModeDynamics,
  ModeOpts,
  ModeStaticData,
} from './types';

export interface RibbonData extends ModeStaticData {
  // ghost great-circle directions (fibonacci lattice)
  ghostDx: Float32Array;
  ghostDy: Float32Array;
  ghostDz: Float32Array;
  ghostN: number;
  // per-segment angle + its cos/sin
  segA: Float32Array;
  segCos: Float32Array;
  segSin: Float32Array;
  segs: number;
  // per-lane offset + edge weight (depend only on lane count)
  laneOff: Float32Array;
  edge: Float32Array;
  lanes: number;
}

export function precomputeRibbon(o: ModeOpts): RibbonData {
  const ghostN = o.ghostN ?? 150;
  const ghostDx = new Float32Array(ghostN);
  const ghostDy = new Float32Array(ghostN);
  const ghostDz = new Float32Array(ghostN);
  for (let i = 0; i < ghostN; i++) {
    const d = fibDir(i, ghostN);
    ghostDx[i] = d[0];
    ghostDy[i] = d[1];
    ghostDz[i] = d[2];
  }

  const segs = o.segs ?? 88;
  const segA = new Float32Array(segs);
  const segCos = new Float32Array(segs);
  const segSin = new Float32Array(segs);
  for (let k = 0; k < segs; k++) {
    const a = (k / segs) * 2 * Math.PI;
    segA[k] = a;
    segCos[k] = Math.cos(a);
    segSin[k] = Math.sin(a);
  }

  const baseLanes = o.lanes ?? 5;
  const lanes = Math.max(1, Math.round(baseLanes * (o.bandMul ?? 1)));
  const laneOff = new Float32Array(lanes);
  const edge = new Float32Array(lanes);
  for (let w = 0; w < lanes; w++) {
    laneOff[w] = (w - (lanes - 1) / 2) * 0.075;
    edge[w] = Math.abs(w - (lanes - 1) / 2) / Math.max(1, (lanes - 1) / 2);
  }

  return {
    ghostDx,
    ghostDy,
    ghostDz,
    ghostN,
    segA,
    segCos,
    segSin,
    segs,
    laneOff,
    edge,
    lanes,
    dotCount: ghostN + lanes * segs,
  };
}

export function buildRibbon(
  buf: DotBuffer,
  size: number,
  t: number,
  o: ModeOpts,
  s: RibbonData,
  dyn: ModeDynamics
): void {
  'worklet';
  const cx = size / 2;
  const cy = size / 2;
  const R = (size / 2) * 0.78;
  // spin scales the 3D tumble; spin=0 freezes the band's orientation,
  // leaving only the traveling undulation
  const spin = o.spin ?? 1;
  const pt = makeProj(
    t * 0.1 * spin + dyn.yaw,
    0.3 + dyn.pitch,
    cx,
    cy,
    1,
    dyn.roll
  );
  const rs = radiusScale(size, o.rsPow ?? 0.6);
  const rBase = o.rBase ?? 1.1;
  const rDepth = o.rDepth ?? 1.7;
  const wobMul = o.wobMul ?? 1;
  const ghostRadius = 0.8 * rs;

  const p = new Float32Array(3);
  const xs = buf.xs;
  const ys = buf.ys;
  const zs = buf.zs;
  const brs = buf.rs;
  const bws = buf.ws;
  const bas = buf.as;

  for (let i = 0; i < s.ghostN; i++) {
    pt(s.ghostDx[i] * R, s.ghostDy[i] * R, s.ghostDz[i] * R, p);
    const z = p[2];
    const depth = (z / R + 1) / 2;
    const j = buf.count++;
    xs[j] = p[0];
    ys[j] = p[1];
    zs[j] = z;
    brs[j] = ghostRadius;
    bws[j] = 0.78;
    bas[j] = 0.1 + 0.22 * depth;
  }

  // the band plane, precessing (frozen when spin=0)
  const ya = t * 0.24 * spin;
  const ta = 0.55 + 0.3 * Math.sin(t * 0.18) * spin;
  const bux = Math.cos(ya);
  const buy = 0;
  const buz = Math.sin(ya);
  const bvx = -buz * Math.sin(ta);
  const bvy = Math.cos(ta);
  const bvz = bux * Math.sin(ta);
  // plane normal n = u × v
  const bnx = buy * bvz - buz * bvy;
  const bny = buz * bvx - bux * bvz;
  const bnz = bux * bvy - buy * bvx;

  const segs = s.segs;
  for (let w = 0; w < s.lanes; w++) {
    const laneOff = s.laneOff[w];
    const edge = s.edge[w];
    for (let k = 0; k < segs; k++) {
      const a = s.segA[k];
      const ca = s.segCos[k];
      const sa = s.segSin[k];
      // the undulation: two traveling waves along the band; wobMul
      // scales the deformation — 0 is a clean band
      const wob =
        (0.16 * Math.sin(a * 3 - t * 1.7 + w * 0.22) +
          0.07 * Math.sin(a * 5 + t * 1.1)) *
        wobMul;
      const off = laneOff + wob;
      const x = bux * ca + bvx * sa + bnx * off;
      const y = buy * ca + bvy * sa + bny * off;
      const z = buz * ca + bvz * sa + bnz * off;
      const l = Math.sqrt(x * x + y * y + z * z);
      pt((x / l) * R, (y / l) * R, (z / l) * R, p);
      const zr = p[2];
      const depth = (zr / R + 1) / 2;
      const j = buf.count++;
      xs[j] = p[0];
      ys[j] = p[1];
      zs[j] = zr;
      brs[j] = (rBase + rDepth * depth) * (1 - 0.25 * edge) * rs;
      bws[j] = 0.52 - 0.44 * depth + 0.18 * edge;
      bas[j] = 0.4 + 0.6 * depth;
    }
  }
}
