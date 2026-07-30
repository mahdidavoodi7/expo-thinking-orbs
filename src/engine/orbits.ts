// Ported from thinking-orbs by Jakub Antalik (MIT) — engine/orbits.ts
//
// Orbits: particles on tilted orbits — the "working" state. No nucleus
// (the tuned preset runs coreless): just ghost paths and the particles
// doing the work. The orbit bases and the ghost-path angle tables are
// pure in the hashes, so they are hoisted; only the particle angles and
// the projection move per frame.

import { hashD, makeProj, radiusScale } from './core';
import type {
  DotBuffer,
  ModeDynamics,
  ModeOpts,
  ModeStaticData,
} from './types';

interface OrbitBase {
  ux: number;
  uy: number;
  uz: number;
  vx: number;
  vy: number;
  vz: number;
  /** size-independent orbit radius factor; ro = R * roFactor. */
  roFactor: number;
  speed: number;
  h2: number;
}

export interface OrbitsData extends ModeStaticData {
  orbits: OrbitBase[];
  /** Ghost-path sample angles, cos/sin precomputed (time-independent). */
  ghostCos: Float32Array;
  ghostSin: Float32Array;
  ghostN: number;
  particles: number;
}

export function precomputeOrbits(o: ModeOpts): OrbitsData {
  const orbitN = o.orbitN ?? 12;
  const ghostN = o.ghostN ?? 40;
  const particles = o.particles ?? 3;

  const orbits: OrbitBase[] = [];
  for (let orb = 0; orb < orbitN; orb++) {
    const h1 = hashD(orb, 1.7);
    const h2 = hashD(orb, 5.2);
    const h3 = hashD(orb, 8.9);
    const roFactor = 0.45 + 0.52 * h1;
    const th = h1 * 2 * Math.PI;
    const phi = Math.acos(2 * h2 - 1);
    // orbit plane basis (u, v ⟂ normal n)
    const nx = Math.sin(phi) * Math.cos(th);
    const ny = Math.cos(phi);
    const nz = Math.sin(phi) * Math.sin(th);
    let ux = -ny;
    let uy = nx;
    const uz = 0;
    const ul = Math.max(1e-6, Math.sqrt(ux * ux + uy * uy));
    ux /= ul;
    uy /= ul;
    const vx = ny * uz - nz * uy;
    const vy = nz * ux - nx * uz;
    const vz = nx * uy - ny * ux;
    const speed = (0.25 + 0.55 * h3) * (h3 > 0.5 ? 1 : -1);
    orbits.push({ ux, uy, uz, vx, vy, vz, roFactor, speed, h2 });
  }

  const ghostCos = new Float32Array(ghostN);
  const ghostSin = new Float32Array(ghostN);
  for (let k = 0; k < ghostN; k++) {
    const a = (k / ghostN) * 2 * Math.PI;
    ghostCos[k] = Math.cos(a);
    ghostSin[k] = Math.sin(a);
  }

  return {
    orbits,
    ghostCos,
    ghostSin,
    ghostN,
    particles,
    dotCount: orbitN * (ghostN + particles),
  };
}

export function buildOrbits(
  buf: DotBuffer,
  size: number,
  t: number,
  o: ModeOpts,
  s: OrbitsData,
  dyn: ModeDynamics
): void {
  'worklet';
  const cx = size / 2;
  const cy = size / 2;
  const R = (size / 2) * 0.82;
  const pt = makeProj(
    t * 0.12 + dyn.yaw,
    0.3 + dyn.pitch,
    cx,
    cy,
    1,
    dyn.roll,
    dyn.orient
  );
  // `dyn.rMul` folds in HERE rather than at each radius expression, so every
  // radius this mode derives from `rs` — dots, ghosts, particles — carries it
  // for free, and a mode cannot pick up a dot-weight knob for some of its marks
  // and not others.
  const rs = radiusScale(size, o.rsPow ?? 0.6) * dyn.rMul;
  const ghostR = (o.ghostR ?? 0.9) * rs;
  const ghostA = o.ghostA ?? 0.5;
  const partR = o.partR ?? 1.2;
  const partRDepth = o.partRDepth ?? 1.6;
  const particles = s.particles;
  const ghostN = s.ghostN;

  const p = new Float32Array(3);
  const xs = buf.xs;
  const ys = buf.ys;
  const zs = buf.zs;
  const brs = buf.rs;
  const bws = buf.ws;
  const bas = buf.as;

  // orbits: each a tilted circle — a ghost path + running particles
  for (let orb = 0; orb < s.orbits.length; orb++) {
    const ob = s.orbits[orb];
    const ro = R * ob.roFactor;

    // ghost path
    for (let k = 0; k < ghostN; k++) {
      const ca = s.ghostCos[k];
      const sa = s.ghostSin[k];
      pt(
        (ob.ux * ca + ob.vx * sa) * ro,
        (ob.uy * ca + ob.vy * sa) * ro,
        (ob.uz * ca + ob.vz * sa) * ro,
        p
      );
      const z = p[2];
      const depth = (z / ro + 1) / 2;
      const j = buf.count++;
      xs[j] = p[0];
      ys[j] = p[1];
      zs[j] = z;
      brs[j] = ghostR;
      bws[j] = 0.72;
      bas[j] = ghostA * (0.4 + 0.6 * depth);
    }
    // the particles doing the work
    for (let m = 0; m < particles; m++) {
      const a = t * ob.speed + (m / particles) * 2 * Math.PI + ob.h2 * 6;
      const ca = Math.cos(a);
      const sa = Math.sin(a);
      pt(
        (ob.ux * ca + ob.vx * sa) * ro,
        (ob.uy * ca + ob.vy * sa) * ro,
        (ob.uz * ca + ob.vz * sa) * ro,
        p
      );
      const z = p[2];
      const depth = (z / ro + 1) / 2;
      const j = buf.count++;
      xs[j] = p[0];
      ys[j] = p[1];
      zs[j] = z;
      brs[j] = (partR + partRDepth * depth) * rs;
      bws[j] = 0.3 - 0.22 * depth;
      bas[j] = 1;
    }
  }
}
