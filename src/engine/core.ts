// Ported from thinking-orbs by Jakub Antalik (MIT) — engine/core.ts
//
// Shared primitives for the dotted 3D thought-orbs. Honestly 3D —
// rotated, depth-shaded, z-sorted. Depth is carried by dot size and ink
// weight alone. Every frame-time helper here is a Reanimated worklet so
// it can run on the UI thread inside the render loop; the same functions
// are ordinary JS on the RN thread, so the precompute step can call them
// too.

/**
 * Spin + tilt + orthographic projection of a single point. Writes
 * `[px, py, z2]` into `out` — an out-param instead of a returned tuple so
 * the per-frame loops allocate nothing per dot.
 */
export type Projector = (
  x: number,
  y: number,
  z: number,
  out: Float32Array
) => void;

/**
 * A rotation, row-major: `[m00 m01 m02 m10 m11 m12 m20 m21 m22]`.
 *
 * Flat rather than nested so a caller can keep one reusable array and refill
 * it each frame — the per-frame loops here allocate nothing per dot, and an
 * orientation that allocated nine numbers per frame would be the only thing
 * in the pipeline that did.
 */
export type Mat3 = readonly number[];

/**
 * Build a rotation matrix from a unit quaternion, once per frame.
 *
 * Callers hold orientation as a quaternion because that is the form that
 * integrates cleanly — composing two rotations is a multiply, and the result
 * can be renormalised in four operations, where matrices drift out of
 * orthonormality and Euler angles cannot represent "turn about an arbitrary
 * axis" at all. Rendering wants a matrix, though, so the conversion happens
 * here: once per frame, never per dot.
 *
 * `out` is filled in place for the same allocation reason as `Projector`.
 */
export function quatToMat3(
  x: number,
  y: number,
  z: number,
  w: number,
  out: number[]
): Mat3 {
  'worklet';
  // Normalise on the way in. Long integrations accumulate error, and a
  // quaternion that has drifted off the unit sphere renders as a shear —
  // the orb would subtly stretch the longer you played with it.
  const len = Math.sqrt(x * x + y * y + z * z + w * w);
  const s = len === 0 ? 0 : 1 / len;
  const qx = x * s;
  const qy = y * s;
  const qz = z * s;
  const qw = w * s;

  const x2 = qx + qx;
  const y2 = qy + qy;
  const z2 = qz + qz;
  const xx = qx * x2;
  const xy = qx * y2;
  const xz = qx * z2;
  const yy = qy * y2;
  const yz = qy * z2;
  const zz = qz * z2;
  const wx = qw * x2;
  const wy = qw * y2;
  const wz = qw * z2;

  out[0] = 1 - (yy + zz);
  out[1] = xy - wz;
  out[2] = xz + wy;
  out[3] = xy + wz;
  out[4] = 1 - (xx + zz);
  out[5] = yz - wx;
  out[6] = xz - wy;
  out[7] = yz + wx;
  out[8] = 1 - (xx + yy);
  return out;
}

/** Deterministic hash in [0, 1). */
export function hashD(a: number, b: number): number {
  'worklet';
  const h = Math.sin(a * 12.9898 + b * 78.233) * 43758.5453;
  return h - Math.floor(h);
}

/** Stable directions on a unit sphere (Fibonacci lattice). */
export function fibDir(i: number, n: number): [number, number, number] {
  'worklet';
  const golden = Math.PI * (3 - Math.sqrt(5));
  const y = 1 - (2 * (i + 0.5)) / n;
  const rad = Math.sqrt(1 - y * y);
  const a = i * golden;
  return [rad * Math.cos(a), y, rad * Math.sin(a)];
}

/** Shortest signed angular distance, wrapped to (-π, π]. */
export function angleDelta(a: number, b: number): number {
  'worklet';
  return Math.atan2(Math.sin(a - b), Math.cos(a - b));
}

/**
 * Shared spin + tilt + orthographic projection.
 *
 * Three rotations, in order, each independent:
 *   `yaw`  — about the globe's own pole. Longitudes stream past; the pole
 *            stays where it is.
 *   `tilt` — about the horizontal screen axis. Tips the pole toward or away
 *            from the viewer, bringing a pole into or out of view.
 *   `roll` — about the VIEW axis, applied after projecting. Leans the pole
 *            sideways on screen. It has to come last and in 2-D: rolling
 *            before the tilt would rotate the axis the tilt is measured
 *            against, and the two would no longer be independent.
 *
 * `roll` leaves `z` alone — a rotation about the view axis cannot change
 * depth — so the painter's z-sort is unaffected.
 *
 * An optional `orient` rotates the model point BEFORE any of the above, so a
 * caller can hand the globe a real orientation — a ball in space, spun about
 * whatever axis a force implies — while the three angles above keep their
 * existing meanings on top of it: the engine's own idle spin, and a bounded
 * view-space parallax. Adding Euler angles cannot express that; composing a
 * rotation can.
 */
export function makeProj(
  yaw: number,
  tilt: number,
  cx: number,
  cy: number,
  scale: number,
  roll: number = 0,
  orient: Mat3 | null = null
): Projector {
  'worklet';
  const st = Math.sin(tilt);
  const ct = Math.cos(tilt);
  const sy = Math.sin(yaw);
  const cyw = Math.cos(yaw);
  const sr = Math.sin(roll);
  const cr = Math.cos(roll);
  // Hoisted so the hot path reads locals rather than array slots, and so the
  // null check happens once per frame instead of once per dot.
  const m00 = orient === null ? 0 : orient[0];
  const m01 = orient === null ? 0 : orient[1];
  const m02 = orient === null ? 0 : orient[2];
  const m10 = orient === null ? 0 : orient[3];
  const m11 = orient === null ? 0 : orient[4];
  const m12 = orient === null ? 0 : orient[5];
  const m20 = orient === null ? 0 : orient[6];
  const m21 = orient === null ? 0 : orient[7];
  const m22 = orient === null ? 0 : orient[8];
  return (x0, y0, z0, out) => {
    // The orientation turns the BALL; everything below turns the camera and
    // the engine's own idle spin around it. Skipped entirely when absent —
    // nine multiplies per dot per frame is not free at 120 Hz, and the
    // overwhelming majority of callers never pass one.
    const x = orient === null ? x0 : m00 * x0 + m01 * y0 + m02 * z0;
    const y = orient === null ? y0 : m10 * x0 + m11 * y0 + m12 * z0;
    const z = orient === null ? z0 : m20 * x0 + m21 * y0 + m22 * z0;
    const x1 = x * cyw + z * sy;
    const z1 = -x * sy + z * cyw;
    const y1 = y * ct - z1 * st;
    const z2 = y * st + z1 * ct;
    // Skip the rotation entirely when level — the overwhelmingly common
    // case, and two multiplies per dot per frame is not free at 120 Hz.
    const xr = roll === 0 ? x1 : x1 * cr - y1 * sr;
    const yr = roll === 0 ? y1 : x1 * sr + y1 * cr;
    out[0] = cx + xr * scale;
    out[1] = cy - yr * scale;
    out[2] = z2;
  };
}

/**
 * Dot radii were tuned for a 300pt frame; sub-linear scaling keeps small
 * spinners legible. Lower pow = radii shrink less with size.
 */
export function radiusScale(size: number, pow: number): number {
  'worklet';
  return (size / 300) ** pow;
}
