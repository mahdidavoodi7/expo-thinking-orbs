// Raw PCM → three band levels the orb can read every frame.
//
// `useVoiceAmplitude` gives the orb ONE number, which can only ever say
// "louder" or "quieter". That is enough to make the shell breathe and not
// enough to make it look like it is following speech: a held vowel and a
// sharp consonant produce the same scalar. This hook is the band-aware
// counterpart — same contract, three outputs instead of one.
//
// The split is a three-band one-pole crossover rather than an FFT. An FFT
// is the obvious tool and the wrong one here: the orb consumes three
// scalars, so paying O(n log n) and a windowing decision to compute a
// spectrum we immediately collapse to three numbers buys nothing. Two
// one-pole lowpasses cost a multiply-add per sample, run happily inside a
// 32 ms audio callback, and carry their filter state across callbacks so
// the band edges do not smear at buffer boundaries.
//
// This is direction-agnostic on purpose. The microphone and the agent's
// output are both just PCM: use one instance per direction and hand them
// to `inputLevels` and `outputLevels`. Nothing here records or retains
// audio — samples are read once and the levels are all that survive.

import { useCallback, useMemo, useRef } from 'react';
import { useSharedValue, type SharedValue } from 'react-native-reanimated';

/** Crossover corner between the low and mid bands, in Hz. */
const LOW_HZ = 250;
/** Crossover corner between the mid and high bands, in Hz. */
const MID_HZ = 2000;
/** Sample rate assumed when a caller does not supply one. */
const DEFAULT_SAMPLE_RATE = 16_000;

/**
 * Per-band gains. Speech energy falls off steeply with frequency — a
 * band-split of ordinary speech is roughly 10:3:1 low:mid:high by RMS — so
 * without correction the mid and high bands would never leave the bottom
 * of their range and the ripple and ink terms would be invisible. These
 * bring all three into a comparable 0–1 range for the same voice.
 *
 * PROVISIONAL. Derived from that ratio, not measured against a real
 * microphone — no signal has been through this hook yet. Check the band
 * values against live speech before treating them as tuned: if they pin at
 * 1.0, the orb has no dynamic range left and these are the numbers to cut.
 */
const LOW_GAIN = 3.2;
const MID_GAIN = 9;
const HIGH_GAIN = 22;

/**
 * Voice-activity hysteresis, on the summed level. Two thresholds rather
 * than one: a single threshold sitting anywhere near the noise floor
 * chatters on and off between syllables, and the orb flickers with it.
 * Once speech opens the gate it stays open until the level falls well
 * below where it opened.
 *
 * PROVISIONAL, like the gains above — these thresholds are relative to a
 * noise floor nobody has measured here.
 */
const VAD_OPEN = 0.06;
const VAD_CLOSE = 0.025;

export interface VoiceLevels {
  /**
   * Overall level, 0–1 — the same signal `useVoiceAmplitude` produces, so
   * this can drive `inputAmplitude` / `outputAmplitude` directly.
   */
  readonly level: SharedValue<number>;
  /** Sub-250 Hz energy, 0–1. Drives the shell's swell. */
  readonly low: SharedValue<number>;
  /** 250 Hz–2 kHz energy, 0–1. Drives the travelling ripple. */
  readonly mid: SharedValue<number>;
  /** 2 kHz+ energy, 0–1. Drives the ink. */
  readonly high: SharedValue<number>;
  /**
   * Feed one block of PCM samples in `-1..1`. Call it from whatever hands
   * you audio — a recorder's buffer callback, or the frames you are about
   * to play back. `sampleRate` defaults to 16 kHz; pass the real one when
   * it differs, or the band edges land at the wrong frequencies.
   */
  readonly setSamples: (
    samples: ArrayLike<number>,
    sampleRate?: number
  ) => void;
  /** Drop all four levels to silence, e.g. when a turn ends. */
  readonly reset: () => void;
}

export interface UseVoiceLevelsOptions {
  /**
   * Curve applied to each band after normalising. Below 1 lifts quiet
   * speech; above 1 reserves the big gestures for real peaks.
   * @default 0.7
   */
  curve?: number;
  /** Sample rate used when `setSamples` is called without one. */
  sampleRate?: number;
}

/** One-pole lowpass coefficient for a corner frequency at a sample rate. */
function poleCoeff(hz: number, sampleRate: number): number {
  const x = (2 * Math.PI * hz) / sampleRate;
  // 1 - e^-x is the exact step response of the pole; the naive x/(1+x)
  // approximation drifts badly once the corner is a large fraction of the
  // rate, which 2 kHz at 16 kHz already is.
  const a = 1 - Math.exp(-x);
  return a > 1 ? 1 : a < 0 ? 0 : a;
}

/**
 * Own the three band levels a voice orb reads each frame, split from raw
 * PCM.
 *
 * ```tsx
 * const mic = useVoiceLevels();
 * const agent = useVoiceLevels();
 *
 * recorder.onAudio((buf) => mic.setSamples(buf.channels[0], buf.sampleRate));
 * player.onFrames((pcm) => agent.setSamples(pcm, 24_000));
 *
 * <VoiceOrb
 *   state={state}
 *   inputAmplitude={mic.level}
 *   inputLevels={mic}
 *   outputAmplitude={agent.level}
 *   outputLevels={agent}
 * />
 * ```
 *
 * Smoothing lives in the orb (fast attack, slow release), so feed this raw
 * audio — pre-smoothing here would only make the orb lag the voice.
 */
export function useVoiceLevels(
  options: UseVoiceLevelsOptions = {}
): VoiceLevels {
  const { curve = 0.7, sampleRate: defaultRate = DEFAULT_SAMPLE_RATE } =
    options;

  const level = useSharedValue(0);
  const low = useSharedValue(0);
  const mid = useSharedValue(0);
  const high = useSharedValue(0);

  // Filter state and the VAD gate persist ACROSS callbacks. Resetting them
  // per block would make each buffer boundary a discontinuity the filters
  // then have to settle out of, which is audible as a per-block flutter in
  // the mid and high bands.
  const lp1 = useRef(0);
  const lp2 = useRef(0);
  const open = useRef(false);

  const reset = useCallback(() => {
    level.set(0);
    low.set(0);
    mid.set(0);
    high.set(0);
    lp1.current = 0;
    lp2.current = 0;
    open.current = false;
  }, [level, low, mid, high]);

  const setSamples = useCallback(
    (samples: ArrayLike<number>, sampleRate?: number) => {
      const n = samples.length;
      if (n === 0) return;

      const rate = sampleRate && sampleRate > 0 ? sampleRate : defaultRate;
      const a1 = poleCoeff(LOW_HZ, rate);
      const a2 = poleCoeff(MID_HZ, rate);

      let y1 = lp1.current;
      let y2 = lp2.current;
      let sLow = 0;
      let sMid = 0;
      let sHigh = 0;

      for (let i = 0; i < n; i += 1) {
        const x = samples[i]!;
        // Two cascaded corners give three complementary bands whose sum is
        // the original signal: below 250, between, and above 2k.
        y1 += a1 * (x - y1);
        y2 += a2 * (x - y2);
        const bLow = y1;
        const bMid = y2 - y1;
        const bHigh = x - y2;
        sLow += bLow * bLow;
        sMid += bMid * bMid;
        sHigh += bHigh * bHigh;
      }

      // A NaN in the input would poison the filter state permanently —
      // every later block would inherit it. Reset instead of storing it.
      if (!Number.isFinite(y1) || !Number.isFinite(y2)) {
        reset();
        return;
      }
      lp1.current = y1;
      lp2.current = y2;

      const rLow = Math.sqrt(sLow / n) * LOW_GAIN;
      const rMid = Math.sqrt(sMid / n) * MID_GAIN;
      const rHigh = Math.sqrt(sHigh / n) * HIGH_GAIN;

      // Gate on the pre-curve sum so the threshold means the same thing
      // regardless of how the curve is tuned.
      const raw = (rLow + rMid + rHigh) / 3;
      open.current = open.current ? raw > VAD_CLOSE : raw > VAD_OPEN;
      if (!open.current) {
        // A target of 0, not a freeze: the orb's release filter carries the
        // shell down rather than dropping it.
        level.set(0);
        low.set(0);
        mid.set(0);
        high.set(0);
        return;
      }

      const shape = (v: number) => {
        const c = v > 1 ? 1 : v;
        return Number.isNaN(c) ? 0 : c ** curve;
      };

      low.set(shape(rLow));
      mid.set(shape(rMid));
      high.set(shape(rHigh));
      level.set(shape(raw > 1 ? 1 : raw));
    },
    [level, low, mid, high, curve, defaultRate, reset]
  );

  return useMemo(
    () => ({ level, low, mid, high, setSamples, reset }),
    [level, low, mid, high, setSamples, reset]
  );
}
