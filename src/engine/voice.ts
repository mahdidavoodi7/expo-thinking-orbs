// Voice: one lat/long shell, eight behaviours — the voice-agent states.
//
// Written for full-duplex live sessions, where the orb is on screen for the
// whole call and flips state several times per turn. It is new, but it
// deliberately speaks the same language as the six ported modes, because
// that language is what makes them read as one solid object rather than a
// swarm:
//
//  1. A REGULAR lattice, not a random cloud. Dots sit on latitude rings
//     exactly as in `wave` / `globe`. Regularity is what makes deformation
//     legible — you see a surface being disturbed, not particles moving.
//
//  2. Motion phase comes from LATTICE POSITION — ring index and longitude —
//     never from a per-dot hash. A hash gives every dot an unrelated phase,
//     which is mathematically noise and looks like it. Neighbouring dots
//     must agree, or the surface dissolves into static.
//
//  3. Every behaviour is a SMOOTH PERIODIC function of `t`. Never a
//     sawtooth: a recycling `frac()` phase snaps when it wraps, and hiding
//     that snap behind an alpha fade is exactly what turns a surface into
//     particles. Nothing here is born and nothing dies.
//
//  4. Radius and ink move TOGETHER off one event quantity (`crest`):
//     bigger and darker at once, the coupling `wave` uses for its crest and
//     `globe` for its scan. Alpha stays at 1 except where it genuinely
//     signals an event.
//
//  5. Tempo is CONSTANT. Audio level scales how DEEP a gesture goes, never
//     how fast — driving rate from amplitude is frequency modulation, and
//     reads as vibration rather than as a voice.
//
//  6. Radius factors never exceed wave's own maximum, so the shell fills
//     its box exactly like the ported animations and can never clip.
//
// The eight behaviours also form a deliberate arc. A session climbs from
// `disconnected` (a dim shell straining for a signal) through `connecting`
// (urgent, spiking) and `buffering` (a confident sweep) to `initializing`
// (assembly) and finally `idle` — each visibly fuller and brighter than the
// last, so progress is legible without reading a label.
//
// Because every behaviour answers the same questions about a ring, two can
// be evaluated and blended — which is how `listening → thinking → speaking`
// becomes one object changing its mind rather than a cut. A blend costs one
// extra evaluation PER RING, not per dot.

import { hashD, makeProj, radiusScale } from './core';
import type {
  DotBuffer,
  ModeDynamics,
  ModeOpts,
  ModeStaticData,
} from './types';

/** Behaviour indices. Kept numeric so they can be blended arithmetically. */
export const VOICE_IDLE = 0;
export const VOICE_INITIALIZING = 1;
export const VOICE_LISTENING = 2;
export const VOICE_THINKING = 3;
export const VOICE_SPEAKING = 4;
export const VOICE_CONNECTING = 5;
export const VOICE_BUFFERING = 6;
export const VOICE_DISCONNECTED = 7;

/** One of the eight voice shell behaviours. */
export type VoiceBehaviour = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7;

const TAU = Math.PI * 2;

// --- the shared timing spine -----------------------------------------
//
// Every tempo is `wave`'s (lattice.ts `buildWave`) — the pace the ported
// orbs were tuned at. Mixing pacings inside one component reads as
// sloppiness. `waveW` is wave's undulation verbatim: two incommensurate
// sines phased by RING INDEX, which is what makes a roll visible as a wave.
function waveW(t: number, ri: number): number {
  'worklet';
  return (
    0.62 * Math.sin(t * 2.1 - ri * 0.52) + 0.38 * Math.sin(t * 1.27 + ri * 0.83)
  );
}

/**
 * A sharpened pulse: a sine's positive lobe raised to a power, so the ring
 * sits at rest most of the cycle and lunges briefly. This is what makes a
 * SPIKE rather than a wobble — and unlike a sawtooth it is still perfectly
 * smooth, easing out of rest and back into it.
 */
function spikePulse(x: number): number {
  'worklet';
  const sv = Math.sin(x);
  if (sv <= 0) return 0;
  const s2 = sv * sv;
  return s2 * s2 * sv;
}

/**
 * A softened pulse for travelling wavefronts — a sine's positive lobe
 * cubed. Broader than `spikePulse`, so a wave reads as a swell passing
 * through rather than a hairline ring, and still exactly zero between
 * crests so the shell rests between them.
 */
function ripplePulse(x: number): number {
  'worklet';
  const sv = Math.sin(x);
  if (sv <= 0) return 0;
  return sv * sv * sv;
}

/** Wave's own resting radius factor and swing — the family's scale. */
const WAVE_BASE = 0.88;
/** Nothing may exceed this: wave's own maximum radius factor. */
const RF_CEILING = 0.985;

/**
 * Wavefronts visible across the radius of the disc at once. Two-and-a bit
 * reads as travelling; more looks like corduroy, fewer like a single throb.
 */
const RIPPLE_K = 2.2;
/** How fast a wavefront crosses from centre to rim (cycles per clock unit). */
const RIPPLE_RATE = 0.5;

// --- idle's gestures ---------------------------------------------------
//
// `idle` is the state a live session sits in between turns, and the one home
// screens sit in indefinitely. A single looping pose reads as a mechanism after
// about ten seconds of watching, so idle carries two layers on top of its base:
// the base itself is quasi-periodic (see `VOICE_IDLE` in `ringState`), and every
// so often ONE of a few gestures plays over it.
//
// Which gesture, and when, are pure functions of the clock. There is no
// scheduler and no state: the epoch index is `floor(t / GESTURE_EPOCH)`, and
// everything else is hashed off it. That is what makes this safe to evaluate
// from two places — `ringState` (per ring) and `buildVoice` (per dot) — which is
// necessary because a gesture's quantity decides where it can live: a twist is a
// per-ring shear, a ripple crossing the surface is per-dot. Both derive the same
// answer from `t` alone rather than one telling the other.
//
// It also means pause/resume, Fast Refresh and a remount cannot desynchronise
// it, and nothing accumulates across a long session.

/** Clock units per gesture slot. One gesture plays inside each. */
const GESTURE_EPOCH = 9;
/** How long a gesture takes. The rest of the epoch is quiet. */
const GESTURE_SPAN = 3.2;
/** How many gestures are in the rotation. */
const GESTURE_COUNT = 3;
const GESTURE_RIPPLE = 0;
const GESTURE_TWIST = 1;
const GESTURE_SIGH = 2;

// The hive ripple's shape. Amplitudes are deliberately small: this is a jostle
// running through a colony, and a shell that visibly pulsed would outrank
// `speaking` in a ladder idle is supposed to sit at the bottom of.
/** Half-width of the travelling front, in the `1 - cos` distance measure. */
const HIVE_WIDTH = 0.34;
const HIVE_INV_WIDTH = 1 / HIVE_WIDTH;
/** Radius the front adds where it is strongest, as a factor of the shell. */
const HIVE_LIFT = 0.028;
/** Event weight under the front — bigger and darker together. */
const HIVE_CREST = 0.5;
/** How close counts as "the dot that moved", in the same distance measure. */
const HIVE_BEE_D = 0.06;
/** The first move: sharper than the ripple it sets off, and very local. */
const HIVE_BEE_LIFT = 0.017;

/**
 * Which gesture is playing and how far into it, written into `out` as
 * `[which, env, local]`.
 *
 * - `which` the gesture index for this epoch, stable for the whole epoch.
 * - `env`   0–1 envelope, ZERO at both ends of the gesture and zero for the
 *           quiet remainder of the epoch. Everything a gesture does is scaled
 *           by it, which is what makes epoch boundaries silent — a gesture can
 *           never be cut off mid-movement, because it has already returned to
 *           rest before its slot ends.
 * - `local` 0–1 position within the gesture; meaningless when `env` is 0.
 *
 * The epoch length is FIXED and the start time inside it is hashed instead. A
 * jittered epoch length would make `floor(t / epoch)` disagree with itself
 * (the length it divides by is the length it is trying to select), where a
 * hashed start keeps the index exact and still puts an uneven gap between one
 * gesture and the next — which is the part that reads as unpredictable.
 */
function idleGesture(t: number, out: Float32Array): void {
  'worklet';
  const k = Math.floor(t / GESTURE_EPOCH);
  const local = t - k * GESTURE_EPOCH;
  // Somewhere in the epoch's slack, so consecutive gestures are 6–12 clock
  // units apart rather than exactly 9.
  const start = hashD(k, 7.31) * (GESTURE_EPOCH - GESTURE_SPAN);
  const u = (local - start) / GESTURE_SPAN;
  out[0] = Math.floor(hashD(k, 3.17) * GESTURE_COUNT);
  if (u <= 0 || u >= 1) {
    out[1] = 0;
    out[2] = 0;
    return;
  }
  // Raised cosine: zero value AND zero slope at both ends, so a gesture eases
  // out of the base pose and back into it.
  out[1] = 0.5 - 0.5 * Math.cos(TAU * u);
  out[2] = u;
}

/** Clock units for one assemble sweep. */
const ASSEMBLE_PERIOD = 4;
/** Clock units for one buffering sweep, pole to pole and back. */
const BUFFER_PERIOD = 2.2;
/** Clock units for one faint listening-for-a-signal ping. */
const SIGNAL_PERIOD = 5;

interface VoiceRing {
  sinLat: number;
  cosLat: number;
  cosLon: Float32Array;
  sinLon: Float32Array;
  /** First dot index of this ring, into the flat per-dot arrays. */
  base: number;
}

export interface VoiceData extends ModeStaticData {
  rings: VoiceRing[];
  /** Where each dot sits when scattered — `initializing` only. */
  scatter: Float32Array;
}

export function precomputeVoice(o: ModeOpts): VoiceData {
  const rings = o.latRings ?? 17;
  const lonDensity = o.lonDensity ?? 42;
  const out: VoiceRing[] = [];
  let dotCount = 0;
  for (let ri = 0; ri <= rings; ri++) {
    const lat = -Math.PI / 2 + (ri / rings) * Math.PI;
    const cosLat = Math.cos(lat);
    const sinLat = Math.sin(lat);
    const lonCount = Math.max(1, Math.round(Math.abs(cosLat) * lonDensity));
    const cosLon = new Float32Array(lonCount);
    const sinLon = new Float32Array(lonCount);
    for (let lj = 0; lj < lonCount; lj++) {
      const lon = (lj / lonCount) * TAU;
      cosLon[lj] = Math.cos(lon);
      sinLon[lj] = Math.sin(lon);
    }
    out.push({ sinLat, cosLat, cosLon, sinLon, base: dotCount });
    dotCount += lonCount;
  }

  const scatter = new Float32Array(dotCount);
  for (let i = 0; i < dotCount; i++) {
    // Inside the shell only — a scattered dot must not poke past the rim.
    scatter[i] = 0.16 + 0.8 * hashD(i, 3.71);
  }

  return { rings: out, scatter, dotCount };
}

/**
 * Answer one behaviour's questions about one ring, writing
 * `[rf, crest, shear, alpha, form, spike, crestGain]` into `out`.
 *
 * - `rf`    resting radius factor for the ring, against the shell radius.
 * - `crest` event weight, 0–1; drives radius UP and ink DARKER together.
 * - `shear` BOUNDED extra yaw for this ring, in radians. It must not
 *           accumulate with `t`: blending interpolates this value, so an
 *           angle like `t * rate` would differ by tens of radians late in a
 *           session and whip the shell round during a transition.
 * - `alpha` ring opacity — 1 unless the behaviour is signalling an event.
 * - `form`  how assembled the ring is; blends each dot away from its
 *           scattered position. 1 for everything but `initializing`.
 * - `spike` how far a passing WAVEFRONT displaces a dot, and which way.
 *           Positive carries dots outward (the agent's voice leaving),
 *           negative draws them in (the user's voice arriving). The
 *           wavefront's position is per-dot and lives in `buildVoice`,
 *           because it travels in screen-space radius, not ring index.
 * - `crestGain` how much a passing wavefront emphasises the dots under it.
 */
function ringState(
  b: number,
  ri: number,
  ringT: number,
  sinLat: number,
  t: number,
  amp: number,
  // Idle's gesture for this frame, resolved ONCE by the caller and handed down
  // as plain numbers. `idleGesture` is pure, so recomputing it per ring would be
  // correct — but it is the same answer seventeen times, and passing it keeps the
  // per-ring path free of hashes and floors.
  gWhich: number,
  gEnv: number,
  gLocal: number,
  out: Float32Array
): void {
  'worklet';
  out[4] = 1;
  out[5] = 0;
  out[6] = 0;

  if (b === VOICE_LISTENING) {
    // Taking the voice IN: sharp spikes lunge toward the core, three lobes
    // drifting round the shell. Fixed tempo — the mic sets only how deep
    // each lunge goes, so a loud voice makes a bigger gesture, not a faster
    // one. At silence the shell is nearly still, waiting.
    out[0] = 0.9;
    out[1] = 0;
    out[2] = 0;
    out[3] = 1;
    // NEGATIVE: the wavefronts converge, and the dots they reach are drawn
    // toward the core. The mic sets only how far each is pulled.
    out[5] = -(0.05 + 0.17 * amp);
    out[6] = 0.3 + 0.7 * amp;
    return;
  }

  if (b === VOICE_SPEAKING) {
    // Putting the voice OUT: the mirror gesture. Spikes lunge outward from
    // a shell that also swells slightly with the level, reaching wave's own
    // maximum at full volume and never past it.
    out[0] = 0.78 + 0.02 * amp;
    out[1] = 0;
    out[2] = 0;
    out[3] = 1;
    // POSITIVE: the wavefronts expand, carrying the dots they reach out
    // toward the rim — the sound leaving the orb.
    out[5] = 0.04 + 0.145 * amp;
    out[6] = 0.35 + 0.65 * amp;
    return;
  }

  if (b === VOICE_THINKING) {
    // Wave's undulation — the playground's `listening` orb — at a little
    // under half its swing. The full-width roll is too broad a gesture next
    // to the spikes either side of it in a turn; narrowing keeps the
    // character and the tempo while letting it sit as the calm middle.
    const w = waveW(t, ri);
    out[0] = 0.9 + 0.045 * w;
    out[1] = Math.max(0, w);
    out[2] = 0;
    out[3] = 1;
    return;
  }

  if (b === VOICE_CONNECTING) {
    // Straining to reach: the most urgent thing here. Fast spikes fire
    // outward over a quick swell while the bands shear hard against one
    // another — the shell visibly working, and unmistakably more agitated
    // than the dim `disconnected` it comes from.
    const sp = spikePulse(t * 3.4 - ri * 0.9);
    out[0] = 0.85 + 0.05 * Math.sin(t * 2.6 + ri * 0.5);
    out[0] += 0.07 * sp;
    out[1] = 0.25 + 0.75 * sp;
    out[2] = 0.5 * sinLat * Math.sin(t * 1.1);
    // Energetic but DIM. Motion says it is straining; faintness says it has
    // not got through. A bright, agitated shell would read as connected.
    out[3] = 0.5 + 0.35 * sp;
    return;
  }

  if (b === VOICE_BUFFERING) {
    // Through, and working: a bright band sweeps pole to pole and back —
    // the latitude counterpart of `globe`'s scan meridian. Calmer than
    // `connecting` but fuller and brighter, so the session reads as having
    // made progress rather than still struggling.
    const at = 0.5 - 0.5 * Math.cos(TAU * (t / BUFFER_PERIOD));
    const d = ringT - at;
    const band = Math.exp(-(d * d) / 0.012);
    out[0] = WAVE_BASE + 0.06 * band;
    out[1] = band;
    out[2] = 0;
    out[3] = 0.7 + 0.3 * band;
    return;
  }

  if (b === VOICE_INITIALIZING) {
    // Coming online: a formation wave sweeping pole to pole. The ramp is a
    // raised cosine, smooth at BOTH ends, so nothing ever jumps back to
    // scattered. Offsetting the phase by a full turn across the rings means
    // part of the shell is always assembled and part always arriving —
    // progressive assembly, not a repeated rebuild.
    const form = 0.5 - 0.5 * Math.cos(TAU * (t / ASSEMBLE_PERIOD + ringT));
    out[0] = WAVE_BASE + 0.02;
    // The dots that have landed arrive bigger and darker.
    out[1] = form * form;
    out[2] = 0;
    // The one legitimate alpha event: dots still in flight are faint,
    // exactly as `globe` fades everything its scan has not reached.
    out[3] = 0.6 + 0.4 * form;
    out[4] = form;
    return;
  }

  if (b === VOICE_DISCONNECTED) {
    // Straining for a signal that is not there. The shell is drawn in,
    // dim and almost motionless; every few seconds a faint ping crawls
    // across it and finds nothing. Deliberately the emptiest state — it is
    // what everything else is brighter than.
    const at = 0.5 - 0.5 * Math.cos(TAU * (t / SIGNAL_PERIOD));
    const d = ringT - at;
    const ping = Math.exp(-(d * d) / 0.02);
    out[0] = 0.8 + 0.012 * Math.sin(t * 0.5 + ri * 0.3);
    out[1] = 0.3 * ping;
    out[2] = 0;
    out[3] = 0.14 + 0.4 * ping;
    return;
  }

  // VOICE_IDLE — connected and at rest, and ALIVE rather than merely looping.
  // A live session sits here between turns and a home screen sits here for as
  // long as it is open, so this is the state most likely to be watched long
  // enough to be found out. It stays the quietest of the connected states —
  // everything below is motion SHAPE, not extra brightness or amplitude, so the
  // ladder from `disconnected` up through `thinking` still reads.
  //
  // Three sines rather than two, and the third is what stops it repeating.
  // Wave's undulation is two sines whose frequencies are a simple ratio, so it
  // returns to the same pose on a fixed loop; adding a term at an irrational
  // multiple makes the sum quasi-periodic — it never comes back to the same
  // pose, and the character drifts as the phases beat against one another. The
  // original pair keeps its own ratio and tempo, so the family pacing carries.
  // Normalised by the sum of the three weights, so `w` stays inside ±1 exactly
  // as the two-sine version did. Without this the third term would widen the
  // swing as a side effect of adding variety, and every amplitude budgeted
  // against the radius ceiling below would be wrong.
  const w =
    (0.62 * Math.sin(t * 1.05 - ri * 0.52) +
      0.38 * Math.sin(t * 0.635 + ri * 0.83) +
      0.22 * Math.sin(t * 0.4271 + ri * 0.31)) /
    1.22;
  // The breath, deepened from ±0.028 so it is legible next to the spin, and
  // SKEWED — squashed toward its own sign so the shell fills faster than it
  // empties. A symmetric sine reads as a machine at rest; an asymmetric one
  // reads as breathing.
  //
  // The amplitudes here and in the gestures below are budgeted against
  // `RF_CEILING`: 0.985 - 0.9 leaves 0.085, spent as 0.038 of breath plus at
  // most 0.045 of gesture, which keeps a hair of headroom rather than sitting
  // exactly on the clamp. Gestures are mutually exclusive — one per epoch — so
  // it is breath + the WORST gesture, never breath + all of them. Overshooting
  // would not clip (the ceiling is clamped where dots are written) but it would
  // flatten the motion at its peak, which is worse than a smaller swing.
  const breath = w > 0 ? w * (1.15 - 0.15 * w) : w * 0.8;
  out[0] = 0.9 + 0.038 * breath;
  out[1] = 0.25 * Math.max(0, w);
  // Differential twist: the equator leads and the poles lag, reversing slowly.
  // The one knob idle left at zero, and the reason it was the biggest single
  // win available here — a rigid yaw makes the shell a printed pattern on a
  // ball, where a shear that varies with latitude makes it a body that moves
  // WITHIN itself. `1 - sinLat²` is `cos²lat`: maximum at the equator, zero at
  // both poles, so nothing tears.
  //
  // BOUNDED, as this slot requires: an angle carrying `t` linearly would differ
  // by tens of radians late in a session and whip the shell round on the next
  // blend.
  const eq = 1 - sinLat * sinLat;
  out[2] = 0.1 * eq * Math.sin(t * 0.42 + 0.6 * sinLat);
  out[3] = 1;

  // ...and on top, one of idle's gestures. Only the two per-RING ones are
  // answerable here; the ripple is per-dot and lives in `buildVoice`.
  if (gEnv > 0) {
    const env = gEnv;
    const which = gWhich;
    if (which === GESTURE_TWIST) {
      // A gust through the twist: the differential shear briefly deepens and
      // runs the other way, like a breeze crossing a field. Rides the same
      // `cos²lat` profile as the base twist so it cannot tear at the poles.
      out[2] -= env * 0.16 * eq * Math.sin(t * 0.29);
    } else if (which === GESTURE_SIGH) {
      // A sigh: one deep, slow breath. The swing roughly doubles for the
      // duration and the crest lifts with it, so the shell fills visibly and
      // settles — the same gesture a body makes, and the reason it is separate
      // from the base breath rather than a bigger version of it.
      const slow = Math.sin(TAU * gLocal * 0.5);
      out[0] += env * 0.04 * slow;
      out[1] += env * 0.18 * Math.max(0, slow);
    }
  }
}

interface VoiceScratchGlobal {
  __expoThinkingOrbsVoiceA?: Float32Array;
  __expoThinkingOrbsVoiceB?: Float32Array;
  __expoThinkingOrbsVoiceG?: Float32Array;
}

export function buildVoice(
  buf: DotBuffer,
  size: number,
  t: number,
  o: ModeOpts,
  s: VoiceData,
  dyn: ModeDynamics
): void {
  'worklet';
  const g = globalThis as VoiceScratchGlobal;
  let ra = g.__expoThinkingOrbsVoiceA;
  if (ra === undefined) {
    ra = new Float32Array(7);
    g.__expoThinkingOrbsVoiceA = ra;
  }
  let rb = g.__expoThinkingOrbsVoiceB;
  if (rb === undefined) {
    rb = new Float32Array(7);
    g.__expoThinkingOrbsVoiceB = rb;
  }
  let rg = g.__expoThinkingOrbsVoiceG;
  if (rg === undefined) {
    rg = new Float32Array(3);
    g.__expoThinkingOrbsVoiceG = rg;
  }

  const cx = size / 2;
  const cy = size / 2;
  // Wave's own radius, spin and tilt, so the voice orb sits at exactly the
  // scale and pace of the playground animations. One shared base rotation
  // for every behaviour: a state change must never alter the accumulated
  // yaw, or blending would whip the shell round. Bounded shear rides on top.
  let amp = dyn.amp;
  if (!(amp > 0)) amp = 0;
  else if (amp > 1) amp = 1;
  const from = dyn.from;
  const to = dyn.to;
  let mix = dyn.mix;
  if (!(mix > 0)) mix = 0;
  else if (mix > 1) mix = 1;

  const R = (size / 2) * 0.874;
  // Idle's gesture, resolved once for the whole frame — see `idleGesture`. Both
  // the per-ring poses and the per-dot ripple below read it, and it is a pure
  // function of `t`, so one evaluation is the same answer either would compute.
  idleGesture(t, rg);
  const gWhich = rg[0]!;
  const gEnv = rg[1]!;
  const gLocal = rg[2]!;
  // How much of this frame is IDLE, from the same blend the poses use. Every
  // idle-only flourish is scaled by it, so a call starting mid-gesture fades the
  // gesture out over the blend instead of cutting it — and non-idle frames skip
  // the work entirely rather than multiplying by zero per dot.
  const idleW =
    (from === VOICE_IDLE ? 1 - mix : 0) + (to === VOICE_IDLE ? mix : 0);
  // --- the hive ripple, set up once per frame -------------------------
  //
  // One dot twitches and the disturbance travels out across the SURFACE, dying
  // away as it spreads — a jostle passing through a dense colony rather than a
  // concentric pulse on the screen. That distinction is why it cannot live in
  // `ringState`: a front spreading from a point crosses each latitude ring at a
  // different longitude, so it is per-dot by nature.
  const hiving = idleW > 0 && gEnv > 0 && gWhich === GESTURE_RIPPLE;
  // Where the first dot moved. Uniform on the sphere (`oy` uniform in height is
  // what makes it uniform in AREA), hashed off the epoch — so the origin is a
  // different place every time and is nonetheless a pure function of the clock.
  let ox = 0;
  let oy = 1;
  let oz = 0;
  // The front's position, in the same `1 - cos` measure the per-dot distance
  // uses. Advanced through a cosine so the front travels at a CONSTANT ANGULAR
  // speed — one cosine per frame here, rather than an `acos` per dot to convert
  // the other way.
  let front = 0;
  let hiveDecay = 0;
  if (hiving) {
    const k = Math.floor(t / GESTURE_EPOCH);
    oy = 2 * hashD(k, 11.13) - 1;
    const ring = Math.sqrt(Math.max(0, 1 - oy * oy));
    const az = TAU * hashD(k, 19.07);
    ox = ring * Math.cos(az);
    oz = ring * Math.sin(az);
    // Reaches the far side just as the envelope closes, so the front never has
    // to be cut off — it has already run out of surface.
    front = 1 - Math.cos(Math.PI * gLocal);
    // ...and fades as it goes, the way a disturbance loses energy to the dots it
    // has already moved. `gEnv` alone would let the far side move as much as the
    // origin did, which reads as a pulse rather than a ripple.
    hiveDecay = idleW * gEnv * (1 - 0.75 * gLocal);
  }
  // The spin BREATHES rather than ticking: a bounded wobble on the rate, and a
  // slow wander of the axis, both scaled by `idleW` so only idle drifts.
  //
  // The deviation is bounded while the base `t * 0.18` accumulates, which is the
  // rule this slot has always had — an accumulating extra term would differ by
  // tens of radians late in a session and whip the shell round on the next blend.
  const pt = makeProj(
    t * 0.18 + idleW * 0.06 * Math.sin(t * 0.27) + dyn.yaw,
    0.38 + idleW * 0.05 * Math.sin(t * 0.19 + 1.1) + dyn.pitch,
    cx,
    cy,
    1,
    dyn.roll + idleW * 0.03 * Math.sin(t * 0.13),
    dyn.orient
  );
  // `dyn.rMul` folds in HERE rather than at each radius expression, so every
  // radius this mode derives from `rs` — dots, ghosts, particles — carries it
  // for free, and a mode cannot pick up a dot-weight knob for some of its marks
  // and not others.
  const rs = radiusScale(size, o.rsPow ?? 0.6) * dyn.rMul;
  const rBase = o.rBase ?? 0.6;
  const rDepth = o.rDepth ?? 1.7;
  const inkFar = o.inkFar ?? 0.66;
  const inkSpan = o.inkSpan ?? 0.56;

  // Skip the second evaluation once a transition has landed — the steady
  // state is the overwhelmingly common one.
  const blending = mix < 1 && from !== to;

  const p = new Float32Array(3);
  const xs = buf.xs;
  const ys = buf.ys;
  const zs = buf.zs;
  const brs = buf.rs;
  const bws = buf.ws;
  const bas = buf.as;
  const rings = s.rings;
  const nRings = rings.length;

  for (let ri = 0; ri < nRings; ri++) {
    const ring = rings[ri];
    const ringT = ri / (nRings - 1);
    const sinLat = ring.sinLat;
    const cosLat = ring.cosLat;

    ringState(
      blending ? from : to,
      ri,
      ringT,
      sinLat,
      t,
      amp,
      gWhich,
      gEnv,
      gLocal,
      ra
    );
    let rf = ra[0];
    let crest = ra[1];
    let shear = ra[2];
    let alpha = ra[3];
    let form = ra[4];
    // The two wavefront terms are deliberately NOT blended into a single
    // value here. Everything above is a scalar pose that interpolates
    // meaningfully, but a pair of counter-travelling waves does not: their
    // average is a wave with a direction neither behaviour has. They are
    // carried per behaviour and their CONTRIBUTIONS blended, in the ripple
    // block below.
    const spikeA = ra[5];
    const crestGainA = ra[6];
    let spikeB = spikeA;
    let crestGainB = crestGainA;
    if (blending) {
      ringState(to, ri, ringT, sinLat, t, amp, gWhich, gEnv, gLocal, rb);
      rf += (rb[0] - rf) * mix;
      crest += (rb[1] - crest) * mix;
      shear += (rb[2] - shear) * mix;
      alpha += (rb[3] - alpha) * mix;
      form += (rb[4] - form) * mix;
      spikeB = rb[5];
      crestGainB = rb[6];
    }

    const cs = Math.cos(shear);
    const sn = Math.sin(shear);
    const cosLon = ring.cosLon;
    const sinLon = ring.sinLon;
    const base = ring.base;
    const scattered = form < 0.999;
    const rippling = spikeA !== 0 || spikeB !== 0;
    // The travelling phase, wrapped into one period. `ripplePulse` has
    // period TAU, so wrapping is bit-identical to the unwrapped
    // `TAU * RIPPLE_RATE * t` — but the phase stays bounded no matter how
    // long a session runs, which the family grammar requires of anything
    // carrying `t`.
    const cycles = RIPPLE_RATE * t;
    const ph = TAU * (cycles - Math.floor(cycles));
    // Outward-carrying wavefronts travel out, inward-carrying ones travel
    // in, so the motion of the wave and the motion of the dots agree.
    //
    // Direction is read from each BEHAVIOUR's own spike, never from a
    // blended one. A blended spike sweeps through zero on any direct
    // listening ↔ speaking change — a barge-in — and flipping the sign of
    // an accumulated phase at that moment teleported the whole wavefront
    // pattern by an amount proportional to session uptime. Per behaviour,
    // each sign is fixed for the whole blend, so nothing flips.
    const flowA = spikeA >= 0 ? -ph : ph;
    const flowB = spikeB >= 0 ? -ph : ph;

    for (let lj = 0; lj < cosLon.length; lj++) {
      // Project the UNIT vector: the projection is linear, so scaling
      // afterwards is identical to projecting the scaled vector — and this
      // way the dot's screen-space radius is known BEFORE it is displaced,
      // which is what the wavefront needs to travel through.
      const ux = cosLat * cosLon[lj];
      const uz = cosLat * sinLon[lj];
      pt(ux * cs + uz * sn, sinLat, -ux * sn + uz * cs, p);
      const dx = p[0] - cx;
      const dy = p[1] - cy;
      const dz = p[2];

      let dr = rf;
      let dotCrest = crest;
      if (hiving) {
        // Angular distance from the origin, as `1 - cos` — a dot product, no
        // trig. Measured on the PRE-shear vector deliberately: the shear twists
        // the surface, and anchoring the origin after it would make the ripple's
        // source slide around the shell as the twist moved.
        const c = ux * ox + sinLat * oy + uz * oz;
        const d = 1 - c;
        // A quadratic bump instead of a gaussian: same shape where it matters,
        // no `exp` per dot, and exactly zero outside the front's width so most
        // dots cost a compare. The width is constant in the `1 - cos` measure,
        // so the front reads a little broader as it crosses the far hemisphere —
        // which flatters a dying ripple rather than fighting it.
        const x = (d - front) * HIVE_INV_WIDTH;
        if (x > -1 && x < 1) {
          const b = 1 - x * x;
          const bump = b * b;
          // The dots the front reaches lift and darken together, the coupling
          // every behaviour here uses for an event.
          dr += HIVE_LIFT * bump * hiveDecay;
          dotCrest += HIVE_CREST * bump * hiveDecay;
        }
        // The bee itself: a tighter, sharper move right at the origin over the
        // first fifth of the gesture, before the ripple has gone anywhere. This
        // is the part that makes it read as CAUSED — something moved, and then
        // the surface answered.
        if (gLocal < 0.2 && d < HIVE_BEE_D) {
          const near = 1 - d / HIVE_BEE_D;
          const kick = Math.sin(Math.PI * (gLocal / 0.2));
          dr += HIVE_BEE_LIFT * near * near * kick * idleW * gEnv;
        }
      }
      if (rippling) {
        // Distance from the centre of the disc, 0 at the middle and 1 at
        // the silhouette. Concentric wavefronts sweep across it, so every
        // dot the same distance out moves together — the coherence that
        // the earlier per-dot version threw away.
        const sr = Math.sqrt(dx * dx + dy * dy);
        const kr = TAU * RIPPLE_K * sr;
        const ripA = ripplePulse(kr + flowA);
        let drAdd = spikeA * ripA;
        let crestAdd = crestGainA * ripA;
        if (blending) {
          // Both waves, each in its own direction, crossfaded — the same
          // idiom the ring pose above uses, applied one level deeper. The
          // second evaluation costs a `sin` per dot, and only during the
          // ~280 ms a transition is live.
          const ripB = ripplePulse(kr + flowB);
          drAdd += (spikeB * ripB - drAdd) * mix;
          crestAdd += (crestGainB * ripB - crestAdd) * mix;
        }
        dr += drAdd;
        dotCrest += crestAdd;
      }
      if (scattered) {
        const sc = s.scatter[base + lj];
        dr = sc + (dr - sc) * form;
      }
      if (dr > RF_CEILING) dr = RF_CEILING;
      const rr = R * dr;

      let depth = (dz + 1) / 2;
      if (depth < 0) depth = 0;
      else if (depth > 1) depth = 1;

      const j = buf.count++;
      xs[j] = cx + dx * rr;
      ys[j] = cy + dy * rr;
      zs[j] = dz * rr;
      // The family coupling: a crest makes a dot bigger AND darker at the
      // same instant. Never one without the other.
      brs[j] = (rBase + rDepth * depth) * (1 + 0.4 * dotCrest) * rs;
      bws[j] = inkFar - inkSpan * depth - 0.1 * dotCrest;
      bas[j] = alpha;
    }
  }
}
