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
 *
 * Voice agents have their own vocabulary and their own animation — see
 * {@linkcode VoiceOrb} and `VoiceOrbState`. They are deliberately a
 * separate axis: `listening` means something different to a voice agent
 * than it does here, and these six are a faithful port that should not
 * shift under anyone.
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

/**
 * The three band levels the voice pass reads, each 0–1 — see
 * `useVoiceLevels`, whose return value satisfies this shape directly.
 * Plain numbers are accepted alongside `SharedValue`s so a static or test
 * value needs no shared-value ceremony.
 */
export interface OrbBands {
  /** Sub-250 Hz energy. Swells the shell. */
  low?: SharedValue<number> | number;
  /** 250 Hz–2 kHz energy. Drives the travelling ripple. */
  mid?: SharedValue<number> | number;
  /** 2 kHz+ energy. Darkens the ink. */
  high?: SharedValue<number> | number;
}

/**
 * Extra globe rotation in radians. Both axes are optional and default to
 * no rotation.
 */
export interface OrbTilt {
  /** Yaw — spins the globe about its own pole. The pole stays put. */
  yaw?: SharedValue<number> | number;
  /** Pitch — tips the pole toward or away from the viewer. */
  pitch?: SharedValue<number> | number;
  /**
   * Roll — leans the pole sideways on screen, about the view axis. The
   * third independent axis: `yaw` turns the globe under a fixed pole,
   * `pitch` tips that pole away from you, and `roll` tips it left or right.
   */
  roll?: SharedValue<number> | number;
}

/** Props for the ThinkingOrb component. */
export interface ThinkingOrbProps {
  /** Which animation to show. @default 'working' */
  state?: OrbState;

  /**
   * Band-split audio driving the voice pass — swell from `low`, a
   * travelling ripple from `mid`, ink from `high`.
   *
   * This is the one audio input the six ported animations DO respond to.
   * The pass runs over the finished dot cloud rather than inside a mode,
   * so `working` or `composing` can follow a microphone without becoming
   * the voice shell. Omit it and every mode paints its original pose.
   */
  bands?: OrbBands;

  /**
   * A second ink endpoint. Supplying it turns `color` into a gradient the
   * dots move along instead of a single hue, and is what enables every
   * colour animation below — with no `colorTo` the painter takes the
   * original single-ramp path verbatim.
   */
  colorTo?: string;

  /**
   * Where the cloud sits between `color` (0) and `colorTo` (1).
   *
   * Omit it and the orb drives it from its own clock, drifting back and
   * forth over {@linkcode ThinkingOrbProps.colorCycleMs}. Supply a
   * `SharedValue` to drive it yourself — from a gesture, a scroll offset,
   * a device tilt — at frame rate, without re-rendering React.
   */
  colorShift?: SharedValue<number> | number;

  /**
   * How far a dot's own depth offsets its blend, 0–1.
   *
   * At 0 the whole shell is one colour that drifts as a mass. Higher
   * values fan near and far dots apart along the gradient, so the orb has
   * colour depth rather than looking like a flat disc changing hue.
   * @default 0.6
   */
  colorSpread?: number;

  /**
   * Period of the built-in colour drift, in ms. Ignored when `colorShift`
   * is supplied. Slow by default — a colour cycle that reads as motion
   * competes with the animation it is colouring.
   * @default 9000
   */
  colorCycleMs?: number;

  /**
   * Rotate the orb as a globe, in radians, on top of whatever rotation its
   * animation is already doing.
   *
   * This enters the PROJECTION, so the far side genuinely turns into
   * sight — dots on the leading edge sweep away, hidden ones come round.
   * That is the difference between this and a `rotateX`/`rotateY` transform
   * on the view: a transform skews the finished flat picture, which reads
   * as a tilted photograph of a sphere rather than a sphere being turned.
   *
   * Intended for device orientation, but it is just an angle — a drag, a
   * scroll offset or a spring works identically. Use `SharedValue`s so it
   * can be driven per frame without re-rendering React.
   */
  tilt?: OrbTilt;

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
