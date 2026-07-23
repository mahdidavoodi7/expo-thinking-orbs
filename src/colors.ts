// Ported from thinking-orbs by Jakub Antalik (MIT) — colors.ts
//
// A 256-entry color LUT that unifies the monochrome original with the
// optional tint. Each mode emits an ink value `white` ∈ [0, 1]; the
// painter indexes the LUT by `round(white * 255)`. With no tint the LUT
// reproduces the original grayscale exactly:
//   light theme → gray(i)         (dark ink on a light substrate)
//   dark  theme → gray(255 − i)   (light ink on a dark substrate)
// A user `color` replaces the ink endpoint; the ramp then runs from that
// hue toward the theme extreme (white on light, black on dark). Entries
// are Skia colors (Float32Array RGBA, 0–1) so the painter never parses or
// allocates a color per dot.

import { Skia } from '@shopify/react-native-skia';

/** 256 Skia colors (Float32Array RGBA), one per ink level. */
export type ColorLUT = Float32Array[];

type RGB = [number, number, number];

/** Parse any RN/Skia color string to normalized [r, g, b] (0–1). */
export function parseTint(color: string): RGB | null {
  try {
    const c = Skia.Color(color);
    return [c[0], c[1], c[2]];
  } catch {
    return null;
  }
}

/**
 * Build the ink ramp for a theme (+ optional tint). Memoize on
 * `(dark, color)` — the result is captured once into the render worklet.
 */
export function buildColorLUT(dark: boolean, color?: string): ColorLUT {
  const parsed = color ? parseTint(color) : null;
  // ink endpoint (white === 0): the foreground hue
  const tint: RGB = parsed ?? (dark ? [1, 1, 1] : [0, 0, 0]);
  // substrate endpoint (white === 1): fades toward the background
  const extreme: RGB = dark ? [0, 0, 0] : [1, 1, 1];

  const lut: ColorLUT = new Array(256);
  for (let i = 0; i < 256; i++) {
    const f = i / 255;
    const r = tint[0] + (extreme[0] - tint[0]) * f;
    const g = tint[1] + (extreme[1] - tint[1]) * f;
    const b = tint[2] + (extreme[2] - tint[2]) * f;
    lut[i] = Float32Array.of(r, g, b, 1);
  }
  return lut;
}
