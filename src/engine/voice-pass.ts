// A band-reactive pass over the FINISHED dot cloud.
//
// The voice behaviours in `voice.ts` are a mode: they decide where dots
// go. This is the opposite — it runs after a mode's `build` has filled the
// buffer and before `recordPicture` consumes it, and only moves dots that
// are already there. That placement is the whole point: it composes with
// every mode rather than being wired into one, so the six ported
// animations become audio-reactive without their build functions changing
// (and without their poses changing at all when no audio is supplied).
//
// Three bands, three distinct jobs — chosen so that a change in the voice
// is legible as a change in the SHAPE, not just an overall size wobble:
//
//   low   — swell. Bulk radial displacement. Vowels and the fundamental
//           live here, so this is the part that tracks "someone is
//           talking" rather than what they are saying.
//   mid   — ripple. A travelling radial wave, and the crest also fattens
//           the dot it passes. Most speech articulation sits in this band,
//           so this is what makes the orb look like it is following words.
//   high  — ink. Sibilance and transients darken the dots without moving
//           them, which reads as brightness rather than motion.
//
// Splitting the response this way is what stops a loud vowel and a sharp
// consonant from looking identical, which is all a single RMS scalar can
// ever say.

import type { DotBuffer } from './scratch';

/**
 * Peak outward displacement from the low band, as a fraction of a dot's
 * distance from the centre. Small on purpose: the shell reads as breathing
 * at 0.09 and as a bouncing ball well before 0.2.
 */
const SWELL = 0.09;
/** Peak displacement of the travelling mid-band wave, same units. */
const RIPPLE = 0.055;
/**
 * Radians of wave across the shell's radius. Around two crests visible at
 * once — enough to read as travelling, few enough that neighbouring dots
 * stay correlated and the cloud does not turn to noise.
 */
const RIPPLE_K = 7.5;
/** Wave travel, radians per second of orb time. Negative travels outward. */
const RIPPLE_SPEED = -4.2;
/** Peak radius gain from the low band, as a fraction of the dot's radius. */
const FATTEN = 0.35;
/** Extra radius gain riding the mid-band crest. */
const FATTEN_CREST = 0.3;
/**
 * Peak ink shift from the high band. `ws` is 0 at the darkest ink, so this
 * SUBTRACTS. Kept well under the modes' own depth ramp (`inkSpan`) so a
 * loud sibilant never flattens the near/far read the ramp encodes.
 */
const INK = 0.22;

/**
 * Displace, fatten and ink a built dot cloud according to three smoothed
 * audio bands, in place.
 *
 * A no-op when every band is silent, so a mode driven without audio paints
 * exactly the pose it built — the six ported animations are unchanged
 * unless a caller actually feeds them a voice.
 *
 * @param buf   Filled by a mode's `build` this frame; mutated in place.
 * @param size  Rendered size in points (the cloud is centred on size/2).
 * @param t     Orb time in seconds, for the wave's phase.
 * @param low   Smoothed sub-250 Hz energy, 0–1.
 * @param mid   Smoothed 250 Hz–2 kHz energy, 0–1.
 * @param high  Smoothed 2 kHz+ energy, 0–1.
 */
export function applyVoicePass(
  buf: DotBuffer,
  size: number,
  t: number,
  low: number,
  mid: number,
  high: number
): void {
  'worklet';
  // Silence must cost nothing and change nothing: this is the guard that
  // keeps the faithful port faithful for every caller not driving audio.
  if (low <= 0 && mid <= 0 && high <= 0) return;

  const swell = SWELL * low;
  const ripple = RIPPLE * mid;
  const fatten = FATTEN * low;
  const crest = FATTEN_CREST * mid;
  const ink = INK * high;

  const c = size * 0.5;
  // Normalise distance by the half-size so the wave's wavelength is a
  // fraction of the shell rather than a pixel count — the pass then reads
  // identically at 20 pt and at 240 pt.
  const inv = c > 0 ? 1 / c : 0;
  const phase = t * RIPPLE_SPEED;

  const xs = buf.xs;
  const ys = buf.ys;
  const rs = buf.rs;
  const ws = buf.ws;
  const n = buf.count;

  for (let i = 0; i < n; i += 1) {
    const dx = xs[i]! - c;
    const dy = ys[i]! - c;
    const d = Math.sqrt(dx * dx + dy * dy);

    // The wave is a function of RADIUS, so a dot sitting exactly on the
    // centre has no direction to be pushed along. Leave it where it is and
    // give it the trough value rather than dividing by zero.
    const wave = d * inv > 0 ? Math.sin(phase + d * inv * RIPPLE_K) : -1;

    if (d > 1e-6) {
      const k = 1 + swell + ripple * wave;
      xs[i] = c + dx * k;
      ys[i] = c + dy * k;
    }

    rs[i] = rs[i]! * (1 + fatten + crest * (0.5 + 0.5 * wave));

    // Clamp: `ws` indexes the colour LUT, and a value off either end would
    // sample past it.
    const w = ws[i]! - ink * (0.5 + 0.5 * wave);
    ws[i] = w < 0 ? 0 : w > 1 ? 1 : w;
  }
}
