# 001 — Batch dot drawing into a single `drawAtlas` call

- **Status**: TODO
- **Commit**: 596a089
- **Severity**: HIGH
- **Category**: Performance (per-frame cost / 120 Hz budget)
- **Estimated scope**: 1 file (`src/engine/paint.ts`), ~80 lines changed; 1 new helper file optional

## Problem

`src/engine/paint.ts` draws every dot with its own `drawCircle`, preceded by
two paint mutations. Current code, verbatim (`src/engine/paint.ts:110-124`
after the counting-sort change):

```ts
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
```

That is **three JSI crossings per dot per frame** (`setColor`, `setAlphaf`,
`drawCircle`). The voice shell builds ~480 dots (`src/engine/voice.ts:144-172`
— 18 latitude rings × up to 42 longitude, weighted by `|cos(lat)|`), so:

| | 60 fps | 120 fps |
| --- | --- | --- |
| JSI calls/sec, one orb | ~86,000 | **~173,000** |
| Frame budget | 16.7 ms | **8.3 ms** |

Each crossing is a JS→C++ boundary hop, and they are serial on the UI thread.
This is the single largest per-frame cost in the render path and the reason a
120 Hz target is at risk — the counting sort landed in commit for this branch
saves ~0.08 ms/frame, while this loop dominates the remainder.

Skia's `drawAtlas` draws N sprites with N per-sprite transforms, source rects
and colors in **one** call. Target: ~173,000 crossings/sec → ~120/sec.

## Target

Draw one pre-rendered white circle sprite N times via `Canvas.drawAtlas`,
tinting per dot with the existing LUT color and modulating alpha.

```ts
// target shape — one native call for the whole shell
canvas.drawAtlas(
  circleImage,        // SkImage: a white antialiased disc, SPRITE_PX square
  rsxForms,           // Float32Array, 4 per dot: [scos, ssin, tx, ty]
  spriteRects,        // Float32Array, 4 per dot: [0, 0, SPRITE_PX, SPRITE_PX]
  colors,             // Uint32Array, 1 per dot: LUT color with alpha applied
  BlendMode.Modulate, // tint the white sprite by the per-dot color
  sampling,           // { filter: FilterMode.Linear, mipmap: MipmapMode.Linear }
  paint
);
```

Exact constants to use:

- `const SPRITE_PX = 64;` — the sprite is drawn at radius `SPRITE_PX / 2` and
  scaled down per dot. 64 px covers the largest rendered dot in the preset
  range without upscaling; see the aliasing boundary below.
- RSXform per dot, for a dot of rendered radius `r` at `(x, y)`:
  - `scos = (2 * r) / SPRITE_PX`, `ssin = 0` (no rotation — a disc is
    rotationally symmetric, so never spend a `sin`/`cos` here)
  - `tx = x - r`, `ty = y - r`
- Color per dot: take `lut[Math.round(w * 255)]` (already an unpremultiplied
  32-bit ARGB int) and replace its alpha byte with `Math.round(alpha * 255)`.
  Do **not** call `setAlphaf` — alpha rides in the color array.
- Sampling: `FilterMode.Linear` + `MipmapMode.Linear`. Nearest-neighbour will
  visibly stair-step the small dots.

## Repo conventions to follow

- **Per-runtime scratch on `globalThis`, never per-frame allocation.** This
  file already does it for the paint and index arrays
  (`src/engine/paint.ts:29-38`, the `PaintScratchGlobal` interface), and
  `src/engine/scratch.ts:42-97` is the fuller exemplar — grow-never-shrink
  capacity, `'worklet'` on every function, reset counters rather than
  reallocate. The three new `Float32Array`/`Uint32Array` buffers and the
  sprite `SkImage` **must** live on `PaintScratchGlobal` the same way.
- **Every function in this file is a worklet.** Keep `'worklet'` as the first
  statement of anything new called from the render path.
- Exemplar to imitate for buffer growth: `acquireDotBuffer` at
  `src/engine/scratch.ts:78-97`.

## Steps

1. In `src/engine/paint.ts`, add to `PaintScratchGlobal`:
   `__expoThinkingOrbsSprite?: SkImage`, `__expoThinkingOrbsXforms?: Float32Array`,
   `__expoThinkingOrbsSpriteRects?: Float32Array`,
   `__expoThinkingOrbsAtlasColors?: Uint32Array`,
   `__expoThinkingOrbsAtlasCap?: number`.
2. Add a worklet `acquireSprite(): SkImage` that lazily builds the disc once
   per runtime: `Skia.Surface.MakeOffscreen(SPRITE_PX, SPRITE_PX)`, get its
   canvas, `drawCircle(SPRITE_PX/2, SPRITE_PX/2, SPRITE_PX/2, whitePaint)`
   with `setAntiAlias(true)` and opaque white, then `makeImageSnapshot()`.
   Cache the result on `globalThis`; return it on every later call.
3. Add a worklet `acquireAtlasBuffers(capacity)` mirroring
   `acquireDotBuffer`: allocate/grow `xforms` (`4 * capacity`), `rects`
   (`4 * capacity`), `colors` (`capacity`); fill `rects` with the constant
   `[0, 0, SPRITE_PX, SPRITE_PX]` per slot **only when it grows**, since it
   never changes afterwards.
4. Replace the `for` loop cited in Problem with a fill pass that walks
   `order[]` in the same far→near sequence, skips `alpha < 0.02` exactly as
   today, and writes one RSXform + one color per surviving dot into the
   buffers, tracking a separate `m` count of survivors.
5. Emit a single `canvas.drawAtlas(...)` using the first `m` entries. If the
   Skia binding requires exactly-sized arrays rather than a count, use
   `subarray(0, 4 * m)` / `subarray(0, m)` — a subarray is a view, not a copy,
   so this stays allocation-free.
6. Delete the now-unused `paint.setColor` / `paint.setAlphaf` calls. Keep the
   cached `paint` — `drawAtlas` still takes one.
7. Update the file header comment (`src/engine/paint.ts:1-9`), which currently
   claims "one Paint … is reused for every frame" and describes the per-dot
   fill. It must describe the atlas approach instead.

## Boundaries

- Do **NOT** touch `src/engine/voice.ts`, `scratch.ts`, or any `build`
  function. The `DotBuffer` contract is unchanged — this plan changes only how
  the buffer is consumed.
- Do **NOT** change the z-order semantics. The counting sort and its
  equal-z stability are load-bearing for the flat morph outline; the atlas
  fill pass must walk `order[]` in the identical sequence.
- Do **NOT** change the `alpha < 0.02` cull threshold or the `rMin` floor.
- Do **NOT** add dependencies. `drawAtlas`, `Surface.MakeOffscreen`,
  `BlendMode` and `FilterMode` all come from `@shopify/react-native-skia`,
  already a peer dependency at `>= 2.0.0`.
- If `Skia.Surface.MakeOffscreen` is unavailable on the UI runtime (it may be
  GPU-context dependent), STOP and report — do not fall back to building the
  sprite on the JS thread and shipping it across, and do not silently revert
  to `drawCircle`.
- If the code you find does not match the excerpts above (drift since commit
  596a089), STOP and report instead of improvising.

## Verification

- **Mechanical**:
  - `npx tsc --noEmit -p tsconfig.json` — must exit 0.
  - `npx eslint src/engine/paint.ts` — must report 0 errors and 0 warnings.
    Note this repo has **zero** `eslint-disable` comments in `src/`; do not
    introduce the first one. If you need integer truncation, assign into an
    `Int32Array` (which truncates on store) rather than using `| 0`.
- **Feel check** — this cannot be judged from code, and the change is
  visual-only, so it must be looked at:
  - Run the example app, open the Voice screen, and compare against a build of
    commit 596a089 side by side. The shell must look **identical** at rest.
  - Watch specifically for *aliasing at the size extremes*. The presets span
    `size: 0.395` (`src/presets.ts:95`) to `size: 2.4` (`src/presets.ts:56`).
    A dot rendered larger than `SPRITE_PX / 2` radius upscales the sprite and
    will look soft; a very small dot downscales hard and may shimmer as it
    moves. If either shows, raise `SPRITE_PX` to 128 and re-check — do not
    "fix" it by disabling mipmaps.
  - Confirm the dots still occlude far→near correctly: rotate through
    `thinking` and confirm no dot pops in front of one nearer the viewer.
  - Confirm alpha still culls: `disconnected` should still show its faint
    ping rather than a solid shell.
- **Performance check** (the point of the plan): this must be measured on a
  **physical ProMotion device**, not the simulator — the simulator has no
  120 Hz mode and renders Skia through a different path. Set
  `CADisableMinimumFrameDuration: true` (already in `example/app.json`),
  build to device, and read the `debugFrameMs` shared value that
  `useThinkingOrbPicture` already exposes (`src/useThinkingOrbPicture.ts:203-223`).
- **Done when**: the shell is visually indistinguishable from 596a089 at rest
  and through a full `connecting → … → speaking` cycle, and `debugFrameMs` on
  device is below 8.3 ms with margin at 120 Hz.
