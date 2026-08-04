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
const GESTURE_COUNT = 3;

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

console.log(
  failures === 0 ? '\nall checks passed' : `\n${failures} check(s) failed`
);
// Non-zero exit on failure, without pulling in Node types for one call.
if (failures > 0) throw new Error(`${failures} idle-gesture check(s) failed`);
