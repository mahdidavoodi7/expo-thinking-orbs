// VoiceOrb — the voice shell, driven by a voice agent's lifecycle.
//
// Takes the state a voice SDK already emits plus the two audio levels, and
// resolves them to a behaviour on the shared dot shell (see
// `engine/voice.ts`). Because every behaviour acts on the same dots, a
// state change is a BLEND rather than a cut: the dots travel from one
// behaviour to the next over a few hundred milliseconds, which matters
// when an agent flips listening → thinking → speaking several times a
// turn.
//
// The state union is LiveKit's `AgentState` verbatim — the full client-side
// one, including the connection phases — so a session state passes straight
// through. Other SDKs use a subset of the same words.

import { Canvas, Picture } from '@shopify/react-native-skia';
import { View } from 'react-native';
import type { SharedValue } from 'react-native-reanimated';
import {
  VOICE_BUFFERING,
  VOICE_CONNECTING,
  VOICE_DISCONNECTED,
  VOICE_IDLE,
  VOICE_INITIALIZING,
  VOICE_LISTENING,
  VOICE_SPEAKING,
  VOICE_THINKING,
  type VoiceBehaviour,
} from './engine/voice';
import type { ThinkingOrbProps } from './types';
import { useThinkingOrbPicture } from './useThinkingOrbPicture';

/**
 * A voice agent's lifecycle state — LiveKit's `AgentState`: the five
 * agent-side states plus the four the client adds around connection and
 * failure.
 */
export type VoiceOrbState =
  | 'disconnected'
  | 'connecting'
  | 'pre-connect-buffering'
  | 'failed'
  | 'initializing'
  | 'idle'
  | 'listening'
  | 'thinking'
  | 'speaking';

/**
 * How each lifecycle state is drawn. Every state a user can actually sit
 * and watch gets its own behaviour — the three connection phases in
 * particular, since a session walks through all of them in sequence and
 * they would be indistinguishable otherwise: `connecting` churns,
 * `pre-connect-buffering` sweeps, `initializing` assembles. Only the two
 * dead states share, because a session that is not running has nothing to
 * show.
 */
export const VOICE_STATE_TO_BEHAVIOUR: Record<VoiceOrbState, VoiceBehaviour> = {
  'disconnected': VOICE_DISCONNECTED,
  'connecting': VOICE_CONNECTING,
  'pre-connect-buffering': VOICE_BUFFERING,
  'failed': VOICE_DISCONNECTED,
  'initializing': VOICE_INITIALIZING,
  'idle': VOICE_IDLE,
  'listening': VOICE_LISTENING,
  'thinking': VOICE_THINKING,
  'speaking': VOICE_SPEAKING,
};

/**
 * `failed` alone freezes the shell. `disconnected` shares its behaviour but
 * keeps running: a session that has not started yet is still straining for
 * a signal, and its faint ping is the whole point of the state. A failed
 * one has stopped trying, and a still mark says so.
 */
const FROZEN: ReadonlySet<VoiceOrbState> = new Set<VoiceOrbState>(['failed']);

/** Per-state accessibility labels, announced in place of the orb's own. */
const VOICE_LABELS: Record<VoiceOrbState, string> = {
  'disconnected': 'Disconnected',
  'connecting': 'Connecting…',
  'pre-connect-buffering': 'Buffering…',
  'failed': 'Connection failed',
  'initializing': 'Connecting…',
  // No ellipsis: every other label's trailing "…" signals something in
  // progress, and idle is precisely the absence of it.
  'idle': 'Ready',
  'listening': 'Listening…',
  'thinking': 'Thinking…',
  'speaking': 'Speaking…',
};

export interface VoiceOrbProps extends Omit<
  ThinkingOrbProps,
  'state' | 'amplitude'
> {
  /** The agent's current lifecycle state. @default 'idle' */
  state?: VoiceOrbState;

  /**
   * Microphone level, `0`–`1`. Drives the shell while `listening`, and is
   * ignored in every other state. Prefer a `SharedValue` so the level can
   * be written at frame rate without re-rendering React.
   */
  inputAmplitude?: SharedValue<number> | number;

  /**
   * The agent's output level, `0`–`1`. Drives the shell while `speaking`,
   * and is ignored in every other state.
   */
  outputAmplitude?: SharedValue<number> | number;
}

/**
 * The voice orb: a dotted shell that gathers inward as the user speaks,
 * circulates while the agent thinks, and radiates outward as it replies.
 *
 * ```tsx
 * const { state } = useVoiceAssistant();
 * <VoiceOrb
 *   state={state}
 *   inputAmplitude={micLevel}
 *   outputAmplitude={agentLevel}
 *   size={140}
 * />
 * ```
 */
export function VoiceOrb({
  state = 'idle',
  inputAmplitude,
  outputAmplitude,
  size = 64,
  paused = false,
  accessibilityLabel,
  style,
  ...rest
}: VoiceOrbProps) {
  // Only one direction is ever meaningful at a time, and picking here
  // rather than in the worklet keeps the per-frame path branch-free —
  // states change a few times a turn, frames sixty times a second.
  const amplitude =
    state === 'listening'
      ? inputAmplitude
      : state === 'speaking'
        ? outputAmplitude
        : undefined;

  const picture = useThinkingOrbPicture({
    ...rest,
    size,
    paused: paused || FROZEN.has(state),
    amplitude,
    voice: VOICE_STATE_TO_BEHAVIOUR[state],
  });

  return (
    <View
      accessibilityRole="image"
      accessibilityLabel={accessibilityLabel ?? VOICE_LABELS[state]}
      style={[{ width: size, height: size }, style]}
    >
      <Canvas style={{ width: size, height: size }}>
        <Picture picture={picture} />
      </Canvas>
    </View>
  );
}

export default VoiceOrb;
