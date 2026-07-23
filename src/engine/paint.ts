// Ported from thinking-orbs by Jakub Antalik (MIT) — engine/paint.ts
//
// Painter: z-sort far→near, then matte circles onto a Skia picture. The
// web original filled 2D-canvas arcs with an rgba() string per dot; here
// each dot's ink level indexes a precomputed Skia-color LUT (no per-dot
// parse/alloc), alpha is set separately, and one Paint — created once
// per runtime — is reused for every frame of every orb. Dots arrive in a
// reused structure-of-arrays buffer and are ordered through a reused
// index list, so recording a frame allocates only the picture itself.

import { Skia } from '@shopify/react-native-skia';
import type { SkPaint, SkPicture } from '@shopify/react-native-skia';
import type { ColorLUT } from '../colors';
import type { DotBuffer } from './scratch';

interface PaintScratchGlobal {
  __expoThinkingOrbsPaint?: SkPaint;
  __expoThinkingOrbsOrder?: number[];
}

/**
 * Z-sort the buffered dots far→near and record them as a Skia picture.
 * `lut` maps an ink level (0–255) to a color; `rMin` is the minimum
 * rendered radius. The sort is an explicitly stabilised index sort
 * (z, then emission order), so equal-z dots — e.g. the flat morph
 * outline — keep their emission order.
 */
export function recordPicture(
  buf: DotBuffer,
  size: number,
  lut: ColorLUT,
  rMin: number
): SkPicture {
  'worklet';
  const g = globalThis as PaintScratchGlobal;

  let paint = g.__expoThinkingOrbsPaint;
  if (paint === undefined) {
    paint = Skia.Paint();
    paint.setAntiAlias(true);
    g.__expoThinkingOrbsPaint = paint;
  }

  let order = g.__expoThinkingOrbsOrder;
  if (order === undefined) {
    order = [];
    g.__expoThinkingOrbsOrder = order;
  }

  const n = buf.count;
  order.length = n;
  for (let i = 0; i < n; i++) order[i] = i;
  const zs = buf.zs;
  order.sort((a, b) => zs[a] - zs[b] || a - b);

  const rec = Skia.PictureRecorder();
  const canvas = rec.beginRecording(Skia.XYWHRect(0, 0, size, size));
  const xs = buf.xs;
  const ys = buf.ys;
  const rs = buf.rs;
  const ws = buf.ws;
  const as = buf.as;

  for (let i = 0; i < n; i++) {
    const d = order[i];
    const alpha = as[d];
    if (alpha < 0.02) continue;
    let w = ws[d];
    if (w < 0) w = 0;
    else if (w > 1) w = 1;
    paint.setColor(lut[Math.round(w * 255)]);
    paint.setAlphaf(alpha);
    const r = rs[d];
    canvas.drawCircle(xs[d], ys[d], r < rMin ? rMin : r, paint);
  }

  return rec.finishRecordingAsPicture();
}
