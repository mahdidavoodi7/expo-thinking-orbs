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

export type { ThinkingOrbProps, OrbState, OrbSize, OrbTheme } from './types';

// Power-user surface: resolved presets + the mode registry, for consumers
// driving their own Skia canvas outside the component.
export {
  resolvePreset,
  pickDesignSize,
  STATE_TO_MODE,
  DESIGN_CUTOFF,
  type ModeKey,
  type Resolved,
} from './presets';
export { MODES } from './engine/registry';
export { acquireDotBuffer, type DotBuffer } from './engine/scratch';
export { recordPicture } from './engine/paint';
export { buildColorLUT, parseTint, type ColorLUT } from './colors';
