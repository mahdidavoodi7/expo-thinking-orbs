// Voice — VoiceOrb driven through a full agent lifecycle.
//
// There is no microphone here: a frame callback synthesises a speech-like
// envelope on the UI thread and writes it into the same SharedValue a real
// app would write mic / output levels into, so the swell behaves exactly
// as it will in production. Tap a state to see it.
import { useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import {
  useFrameCallback,
  useSharedValue,
  type SharedValue,
} from 'react-native-reanimated';
import {
  useVoiceLevels,
  VoiceOrb,
  type VoiceOrbState,
} from 'expo-thinking-orbs';

const STATES: VoiceOrbState[] = [
  'disconnected',
  'connecting',
  'pre-connect-buffering',
  'initializing',
  'idle',
  'listening',
  'thinking',
  'speaking',
  'failed',
];

/**
 * Synthesise a speech-like 0–1 envelope on the UI thread: syllables at a
 * few hertz, a slower phrase contour over the top, and gaps where a
 * speaker would draw breath. Stands in for a real level meter.
 */
function useFakeLevel(active: boolean): SharedValue<number> {
  const level = useSharedValue(0);
  const t = useSharedValue(0);

  const frame = useFrameCallback((info) => {
    'worklet';
    const dt = Math.min(info.timeSincePreviousFrame ?? 0, 100) / 1000;
    t.value += dt;
    const x = t.value;
    const syllable = 0.5 + 0.5 * Math.sin(x * 13.0);
    const phrase = 0.5 + 0.5 * Math.sin(x * 1.7 + 0.9);
    const breath = Math.sin(x * 0.55) > -0.75 ? 1 : 0;
    level.value = Math.min(1, syllable * (0.35 + 0.65 * phrase) * breath);
  }, false);

  // Just stop synthesising. The level is deliberately left where it lies:
  // VoiceOrb ignores amplitude outside `listening`/`speaking` and releases
  // its own smoothed level through RELEASE_MS, so zeroing here would only
  // race that release.
  useEffect(() => {
    frame.setActive(active);
  }, [active, frame]);

  return level;
}

/** Samples per synthesised block — 32 ms at 16 kHz, a typical mic callback. */
const BLOCK = 512;
const RATE = 16_000;

/**
 * Synthesise a block of speech-like PCM and push it through
 * {@linkcode useVoiceLevels}, on the same ~32 ms cadence a recorder would
 * deliver buffers on.
 *
 * Deliberately PCM rather than three levels written directly: the crossover,
 * its cross-block filter state, the per-band gains and the VAD gate are all
 * real code with real constants, and writing bands straight into the shared
 * values would leave every one of them unexecuted. The signal is three
 * formant-ish tones plus a breath of noise, gated by the same syllable /
 * phrase envelope as `useFakeLevel`, so the three bands actually differ
 * from one another instead of moving as one.
 */
function useFakeBands(active: boolean) {
  const levels = useVoiceLevels({ sampleRate: RATE });
  const { setSamples, reset } = levels;

  useEffect(() => {
    if (!active) {
      reset();
      return;
    }
    const buf = new Float32Array(BLOCK);
    let n = 0;
    const id = setInterval(() => {
      const base = n / RATE;
      const syllable = 0.5 + 0.5 * Math.sin(base * 13.0);
      const phrase = 0.5 + 0.5 * Math.sin(base * 1.7 + 0.9);
      const breath = Math.sin(base * 0.55) > -0.75 ? 1 : 0;
      const env = syllable * (0.35 + 0.65 * phrase) * breath;
      for (let i = 0; i < BLOCK; i += 1) {
        const s = (n + i) / RATE;
        buf[i] =
          env *
          (0.6 * Math.sin(2 * Math.PI * 120 * s) +
            0.3 * Math.sin(2 * Math.PI * 850 * s) +
            0.1 * (Math.random() * 2 - 1));
      }
      n += BLOCK;
      setSamples(buf, RATE);
    }, 32);
    return () => clearInterval(id);
  }, [active, setSamples, reset]);

  return levels;
}

export function VoiceScreen({ dark }: { dark: boolean }) {
  const [state, setState] = useState<VoiceOrbState>('listening');

  // Only the direction in play needs a live level; VoiceOrb ignores the
  // other one anyway, so there is no point burning a frame callback on it.
  const input = useFakeLevel(state === 'listening');
  const output = useFakeLevel(state === 'speaking');
  const inputBands = useFakeBands(state === 'listening');
  const outputBands = useFakeBands(state === 'speaking');

  const fg = dark ? '#fafafa' : '#0b0b0c';
  const mutedFg = dark ? '#8a8a8f' : '#6b6b70';
  const card = dark ? '#161618' : '#f5f5f7';
  const chipBg = dark ? '#1e1e22' : '#ececef';
  const chipOn = dark ? '#3a3a42' : '#d7d7de';

  return (
    <ScrollView contentContainerStyle={styles.content}>
      <View style={[styles.stage, { backgroundColor: card }]}>
        <VoiceOrb
          state={state}
          size={180}
          inputAmplitude={input}
          outputAmplitude={output}
          inputLevels={inputBands}
          outputLevels={outputBands}
        />
        <Text style={[styles.stageLabel, { color: fg }]}>{state}</Text>
        <Text style={[styles.stageHint, { color: mutedFg }]}>
          {state === 'listening'
            ? 'swelling with the microphone level'
            : state === 'speaking'
              ? 'swelling with the agent’s output level'
              : 'amplitude ignored in this state'}
        </Text>
      </View>

      <View style={styles.chips}>
        {STATES.map((s) => {
          const active = s === state;
          return (
            <Pressable
              key={s}
              onPress={() => setState(s)}
              style={[
                styles.chip,
                { backgroundColor: active ? chipOn : chipBg },
              ]}
              accessibilityRole="button"
              accessibilityState={{ selected: active }}
            >
              <Text style={[styles.chipText, { color: active ? fg : mutedFg }]}>
                {s}
              </Text>
            </Pressable>
          );
        })}
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: {
    padding: 16,
    gap: 14,
  },
  stage: {
    borderRadius: 20,
    paddingVertical: 28,
    alignItems: 'center',
    gap: 6,
  },
  stageLabel: {
    marginTop: 12,
    fontSize: 17,
    fontWeight: '700',
  },
  stageHint: {
    fontSize: 13,
    textAlign: 'center',
    paddingHorizontal: 24,
  },
  chips: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  chip: {
    paddingVertical: 9,
    paddingHorizontal: 13,
    borderRadius: 999,
  },
  chipText: {
    fontSize: 13,
    fontWeight: '600',
  },
});
