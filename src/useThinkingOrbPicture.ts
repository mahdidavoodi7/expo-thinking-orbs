// Ported from thinking-orbs by Jakub Antalik (MIT) — useThinkingOrbPicture.ts
//
// The orb render loop as a hook: clock, engine build and Skia picture
// recording, without the component's <Canvas>. `ThinkingOrb` is a thin
// wrapper over this; consumers with several orbs (or orbs plus other
// animated Skia content) can embed the returned picture in ONE shared
// <Canvas> instead of mounting one Skia view per orb — on Android every
// Skia view is a separate hardware-buffer surface composited per frame,
// so fewer, larger canvases render dramatically cheaper.

import { useEffect, useMemo } from 'react';
import type { SkPicture } from '@shopify/react-native-skia';
import {
  useDerivedValue,
  useFrameCallback,
  useReducedMotion,
  useSharedValue,
  withTiming,
  type DerivedValue,
  type SharedValue,
} from 'react-native-reanimated';
import { buildColorLUT } from './colors';
import { recordPicture } from './engine/paint';
import { MODES } from './engine/registry';
import { acquireDotBuffer, acquireDynamics } from './engine/scratch';
import type { VoiceBehaviour } from './engine/voice';
import { pickDesignSize, resolvePreset, resolveVoicePreset } from './presets';
import { useResolvedDark } from './theme';
import type { ThinkingOrbProps } from './types';

// Cap the per-frame delta so a pause/resume or a dropped-frame hitch
// advances the phase by at most a few frames instead of the whole gap —
// the animation continues from its current pose without a visible jump.
const MAX_DT_MS = 100;
// Reduced-motion users see this deterministic, representative frame.
export const REDUCED_T = 0.6;

// One-pole smoothing time constants. Speech onsets need to land almost
// immediately or the orb lags the voice; the decay is slower so syllable
// gaps read as a held breath rather than a stutter.
const ATTACK_MS = 45;
const RELEASE_MS = 240;

/**
 * Options for {@linkcode useThinkingOrbPicture} — the animation subset of
 * {@linkcode ThinkingOrbProps} (everything except the container-only
 * `style` and `accessibilityLabel`).
 */
export type UseThinkingOrbPictureOptions = Omit<
  ThinkingOrbProps,
  'style' | 'accessibilityLabel'
> & {
  /**
   * Render the voice shell at this behaviour instead of `state`, blending
   * smoothly whenever it changes. Set by {@linkcode VoiceOrb}; `state` is
   * ignored while it is present.
   */
  voice?: VoiceBehaviour;

  /**
   * Live audio level, `0`–`1`, driving the voice shell's wavefronts. Only
   * meaningful alongside `voice` — the six ported animations have no audio
   * response, by design.
   *
   * Pass a `SharedValue` to write it at frame rate without re-rendering
   * React. Values are clamped and smoothed here (fast attack, slow
   * release), so feed a raw meter without pre-smoothing.
   */
  amplitude?: SharedValue<number> | number;
};

/**
 * How long a voice behaviour takes to blend into the next one. Tuned for
 * full-duplex sessions, where a barge-in flips speaking → listening and the
 * orb has to acknowledge the interruption immediately; long enough to read
 * as travel rather than a cut, short enough not to lag the conversation.
 */
const BLEND_MS = 280;

/**
 * Drive one orb's animation and return its per-frame Skia picture. The
 * picture is recorded with bounds `(0, 0, size, size)`; draw it in a
 * `<Picture>`, offset with a `<Group transform={...}>` when composing
 * several into one canvas.
 *
 * @see {@linkcode ThinkingOrb} for the drop-in component form.
 */
export function useThinkingOrbPicture({
  state = 'working',
  size = 64,
  theme = 'auto',
  speed = 1,
  paused = false,
  color,
  amplitude,
  voice,
  debugFrameMs,
}: UseThinkingOrbPictureOptions = {}): DerivedValue<SkPicture> {
  const designSize = pickDesignSize(size);
  const isVoice = voice != null;
  const resolved = useMemo(
    () =>
      isVoice
        ? resolveVoicePreset(designSize)
        : resolvePreset(state, designSize),
    [isVoice, state, designSize]
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

  // Amplitude arrives either as a caller-owned SharedValue (driven at
  // frame rate from the UI thread) or as a plain number mirrored into our
  // own — the worklet below only ever reads one SharedValue either way.
  const ownAmpSV = useSharedValue(0);
  useEffect(() => {
    if (typeof amplitude === 'number') ownAmpSV.value = amplitude;
  }, [amplitude, ownAmpSV]);
  const ampSV = typeof amplitude === 'number' ? ownAmpSV : amplitude;

  // The smoothed level, 0–1, read per dot by the voice shell.
  const level = useSharedValue(0);
  const reactive = ampSV != null;
  useEffect(() => {
    if (!reactive) level.value = 0;
  }, [reactive, level]);

  // Voice behaviour blending. `from`/`to` are behaviour indices and `mix`
  // walks 0 → 1 across a state change; the mode evaluates both and
  // interpolates per dot. A change landing mid-blend restarts from the
  // previous TARGET rather than the current interpolated pose — states
  // change on human timescales, so this is rare and barely visible.
  const behFrom = useSharedValue(voice ?? 0);
  const behTo = useSharedValue(voice ?? 0);
  const mix = useSharedValue(1);
  useEffect(() => {
    if (voice == null) return;
    if (behTo.value === voice) return;
    behFrom.value = behTo.value;
    behTo.value = voice;
    mix.value = 0;
    mix.value = withTiming(1, { duration: BLEND_MS });
  }, [voice, behFrom, behTo, mix]);

  // -1 marks the phase as unseeded; the next active frame seeds it from
  // the shared frame clock so instances mounted at different times lock.
  // Keyed on the MODE, not the state: a voice behaviour change must not
  // reset the clock, or the blend would jump.
  const phase = useSharedValue(-1);
  useEffect(() => {
    phase.value = -1;
  }, [mode, designSize, phase]);

  const frame = useFrameCallback((info) => {
    'worklet';
    if (phase.value < 0) {
      phase.value = (info.timestamp / 1000) * effSpeedSV.value;
      return;
    }
    let dt = info.timeSincePreviousFrame ?? 0;
    if (dt > MAX_DT_MS) dt = MAX_DT_MS;
    phase.value += (dt / 1000) * effSpeedSV.value;

    if (ampSV != null) {
      // Clamp defensively: the SharedValue belongs to the caller, and a
      // NaN would propagate into every dot coordinate.
      let a = ampSV.value;
      if (!(a > 0)) a = 0;
      else if (a > 1) a = 1;
      const cur = level.value;
      // One-pole filter, frame-rate independent via the exponential — a
      // dropped frame lands in the same place as several short ones.
      const tau = a > cur ? ATTACK_MS : RELEASE_MS;
      level.value = cur + (a - cur) * (1 - Math.exp(-dt / tau));
    }
  }, false);

  useEffect(() => {
    frame.setActive(!paused && !reduced);
  }, [paused, reduced, frame]);

  const dotCount = staticData.dotCount;

  return useDerivedValue(() => {
    const t = reduced ? REDUCED_T : Math.max(0, phase.value);
    // High-res timer polyfilled on the UI runtime; read via globalThis so
    // no ambient `performance` global leaks into the published types.
    const perf = (globalThis as { performance?: { now(): number } })
      .performance;
    const timed = debugFrameMs != null && perf != null;
    const t0 = timed && perf ? perf.now() : 0;
    // Reduce-motion pins the level to 0: an orb that still moved with the
    // voice would be the only thing animating on screen, which is the
    // opposite of what the setting asks for.
    const amp = reduced ? 0 : level.value;
    const buf = acquireDotBuffer(dotCount);
    // `mix` is driven by withTiming, which runs independently of the frame
    // callback — without this guard a reduce-motion user would get a static
    // orb that still animated 420ms of travel on every state change.
    const dyn = acquireDynamics(
      amp,
      behFrom.value,
      behTo.value,
      reduced ? 1 : mix.value
    );
    build(buf, size, t, opts, staticData, dyn);
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
}
