// Ported from thinking-orbs by Jakub Antalik (MIT) — ThinkingOrb.tsx
//
// The ThinkingOrb component. React renders once per prop change; all the
// per-frame work lives on the UI thread. A `useFrameCallback` advances a
// `phase` shared value (seeded from the shared frame clock so every
// instance stays in mutual phase, then accumulated so speed changes and
// pause/resume never jump). A `useDerivedValue` worklet builds the mode's
// dot cloud at time `t`, z-sorts it, and records a Skia picture — which a
// `<Picture>` inside a fixed-size `<Canvas>` renders with zero per-frame
// React work. Reduced-motion users get a static representative frame.

import { useEffect, useMemo } from 'react';
import { View } from 'react-native';
import { Canvas, Picture } from '@shopify/react-native-skia';
import {
  useDerivedValue,
  useFrameCallback,
  useReducedMotion,
  useSharedValue,
} from 'react-native-reanimated';
import { buildColorLUT } from './colors';
import { recordPicture } from './engine/paint';
import { MODES } from './engine/registry';
import { acquireDotBuffer } from './engine/scratch';
import { pickDesignSize, resolvePreset } from './presets';
import { LABELS, useResolvedDark } from './theme';
import type { ThinkingOrbProps } from './types';

// Cap the per-frame delta so a pause/resume or a dropped-frame hitch
// advances the phase by at most a few frames instead of the whole gap —
// the animation continues from its current pose without a visible jump.
const MAX_DT_MS = 100;
// Reduced-motion users see this deterministic, representative frame.
const REDUCED_T = 0.6;

export function ThinkingOrb({
  state = 'working',
  size = 64,
  theme = 'auto',
  speed = 1,
  paused = false,
  color,
  style,
  accessibilityLabel,
  debugFrameMs,
}: ThinkingOrbProps) {
  const designSize = pickDesignSize(size);
  const resolved = useMemo(
    () => resolvePreset(state, designSize),
    [state, designSize]
  );
  const mode = resolved.mode;
  const opts = resolved.opts;
  const rMin = opts.rMin ?? 0.3;

  const build = MODES[mode].build;
  const staticData = useMemo(() => MODES[mode].precompute(opts), [mode, opts]);

  const dark = useResolvedDark(theme);
  const lut = useMemo(() => buildColorLUT(dark, color), [dark, color]);
  const reduced = useReducedMotion();

  const effSpeed = resolved.speed * speed;
  const effSpeedSV = useSharedValue(effSpeed);
  useEffect(() => {
    effSpeedSV.value = effSpeed;
  }, [effSpeed, effSpeedSV]);

  // -1 marks the phase as unseeded; the next active frame seeds it from
  // the shared frame clock so instances mounted at different times lock.
  const phase = useSharedValue(-1);
  useEffect(() => {
    phase.value = -1;
  }, [state, designSize, phase]);

  const frame = useFrameCallback((info) => {
    'worklet';
    if (phase.value < 0) {
      phase.value = (info.timestamp / 1000) * effSpeedSV.value;
      return;
    }
    let dt = info.timeSincePreviousFrame ?? 0;
    if (dt > MAX_DT_MS) dt = MAX_DT_MS;
    phase.value += (dt / 1000) * effSpeedSV.value;
  }, false);

  useEffect(() => {
    frame.setActive(!paused && !reduced);
  }, [paused, reduced, frame]);

  const dotCount = staticData.dotCount;

  const picture = useDerivedValue(() => {
    const t = reduced ? REDUCED_T : Math.max(0, phase.value);
    // High-res timer polyfilled on the UI runtime; read via globalThis so
    // no ambient `performance` global leaks into the published types.
    const perf = (globalThis as { performance?: { now(): number } })
      .performance;
    const timed = debugFrameMs != null && perf != null;
    const t0 = timed && perf ? perf.now() : 0;
    const buf = acquireDotBuffer(dotCount);
    build(buf, size, t, opts, staticData);
    const pic = recordPicture(buf, size, lut, rMin);
    if (timed && perf && debugFrameMs != null) {
      debugFrameMs.value = perf.now() - t0;
    }
    return pic;
  }, [
    build,
    opts,
    staticData,
    dotCount,
    lut,
    size,
    rMin,
    reduced,
    debugFrameMs,
  ]);

  return (
    <View
      accessibilityRole="image"
      accessibilityLabel={accessibilityLabel ?? LABELS[state]}
      style={[{ width: size, height: size }, style]}
    >
      <Canvas style={{ width: size, height: size }}>
        <Picture picture={picture} />
      </Canvas>
    </View>
  );
}

export default ThinkingOrb;
