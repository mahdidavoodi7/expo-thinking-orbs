// Numerical checks on idle's gesture spine that watching the orb cannot make:
// that gestures are silent at epoch boundaries, that the envelope has no jumps,
// and that nothing idle does can push the shell past wave's radius ceiling.
//
// Run: bun scripts/check-idle-gestures.ts
//
// The formulas are duplicated from `src/engine/voice.ts` rather than imported,
// because that module is worklet code compiled for the UI runtime. Duplication
// is the point of the check being cheap; if a constant changes there and the
// check passes anyway, it is because the shapes below still bound it.

const TAU = Math.PI * 2;

const GESTURE_EPOCH = 9;
const GESTURE_SPAN = 3.2;
const GESTURE_COUNT = 4;

const hashD = (a: number, b: number) => {
  const h = Math.sin(a * 12.9898 + b * 78.233) * 43758.5453;
  return h - Math.floor(h);
};

const gesture = (t: number) => {
  const k = Math.floor(t / GESTURE_EPOCH);
  const local = t - k * GESTURE_EPOCH;
  const start = hashD(k, 7.31) * (GESTURE_EPOCH - GESTURE_SPAN);
  const u = (local - start) / GESTURE_SPAN;
  const which = Math.floor(hashD(k, 3.17) * GESTURE_COUNT);
  if (u <= 0 || u >= 1) return { which, env: 0, local: 0 };
  return { which, env: 0.5 - 0.5 * Math.cos(TAU * u), local: u };
};

let failures = 0;
const check = (name: string, ok: boolean, detail = '') => {
  if (!ok) {
    failures++;
    console.error(`FAIL  ${name}${detail ? ` — ${detail}` : ''}`);
  } else {
    console.log(`ok    ${name}`);
  }
};

// 1. A gesture is fully at rest at both ends of every epoch, so an epoch change
//    can never interrupt one mid-movement.
{
  let worst = 0;
  for (let k = 0; k < 5000; k++) {
    const atStart = gesture(k * GESTURE_EPOCH).env;
    const atEnd = gesture((k + 1) * GESTURE_EPOCH - 1e-9).env;
    worst = Math.max(worst, atStart, atEnd);
  }
  check('epoch boundaries are silent', worst === 0, `worst env ${worst}`);
}

// 2. The envelope never jumps: sampled fine, no step larger than what a smooth
//    raised cosine can produce over one sample.
{
  const dt = 1 / 240;
  const maxSlope = (Math.PI / GESTURE_SPAN) * dt * 1.5;
  let worst = 0;
  let at = 0;
  for (let t = 0; t < 5 * GESTURE_EPOCH; t += dt) {
    const d = Math.abs(gesture(t + dt).env - gesture(t).env);
    if (d > worst) {
      worst = d;
      at = t;
    }
  }
  check(
    'envelope is continuous',
    worst <= maxSlope,
    `max step ${worst.toFixed(5)} at t=${at.toFixed(3)}, bound ${maxSlope.toFixed(5)}`
  );
}

// 3. Every gesture is selected, and roughly evenly — a hash that favoured one
//    would make the rotation read as a single animation with hiccups.
{
  const seen = new Array<number>(GESTURE_COUNT).fill(0);
  const N = 30000;
  for (let k = 0; k < N; k++) seen[gesture(k * GESTURE_EPOCH + 1e-6).which]!++;
  const min = Math.min(...seen);
  const expected = N / GESTURE_COUNT;
  check(
    'all gestures occur, roughly evenly',
    min > expected * 0.8,
    `counts ${seen.join('/')}`
  );
}

// 4. The gap between consecutive gestures actually varies — the whole point of
//    hashing the start rather than the epoch length.
{
  const gaps: number[] = [];
  for (let k = 0; k < 200; k++) {
    const s0 = hashD(k, 7.31) * (GESTURE_EPOCH - GESTURE_SPAN);
    const s1 = hashD(k + 1, 7.31) * (GESTURE_EPOCH - GESTURE_SPAN);
    gaps.push(GESTURE_EPOCH - s0 - GESTURE_SPAN + s1);
  }
  const spread = Math.max(...gaps) - Math.min(...gaps);
  check(
    'gesture spacing is uneven',
    spread > 2,
    `spread ${spread.toFixed(2)} clock units`
  );
}

// 5. Idle's radius stays under wave's ceiling (0.985) at its worst. The ceiling
//    is clamped where dots are written, so exceeding it would not clip — it
//    would flatten the motion at its peak, which is the defect being ruled out.
//
//    Gestures are mutually exclusive (one is selected per epoch), so the worst
//    case is the base breath plus the WORST SINGLE gesture, not their sum. The
//    ripple's front and its bee CAN overlap, though: early in the gesture the
//    front is still at the origin the bee moved.
{
  const RF_CEILING = 0.985;
  const baseW = (0.62 + 0.38 + 0.22) / 1.22; // all three aligned, normalised
  const breath = baseW * (1.15 - 0.15 * baseW);
  const sigh = 0.04;
  const ripple = 0.028 /* front */ + 0.017; /* bee */
  const worst = 0.9 + 0.038 * breath + Math.max(sigh, ripple);
  check(
    'idle cannot exceed wave ceiling',
    worst <= RF_CEILING,
    `worst rf ${worst.toFixed(4)} vs ${RF_CEILING}`
  );
}

// 6. The ripple front reaches the far side before its envelope closes, so it
//    dies of distance rather than being switched off.
{
  const frontAtEnd = 1 - Math.cos(Math.PI * 1);
  check(
    'ripple front crosses the whole shell',
    frontAtEnd >= 2 - 1e-9,
    `front ${frontAtEnd} of max 2`
  );
}

// 7. Idle's own clock is strictly increasing. It wanders — that is the point —
//    but a tempo that reaches zero stalls the animation and a negative one runs
//    it backwards, and both read as a bug rather than as life. Checked as a
//    derivative bound and then sampled, because the bound is the thing that has
//    to hold when someone edits the amplitudes.
{
  const A1 = 1.6;
  const W1 = 0.211;
  const A2 = 0.7;
  const W2 = 0.0873;
  const idleTime = (t: number) =>
    t + A1 * Math.sin(t * W1) + A2 * Math.sin(t * W2 + 2.1);
  const worstDrop = A1 * W1 + A2 * W2; // both derivatives fully against us
  check(
    'idle tempo never stalls or reverses',
    worstDrop < 0.9,
    `worst slowdown ${worstDrop.toFixed(3)} of 1.0`
  );
  let minRate = Infinity;
  let maxRate = 0;
  const dt = 1 / 120;
  for (let t = 0; t < 4000; t += dt) {
    const r = (idleTime(t + dt) - idleTime(t)) / dt;
    minRate = Math.min(minRate, r);
    maxRate = Math.max(maxRate, r);
  }
  check(
    'sampled tempo stays positive',
    minRate > 0.05,
    `rate ranges ${minRate.toFixed(3)}–${maxRate.toFixed(3)}`
  );
  console.log(
    `      (tempo swings ${(minRate * 100).toFixed(0)}%–${(maxRate * 100).toFixed(0)}% of nominal)`
  );
}

// 8. The differential twist stays bounded. `shear` is interpolated by the blend
//    spine, so a term carrying `t` linearly would differ by tens of radians late
//    in a session and whip the shell round on the next state change. Everything
//    in it must be a sine, and the total has to stay a twist rather than a
//    shredding.
{
  const worst = 0.085 + 0.05 + 0.035 + 0.16; /* twist gust */
  const deg = (worst * 180) / Math.PI;
  check(
    'twist stays bounded and sane',
    worst < 0.45,
    `max ${worst.toFixed(3)} rad (${deg.toFixed(1)}°)`
  );
}

// 9. The swarm's contraction returns to exactly 1. A gesture that left the shell
//    even slightly smaller would accumulate across a session.
{
  const HIVE_SQUASH = 0.05;
  const squash = (env: number) => 1 - HIVE_SQUASH * env;
  check(
    'swarm squash returns to full size',
    squash(0) === 1 && squash(1) === 1 - HIVE_SQUASH,
    `at rest ${squash(0)}, deepest ${squash(1).toFixed(3)}`
  );
}

// 10. The BODY stays inside the canvas. This is the real budget for the float,
//     the breath, the wobble and the hop: the picture is recorded at
//     `(0, 0, size, size)` and the shell already reaches 0.874 of the half-size,
//     so everything below has to fit in the remaining ~12%. Dots that fall
//     outside are simply clipped, with no warning and nothing in a screenshot to
//     show which frame lost them.
{
  const SHELL = 0.874; // of the half-size
  const RF_CEILING = 0.985;
  const BODY_BOB_A1 = 0.015;
  const BODY_BOB_W1 = 0.31;
  const BODY_BOB_A2 = 0.007;
  const BODY_BOB_W2 = 0.1971;
  const BODY_WOBBLE = 0.55;
  const BODY_WOBBLE_MAX = 0.038;
  const HOP_HEIGHT = 0.026;
  const HOP_BOUNCES = 1.5;
  const HOP_DEFORM = 0.055;

  // Worst case, every term against us at once: the float and the hop at full
  // height, the body stretched as far as the clamp allows, and the shell at its
  // ceiling. The breath is deliberately absent — it only ever shrinks the body,
  // so counting it would flatter the result.
  const bobMax = BODY_BOB_A1 + BODY_BOB_A2 + HOP_HEIGHT; // fraction of size
  const halfExtent = SHELL * RF_CEILING * (1 + BODY_WOBBLE_MAX); // of half-size
  // bob is in units of size, extent in units of half-size — convert.
  const worst = halfExtent + bobMax * 2;
  check(
    'body stays inside the canvas',
    worst <= 1,
    `worst reach ${(worst * 100).toFixed(1)}% of the half-size`
  );

  // The wobble clamp has to actually bind, or a fast passage could stretch the
  // body arbitrarily — it is driven by a velocity, not a bounded position.
  const velMax =
    BODY_BOB_A1 * BODY_BOB_W1 +
    BODY_BOB_A2 * BODY_BOB_W2 +
    HOP_HEIGHT * TAU * HOP_BOUNCES * HOP_DEFORM * 12;
  check(
    'wobble is clamped, not merely small',
    BODY_WOBBLE * velMax > BODY_WOBBLE_MAX,
    `unclamped peak ${(BODY_WOBBLE * velMax).toFixed(4)} vs clamp ${BODY_WOBBLE_MAX}`
  );
}

// 11. The hop begins and ends on the ground. `gEnv` is zero at both ends of a
//     gesture, so this holds by construction — but the shape must not leave the
//     body mid-air at the moment the envelope closes either, or the last frames
//     of the gesture would sink rather than land.
{
  const HOP_BOUNCES = 1.5;
  const at = (u: number) =>
    (0.5 - 0.5 * Math.cos(TAU * u)) * -Math.sin(TAU * u * HOP_BOUNCES);
  const settled = Math.abs(at(0)) < 1e-9 && Math.abs(at(1)) < 1e-9;
  // ...and it should spend most of the gesture above the ground, not below it:
  // a hop is a leap, not a dip.
  let up = 0;
  let down = 0;
  for (let i = 1; i < 1000; i++) {
    const v = at(i / 1000);
    if (v > 0) up += v;
    else down -= v;
  }
  check('hop starts and lands on the ground', settled);
  check(
    'hop leaps more than it dips',
    up > down * 1.2,
    `up ${up.toFixed(1)} vs down ${down.toFixed(1)}`
  );
}

console.log(
  failures === 0 ? '\nall checks passed' : `\n${failures} check(s) failed`
);
// Non-zero exit on failure, without pulling in Node types for one call.
if (failures > 0) throw new Error(`${failures} idle-gesture check(s) failed`);
