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
import type { SkPaint, SkPicture, SkRect } from '@shopify/react-native-skia';
import type { ColorLUT } from '../colors';
import type { DotBuffer } from './scratch';

/**
 * Depth buckets for the z-sort. A comparator sort costs O(n log n) *JS
 * closure calls* inside the worklet — at ~480 dots that is ~4,300 per
 * frame, and a 120 Hz display asks for them twice as often as the 60 Hz
 * one this was tuned on. Counting sort is three linear passes and no
 * closure at all. 1024 buckets puts the quantisation error far below the
 * depth difference at which two overlapping dots could swap visibly.
 */
const Z_BUCKETS = 1024;

interface PaintScratchGlobal {
  __expoThinkingOrbsPaint?: SkPaint;
  __expoThinkingOrbsOrder?: Int32Array;
  __expoThinkingOrbsBucket?: Int32Array;
  __expoThinkingOrbsCounts?: Int32Array;
  __expoThinkingOrbsRect?: SkRect;
  __expoThinkingOrbsRectSize?: number;
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

  const n = buf.count;
  const zs = buf.zs;

  let order = g.__expoThinkingOrbsOrder;
  let bucket = g.__expoThinkingOrbsBucket;
  if (order === undefined || order.length < n) {
    order = new Int32Array(n);
    bucket = new Int32Array(n);
    g.__expoThinkingOrbsOrder = order;
    g.__expoThinkingOrbsBucket = bucket;
  }
  // Narrowing: bucket is written in lockstep with order above, so it is
  // non-null whenever order is, but TypeScript cannot see that.
  const buckets = bucket as Int32Array;

  let counts = g.__expoThinkingOrbsCounts;
  if (counts === undefined) {
    counts = new Int32Array(Z_BUCKETS);
    g.__expoThinkingOrbsCounts = counts;
  } else {
    counts.fill(0);
  }

  // Counting sort, far→near, stable within a bucket.
  let zMin = Infinity;
  let zMax = -Infinity;
  for (let i = 0; i < n; i++) {
    const z = zs[i];
    if (z < zMin) zMin = z;
    if (z > zMax) zMax = z;
  }
  // A degenerate range (every dot at one depth — the flat morph outline)
  // collapses to bucket 0, which is exactly right: the pass below then
  // emits them in emission order, matching the old comparator's `a - b`
  // tiebreak that the outline depends on.
  const span = zMax - zMin;
  const scale = span > 0 ? (Z_BUCKETS - 1) / span : 0;
  for (let i = 0; i < n; i++) {
    // Storing into an Int32Array truncates, so the bucket index falls out
    // of the write we were doing anyway — no floor call, no bitwise.
    buckets[i] = (zs[i] - zMin) * scale;
    counts[buckets[i]]++;
  }
  let running = 0;
  for (let b = 0; b < Z_BUCKETS; b++) {
    const c = counts[b];
    counts[b] = running;
    running += c;
  }
  // Ascending i is what makes this stable: equal-depth dots keep the
  // order the mode emitted them in.
  for (let i = 0; i < n; i++) order[counts[buckets[i]]++] = i;

  // The bounds rect is a native allocation and `size` changes about as
  // often as the component remounts, so cache it rather than rebuilding
  // one every frame.
  let rect = g.__expoThinkingOrbsRect;
  if (rect === undefined || g.__expoThinkingOrbsRectSize !== size) {
    rect = Skia.XYWHRect(0, 0, size, size);
    g.__expoThinkingOrbsRect = rect;
    g.__expoThinkingOrbsRectSize = size;
  }

  const rec = Skia.PictureRecorder();
  const canvas = rec.beginRecording(rect);
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
