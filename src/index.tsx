// Ported from thinking-orbs by Jakub Antalik (MIT) — index.tsx
//
// expo-thinking-orbs — a faithful React Native / Expo port of Jakub
// Antalik's thinking-orbs (https://github.com/Jakubantalik/thinking-orbs),
// rendered on the UI thread with Skia + Reanimated.

export { ThinkingOrb, default } from './ThinkingOrb';
export {
  useThinkingOrbPicture,
  type UseThinkingOrbPictureOptions,
} from './useThinkingOrbPicture';

// Voice-agent surface: the dot shell driven by a session lifecycle state
// plus input/output audio levels.
export {
  VoiceOrb,
  VOICE_STATE_TO_BEHAVIOUR,
  type VoiceOrbProps,
  type VoiceOrbState,
} from './VoiceOrb';
export {
  useVoiceAmplitude,
  type VoiceAmplitude,
  type UseVoiceAmplitudeOptions,
} from './useVoiceAmplitude';
// Band-split audio: the three-way split that lets the shell follow speech
// rather than only its volume. Direction-agnostic — one instance for the
// microphone, one for the agent's playback.
export {
  useVoiceLevels,
  type VoiceLevels,
  type UseVoiceLevelsOptions,
} from './useVoiceLevels';
export {
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

export type {
  ThinkingOrbProps,
  OrbBands,
  OrbTilt,
  OrbState,
  OrbSize,
  OrbTheme,
} from './types';

// Power-user surface: resolved presets + the mode registry, for consumers
// driving their own Skia canvas outside the component.
export {
  resolvePreset,
  resolveVoicePreset,
  pickDesignSize,
  STATE_TO_MODE,
  DESIGN_CUTOFF,
  type ModeKey,
  type Resolved,
} from './presets';
export { MODES } from './engine/registry';
export { acquireDotBuffer, type DotBuffer } from './engine/scratch';
export { recordPicture } from './engine/paint';
// The band-reactive pass, for consumers running their own build → record
// loop: call it on the filled buffer before recording.
export { applyVoicePass } from './engine/voice-pass';
export { buildColorLUT, parseTint, type ColorLUT } from './colors';
