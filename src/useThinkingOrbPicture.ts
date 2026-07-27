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
import { applyVoicePass } from './engine/voice-pass';
import type { VoiceBehaviour } from './engine/voice';
import { pickDesignSize, resolvePreset, resolveVoicePreset } from './presets';
import { useResolvedDark } from './theme';
import type { OrbBands, ThinkingOrbProps } from './types';

// Cap the per-frame delta so a pause/resume or a dropped-frame hitch
// advances the phase by at most a few frames instead of the whole gap —
// the animation continues from its current pose without a visible jump.
const MAX_DT_MS = 100;
/**
 * Speed multiplier under reduced motion. The orb keeps animating rather
 * than freezing on a representative frame, because freezing destroys the
 * one thing it exists to communicate: `idle`, `listening` and `thinking`
 * share a 0.9 resting radius by design, so what separates them IS the
 * motion, and no still frame recovers it. The setting asks for less
 * motion, not none.
 *
 * A third of the pace keeps every state legible while removing the quick
 * gestures — the spike lunges, the fast `connecting` churn — that make
 * motion uncomfortable in the first place.
 */
const REDUCED_SPEED = 0.3;
/**
 * The amplitude a reduced-motion orb is drawn at. Pinning it to 0 froze
 * `listening` and `speaking` at their emptiest pose — a 0.9 shell with a
 * barely-there ripple — which is where they are least distinguishable
 * from `idle` and `thinking`, in a component whose entire job is state
 * indication. A representative level instead lets each state show the
 * pose it is recognised by: `speaking` sits visibly smaller (0.79 against
 * 0.9) with outward wavefronts, `listening` fuller with inward ones.
 *
 * The LIVE level is never read here. Voice-locked amplitude is fast,
 * irregular motion driven by something the viewer cannot anticipate,
 * which is precisely what the setting asks to be spared — so the level is
 * held constant and only the wavefronts drift, at {@linkcode
 * REDUCED_SPEED}.
 *
 * 0.85 rather than a peak: the benefit rises monotonically with level but
 * flattens, and 0.85 still reads as a real speech level.
 */
const REDUCED_AMP = 0.85;

// One-pole smoothing time constants. Speech onsets need to land almost
// immediately or the orb lags the voice; the decay is slower so syllable
// gaps read as a held breath rather than a stutter.
const ATTACK_MS = 45;
const RELEASE_MS = 240;

/**
 * One frame of the band filter: the same fast-attack / slow-release
 * one-pole the overall level uses, with the same "losing the source is a
 * target of 0, not an assignment of 0" rule so a band releases instead of
 * snapping when its source goes away.
 *
 * Returns `cur` untouched when there is no source and the band has already
 * settled — the cheap path every non-audio caller takes every frame.
 */
function filterBand(
  cur: number,
  sv: SharedValue<number> | undefined,
  dt: number
): number {
  'worklet';
  if (sv == null && cur === 0) return 0;
  let a = 0;
  if (sv != null) {
    // The SharedValue belongs to the caller; a NaN here would reach every
    // dot coordinate through the voice pass.
    a = sv.value;
    if (!(a > 0)) a = 0;
    else if (a > 1) a = 1;
  }
  const tau = a > cur ? ATTACK_MS : RELEASE_MS;
  const next = cur + (a - cur) * (1 - Math.exp(-dt / tau));
  return a === 0 && next < 1e-4 ? 0 : next;
}

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

  /**
   * Three smoothed audio bands driving the voice pass — swell from `low`,
   * a travelling ripple from `mid`, ink from `high`. See
   * {@linkcode useVoiceLevels}, which produces them from raw PCM.
   *
   * Unlike {@linkcode amplitude} this is NOT voice-only: the pass runs
   * over the finished dot cloud, so it composes with all six ported
   * animations as well as the voice shell. Omit it, or leave the bands at
   * zero, and every mode paints exactly the pose it built.
   */
  bands?: OrbBands;
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
  bands,
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

  const effSpeed = resolved.speed * speed * (reduced ? REDUCED_SPEED : 1);
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

  // Same number-or-SharedValue handling for each band. Three own-values are
  // allocated unconditionally: hooks cannot be called per present band, and
  // an unused SharedValue is a single UI-thread slot.
  const ownLowSV = useSharedValue(0);
  const ownMidSV = useSharedValue(0);
  const ownHighSV = useSharedValue(0);
  const bLow = bands?.low;
  const bMid = bands?.mid;
  const bHigh = bands?.high;
  useEffect(() => {
    if (typeof bLow === 'number') ownLowSV.value = bLow;
    if (typeof bMid === 'number') ownMidSV.value = bMid;
    if (typeof bHigh === 'number') ownHighSV.value = bHigh;
  }, [bLow, bMid, bHigh, ownLowSV, ownMidSV, ownHighSV]);
  const lowSV = typeof bLow === 'number' ? ownLowSV : bLow;
  const midSV = typeof bMid === 'number' ? ownMidSV : bMid;
  const highSV = typeof bHigh === 'number' ? ownHighSV : bHigh;

  // The smoothed level, 0–1, read per dot by the voice shell. Losing the
  // amplitude source is a release, not a reset — see the frame callback.
  const level = useSharedValue(0);

  // The three band levels, smoothed through the same filter as `level` but
  // consumed by the voice pass (`engine/voice-pass.ts`) rather than by the
  // shell. Unlike `amplitude`, these apply to EVERY mode: the pass runs
  // over the finished dot cloud, so a caller can make any of the six
  // ported animations audio-reactive without switching to the voice shell.
  const bandLow = useSharedValue(0);
  const bandMid = useSharedValue(0);
  const bandHigh = useSharedValue(0);

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
    // A change arriving MID-blend cannot resume from the pose on screen:
    // that pose is a lerp of two behaviours, and `from` can only name one
    // of them. Start from whichever endpoint the pose is currently nearer
    // — that halves the worst-case jump, from |B−A| to 0.5·|B−A|, against
    // always taking the outgoing target. Removing the jump entirely needs
    // a three-way blend; see plans/002.
    if (mix.value >= 0.5) behFrom.value = behTo.value;
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

    const cur = level.value;
    // Losing the source is a target of 0, not an assignment of 0. Every
    // state but `listening`/`speaking` supplies no amplitude, so
    // `speaking → thinking` — the most common transition in the machine —
    // drops it; snapping the level there would bypass the RELEASE_MS
    // release on precisely the transition it exists for. The `cur !== 0`
    // arm keeps the six non-voice animations out of the filter entirely.
    if (ampSV != null || cur !== 0) {
      let a = 0;
      if (ampSV != null) {
        // Clamp defensively: the SharedValue belongs to the caller, and a
        // NaN would propagate into every dot coordinate.
        a = ampSV.value;
        if (!(a > 0)) a = 0;
        else if (a > 1) a = 1;
      }
      // One-pole filter, frame-rate independent via the exponential — a
      // dropped frame lands in the same place as several short ones.
      const tau = a > cur ? ATTACK_MS : RELEASE_MS;
      const next = cur + (a - cur) * (1 - Math.exp(-dt / tau));
      // An exponential never quite reaches its target, so settle the tail
      // exactly to 0 — otherwise the branch above can never switch off.
      level.value = a === 0 && next < 1e-4 ? 0 : next;
    }

    // The three bands run the same filter, each with the same guard: a band
    // with no source and a settled 0 costs nothing, which is what keeps the
    // six ported modes untouched for callers who drive no audio.
    bandLow.value = filterBand(bandLow.value, lowSV, dt);
    bandMid.value = filterBand(bandMid.value, midSV, dt);
    bandHigh.value = filterBand(bandHigh.value, highSV, dt);
  }, false);

  useEffect(() => {
    // Reduced motion slows the clock (see REDUCED_SPEED); it does not stop
    // it. Only `paused` and the frozen `failed` state stop the clock.
    frame.setActive(!paused);
  }, [paused, frame]);

  const dotCount = staticData.dotCount;

  return useDerivedValue(() => {
    const t = Math.max(0, phase.value);
    // High-res timer polyfilled on the UI runtime; read via globalThis so
    // no ambient `performance` global leaks into the published types.
    const perf = (globalThis as { performance?: { now(): number } })
      .performance;
    const timed = debugFrameMs != null && perf != null;
    const t0 = timed && perf ? perf.now() : 0;
    // Reduce-motion holds the level constant — the shell keeps its shape
    // but stops tracking the voice, which is the fast irregular part. See
    // REDUCED_AMP.
    const amp = reduced ? REDUCED_AMP : level.value;
    const buf = acquireDotBuffer(dotCount);
    // Blends run under reduced motion too. `mix` is driven by withTiming,
    // independently of the frame callback, and cutting between behaviours
    // instead would be a harder visual event than the travel it replaces.
    const dyn = acquireDynamics(amp, behFrom.value, behTo.value, mix.value);
    build(buf, size, t, opts, staticData, dyn);
    // The voice pass runs on the BUILT cloud, which is what lets it apply
    // to every mode rather than to the voice shell alone. Under reduced
    // motion the bands are zeroed rather than held at a representative
    // value: unlike the shell — where motion IS the state signal, so
    // freezing destroys it (see REDUCED_AMP) — this pass carries no state,
    // and holding it at a constant would only add a permanent swell and a
    // frozen ripple to a setting that asked for less movement.
    if (!reduced) {
      applyVoicePass(
        buf,
        size,
        t,
        bandLow.value,
        bandMid.value,
        bandHigh.value
      );
    }
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
