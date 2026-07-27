// Voice — VoiceOrb driven through a full agent lifecycle.
//
// There is no microphone here: a frame callback synthesises a speech-like
// envelope on the UI thread and writes it into the same SharedValue a real
// app would write mic / output levels into, so the swell behaves exactly
// as it will in production. Tap a state to pin it, or leave the auto-cycle
// running to watch the transitions.
import { useEffect, useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import {
  useFrameCallback,
  useSharedValue,
  type SharedValue,
} from 'react-native-reanimated';
import { VoiceOrb, type VoiceOrbState } from 'expo-thinking-orbs';

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

/** The loop a real turn takes, with how long to hold each leg. */
const CYCLE: { state: VoiceOrbState; ms: number }[] = [
  { state: 'connecting', ms: 1600 },
  { state: 'pre-connect-buffering', ms: 1600 },
  { state: 'initializing', ms: 1600 },
  { state: 'idle', ms: 2200 },
  { state: 'listening', ms: 3200 },
  { state: 'thinking', ms: 1800 },
  { state: 'speaking', ms: 4000 },
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

  useEffect(() => {
    frame.setActive(active);
    if (!active) level.value = 0;
  }, [active, frame, level]);

  return level;
}

export function VoiceScreen({ dark }: { dark: boolean }) {
  const [auto, setAuto] = useState(true);
  const [state, setState] = useState<VoiceOrbState>('connecting');
  // Hold the level steady to inspect a behaviour at a fixed amplitude,
  // instead of chasing the synthesised envelope.
  const [hold, setHold] = useState<number | null>(null);
  const leg = useRef(0);

  // Auto-cycle: each leg schedules the next, so the hold times above are
  // honoured rather than every state getting the same slice.
  useEffect(() => {
    if (!auto) return;
    const id = setTimeout(() => {
      leg.current = (leg.current + 1) % CYCLE.length;
      setState(CYCLE[leg.current].state);
    }, CYCLE[leg.current].ms);
    return () => clearTimeout(id);
  }, [auto, state]);

  // Only the direction in play needs a live level; VoiceOrb ignores the
  // other one anyway, so there is no point burning a frame callback on it.
  const input = useFakeLevel(state === 'listening');
  const output = useFakeLevel(state === 'speaking');

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
          inputAmplitude={hold ?? input}
          outputAmplitude={hold ?? output}
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

      <Pressable
        onPress={() => setAuto((a) => !a)}
        style={[styles.toggle, { backgroundColor: card }]}
        accessibilityRole="button"
        accessibilityState={{ selected: auto }}
      >
        <Text style={[styles.toggleText, { color: fg }]}>
          {auto ? '❙❙  Stop auto-cycle' : '▶  Run auto-cycle'}
        </Text>
      </Pressable>

      <View style={styles.holdRow}>
        {[null, 0, 0.35, 0.7, 1].map((h) => {
          const active = hold === h;
          return (
            <Pressable
              key={String(h)}
              onPress={() => setHold(h)}
              style={[
                styles.chip,
                { backgroundColor: active ? chipOn : chipBg },
              ]}
              accessibilityRole="button"
              accessibilityState={{ selected: active }}
            >
              <Text style={[styles.chipText, { color: active ? fg : mutedFg }]}>
                {h === null ? 'live' : `amp ${h}`}
              </Text>
            </Pressable>
          );
        })}
      </View>

      <View style={styles.chips}>
        {STATES.map((s) => {
          const active = s === state;
          return (
            <Pressable
              key={s}
              onPress={() => {
                setAuto(false);
                setState(s);
              }}
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
  toggle: {
    paddingVertical: 14,
    borderRadius: 12,
    alignItems: 'center',
  },
  toggleText: {
    fontSize: 15,
    fontWeight: '700',
  },
  holdRow: {
    flexDirection: 'row',
    gap: 8,
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
