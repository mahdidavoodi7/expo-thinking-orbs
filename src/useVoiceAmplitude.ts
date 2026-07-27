// Bridging a real audio source into the orb.
//
// This package renders; it does not capture audio. Getting a level is the
// host app's job, and every stack exposes one differently — LiveKit hands
// you a normalised 0–1, expo-audio hands you dBFS, a raw PCM stream hands
// you samples. What they share is the awkward part: the level arrives on
// the JS thread at whatever rate the source ticks, and the orb reads it on
// the UI thread every frame.
//
// This hook is that bridge, and nothing more. It owns a SharedValue, gives
// you setters that write to it without re-rendering React, and converts the
// two formats you are actually likely to have.

import { useCallback, useMemo } from 'react';
import { useSharedValue, type SharedValue } from 'react-native-reanimated';

/**
 * Quietest level treated as silence, in dBFS. Speech on a phone mic
 * typically runs about −40 dB (a quiet room) to −5 dB (close talking), so
 * anchoring the floor here spends the orb's whole range on real speech
 * instead of on the noise underneath it.
 */
const DEFAULT_FLOOR_DB = -45;

export interface VoiceAmplitude {
  /**
   * Pass to `<VoiceOrb inputAmplitude={…}>` or `outputAmplitude`. Read on
   * the UI thread each frame; never read it from React.
   */
  readonly level: SharedValue<number>;
  /** Set from an already-normalised 0–1 source. Values are clamped. */
  readonly set: (value: number) => void;
  /**
   * Set from a dBFS meter (`expo-audio`, `expo-av`, `AVAudioRecorder`…),
   * mapping `floorDb`→0 and 0 dB→1 on an ear-shaped curve.
   */
  readonly setDb: (db: number) => void;
  /**
   * Set from a block of PCM samples in `-1..1`, using their RMS. Use when
   * you are handling raw audio frames — a Gemini Live / Realtime output
   * stream, say — rather than a metering callback.
   */
  readonly setSamples: (samples: ArrayLike<number>) => void;
}

export interface UseVoiceAmplitudeOptions {
  /** dBFS treated as silence by `setDb`. @default -45 */
  floorDb?: number;
  /**
   * Curve applied after normalising, before the orb sees it. Below 1
   * lifts quiet speech (a fuller orb at conversational volume); above 1
   * reserves the big gestures for genuine peaks. @default 0.7
   */
  curve?: number;
}

/**
 * Own a 0–1 audio level the voice orb can read every frame.
 *
 * ```tsx
 * const mic = useVoiceAmplitude();
 * const agent = useVoiceAmplitude();
 *
 * // …wherever your levels arrive:
 * recorder.setOnAudioSampleReceived((s) => mic.setSamples(s.channels[0].frames));
 * session.on('output-level', (db) => agent.setDb(db));
 *
 * <VoiceOrb
 *   state={state}
 *   inputAmplitude={mic.level}
 *   outputAmplitude={agent.level}
 * />
 * ```
 *
 * Smoothing lives in the orb (fast attack, slow release), so feed this a
 * raw meter — pre-smoothing on top will only make it lag the voice.
 */
export function useVoiceAmplitude(
  options: UseVoiceAmplitudeOptions = {}
): VoiceAmplitude {
  const { floorDb = DEFAULT_FLOOR_DB, curve = 0.7 } = options;
  const level = useSharedValue(0);

  const set = useCallback(
    (value: number) => {
      // `!(v > 0)` rather than `v < 0` so a NaN from a stalled meter lands
      // on silence instead of poisoning every dot coordinate.
      level.value = !(value > 0) ? 0 : value > 1 ? 1 : value;
    },
    [level]
  );

  const setDb = useCallback(
    (db: number) => {
      if (Number.isNaN(db)) {
        level.value = 0;
        return;
      }
      const norm = (db - floorDb) / -floorDb;
      const clamped = norm < 0 ? 0 : norm > 1 ? 1 : norm;
      level.value = clamped ** curve;
    },
    [level, floorDb, curve]
  );

  const setSamples = useCallback(
    (samples: ArrayLike<number>) => {
      const n = samples.length;
      if (n === 0) {
        level.value = 0;
        return;
      }
      let sum = 0;
      for (let i = 0; i < n; i++) {
        const v = samples[i];
        sum += v * v;
      }
      const rms = Math.sqrt(sum / n);
      // RMS of speech is far below its peak, so a raw RMS barely moves the
      // orb. The same curve as setDb, over a headroom-adjusted range.
      const norm = Math.min(1, rms * 3.2);
      level.value = Number.isNaN(norm) ? 0 : norm ** curve;
    },
    [level, curve]
  );

  return useMemo(
    () => ({ level, set, setDb, setSamples }),
    [level, set, setDb, setSamples]
  );
}
