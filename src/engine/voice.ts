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

  // VOICE_IDLE — connected and at rest, but breathing. Wave's undulation at
  // half tempo (the ratio between its two sines preserved, so the character
  // carries) and a quarter of the swing. A live session sits here between
  // turns, so it is deliberately the quietest of the connected states — but
  // still plainly fuller and brighter than `disconnected`.
  const w =
    0.62 * Math.sin(t * 1.05 - ri * 0.52) +
    0.38 * Math.sin(t * 0.635 + ri * 0.83);
  out[0] = 0.9 + 0.028 * w;
  out[1] = 0.25 * Math.max(0, w);
  out[2] = 0;
  out[3] = 1;
}

interface VoiceScratchGlobal {
  __expoThinkingOrbsVoiceA?: Float32Array;
  __expoThinkingOrbsVoiceB?: Float32Array;
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

  const cx = size / 2;
  const cy = size / 2;
  // Wave's own radius, spin and tilt, so the voice orb sits at exactly the
  // scale and pace of the playground animations. One shared base rotation
  // for every behaviour: a state change must never alter the accumulated
  // yaw, or blending would whip the shell round. Bounded shear rides on top.
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
  // `dyn.rMul` folds in HERE rather than at each radius expression, so every
  // radius this mode derives from `rs` — dots, ghosts, particles — carries it
  // for free, and a mode cannot pick up a dot-weight knob for some of its marks
  // and not others.
  const rs = radiusScale(size, o.rsPow ?? 0.6) * dyn.rMul;
  const rBase = o.rBase ?? 0.6;
  const rDepth = o.rDepth ?? 1.7;
  const inkFar = o.inkFar ?? 0.66;
  const inkSpan = o.inkSpan ?? 0.56;

  let amp = dyn.amp;
  if (!(amp > 0)) amp = 0;
  else if (amp > 1) amp = 1;
  const from = dyn.from;
  const to = dyn.to;
  let mix = dyn.mix;
  if (!(mix > 0)) mix = 0;
  else if (mix > 1) mix = 1;
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

    ringState(blending ? from : to, ri, ringT, sinLat, t, amp, ra);
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
      ringState(to, ri, ringT, sinLat, t, amp, rb);
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
