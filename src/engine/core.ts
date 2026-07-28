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
 * An optional `orient` rotates the result AFTER `yaw` and `tilt`, in the
 * viewer's own frame — screen x right, screen y up, depth toward the eye. That
 * lets a caller hand the globe a real orientation: a ball in space, spun about
 * whatever axis a force implies, from wherever it already lies. Adding Euler
 * angles cannot express that; composing a rotation can.
 *
 * It goes after rather than before deliberately. `yaw` here is the mode's own
 * idle spin, which grows with elapsed time; rotating the ball before it would
 * conjugate the caller's axes by that spin, and a request to tip the globe
 * toward the viewer would drift into an in-plane roll and back again.
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
    const x1 = x0 * cyw + z0 * sy;
    const z1 = -x0 * sy + z0 * cyw;
    const y1 = y0 * ct - z1 * st;
    const z2 = y0 * st + z1 * ct;
    // The orientation lands LAST of the three-dimensional steps, and that
    // placement is the whole contract rather than an implementation detail.
    //
    // Everything above is the mode's own motion — an idle spin about the
    // globe's pole that never stops. Rotating the ball before it means the
    // caller's axes get conjugated by that spin: a rotation about x̂, seen
    // through a later y-rotation of φ, is a rotation about (cos φ, 0, −sin φ).
    // φ grows without bound because it is driven by elapsed time, so a caller
    // asking for "tip it toward me" would get a tip that slowly turns into an
    // in-plane roll and back, on a period nobody chose.
    //
    // Applied here, the orientation is in the SAME frame the viewer is in:
    // screen x to the right, screen y up, depth toward the eye. A drag right
    // turns the ball about ŷ and stays turning about ŷ, whatever the mode is
    // doing underneath and however far the ball has already been turned.
    //
    // Skipped entirely when absent — nine multiplies per dot per frame is not
    // free at 120 Hz, and the overwhelming majority of callers never pass one.
    const xo = orient === null ? x1 : m00 * x1 + m01 * y1 + m02 * z2;
    const yo = orient === null ? y1 : m10 * x1 + m11 * y1 + m12 * z2;
    const zo = orient === null ? z2 : m20 * x1 + m21 * y1 + m22 * z2;
    // Skip the rotation entirely when level — the overwhelmingly common
    // case, and two multiplies per dot per frame is not free at 120 Hz.
    const xr = roll === 0 ? xo : xo * cr - yo * sr;
    const yr = roll === 0 ? yo : xo * sr + yo * cr;
    out[0] = cx + xr * scale;
    out[1] = cy - yr * scale;
    // Depth comes from AFTER the orientation, or the painter's far-to-near
    // sort would order the dots by where they used to be.
    out[2] = zo;
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
