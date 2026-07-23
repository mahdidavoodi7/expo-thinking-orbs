// Ported from thinking-orbs by Jakub Antalik (MIT) — types.ts

import type { StyleProp, ViewStyle } from 'react-native';
import type { SharedValue } from 'react-native-reanimated';

/**
 * The six shipped states — each a hand-tuned animation:
 * - `working`   — particles on tilted orbits
 * - `searching` — a scan meridian sweeps a dotted globe
 * - `solving`   — bands scramble in quarter turns, then click back
 * - `listening` — a waveform rolls through latitude rings
 * - `composing` — an undulating multi-band sash
 * - `shaping`   — a dotted outline morphs circle → triangle → square
 */
export type OrbState =
  'working' | 'searching' | 'solving' | 'listening' | 'composing' | 'shaping';

/**
 * Internal design size. Two tunings ship — 64 (chat-avatar scale) and
 * 20 (inline-text scale) — each with its own dot count, dot size and
 * speed. The public `size` prop is any number; it picks the nearer
 * design at a cutoff, then scales vectorially (the engine math is
 * size-relative).
 */
export type OrbSize = 64 | 20;

/**
 * Theme mode.
 *
 * - `auto` (default) follows the OS/app appearance via `useColorScheme`.
 * - `dark` / `light` pin the palette regardless of context.
 *
 * Dark renders light ink on the transparent canvas (for dark
 * backgrounds); light renders dark ink (for light backgrounds).
 */
export type OrbTheme = 'auto' | 'dark' | 'light';

/** Props for the ThinkingOrb component. */
export interface ThinkingOrbProps {
  /** Which animation to show. @default 'working' */
  state?: OrbState;

  /**
   * Rendered size in points. Any number — the nearer of the two tuned
   * designs (64 / 20) is picked at a cutoff and scaled to `size`.
   * @default 64
   */
  size?: number;

  /** Theme mode; `auto` follows the OS/app appearance. @default 'auto' */
  theme?: OrbTheme;

  /**
   * Animation speed multiplier on top of the preset's baked speed.
   * @default 1
   */
  speed?: number;

  /** Freeze the animation on the current frame. @default false */
  paused?: boolean;

  /**
   * Optional tint. Any React Native color string. The monochrome ramp is
   * rebuilt from this hue toward the theme extreme (white on light, black
   * on dark). Omit for the faithful grayscale original.
   */
  color?: string;

  /** Container style. Width/height are driven by `size`. */
  style?: StyleProp<ViewStyle>;

  /** Accessibility label; defaults to a per-state phrase (e.g. "Working…"). */
  accessibilityLabel?: string;

  /**
   * Optional instrumentation: the worklet writes the per-frame build+record
   * time in milliseconds here each frame. Used by the stress screen.
   */
  debugFrameMs?: SharedValue<number>;
}
