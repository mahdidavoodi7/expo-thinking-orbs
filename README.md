# ✨ expo-thinking-orbs

Dotted thinking‑orb loading indicators for AI & agent UIs — ten hand‑tuned
animated states, a voice‑agent component that swells with the audio, all
rendered entirely on the UI thread with
[React Native Skia](https://shopify.github.io/react-native-skia/) and
[Reanimated](https://docs.swmansion.com/react-native-reanimated/). For React
Native and Expo.

[![npm](https://img.shields.io/npm/v/expo-thinking-orbs.svg)](https://www.npmjs.com/package/expo-thinking-orbs)
[![license](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
![platforms](https://img.shields.io/badge/platforms-iOS%20%7C%20Android-lightgrey.svg)

## 🙏 Credit
>
> This is a React Native port of **[thinking-orbs](https://github.com/Jakubantalik/thinking-orbs)**
> by **[Jakub Antalik](https://github.com/Jakubantalik)** — see the original
> web library and its live demo at **[orbs.jakubantalik.com](https://orbs.jakubantalik.com)**.
> All of the animation design and the per‑frame engine math are his; this package
> re‑implements that engine on the UI thread for React Native. Original
> library MIT © Jakub Antalik.

## 🎬 Preview

https://github.com/user-attachments/assets/f269ab22-ffab-4e1c-a525-c811e5236a9c

<!--
  GitHub inline video player: edit this file on github.com, drag
  docs/preview.mp4 into the editor, then replace the image below with the
  generated https://github.com/user-attachments/assets/… URL on its own
  line (keep the GIF too — npm renders no video, only images).
![expo-thinking-orbs — gallery of shimmering orb pills and the playground, on iOS and Android](docs/demo.gif)
-->



| state | verb | animation |
| --- | --- | --- |
| 🪐 `working` | thinking | particles on tilted orbits |
| 🌐 `searching` | looking | a scan meridian sweeps a dotted globe |
| 🧩 `solving` | reasoning | bands scramble in quarter turns, then click back solved |
| 🎧 `listening` | hearing | a waveform rolls through latitude rings |
| 🎼 `composing` | writing | an undulating multi‑band sash |
| 🔷 `shaping` | forming | a dotted outline morphs circle → triangle → square |

Building a **voice agent**? There is a seventh animation for that — a dot
shell with five behaviours, on its own component. See
[Voice agents](#-voice-agents).

## 📦 Installation

The library ships JavaScript only; the heavy lifting is done by three peer
dependencies. Install them with `expo install` so you get versions matched to
your Expo SDK:

```sh
npx expo install expo-thinking-orbs @shopify/react-native-skia react-native-reanimated react-native-worklets
```

In a bare React Native project, install the same packages with your package
manager and follow the Skia / Reanimated setup guides (Reanimated needs its
Babel plugin — `babel-preset-expo` adds it automatically on Expo).

<details>
<summary><b>Peer dependencies</b></summary>

| package | version |
| --- | --- |
| `react` | >= 19 |
| `react-native` | >= 0.79 |
| `@shopify/react-native-skia` | >= 2.0.0 |
| `react-native-reanimated` | >= 4.0.0 |
| `react-native-worklets` | >= 0.7.0 |

</details>

> **Note:** Reanimated 4 requires the **New Architecture** — the default since
> React Native 0.76 / Expo SDK 52. Old‑architecture apps can't use this
> library until they migrate.

### 120 Hz on ProMotion

iOS caps `CADisplayLink` — which drives the orb's frame callback — at **60 fps**
unless your app opts in, so on an iPhone Pro the animation runs at half the
refresh rate the display is capable of. This is an app‑level setting; the
library can't enable it for you.

```json
// app.json
{ "expo": { "ios": { "infoPlist": { "CADisableMinimumFrameDuration": true } } } }
```

Bare React Native apps set the same `CADisableMinimumFrameDuration` key to
`true` in `Info.plist` directly. Android has no equivalent opt‑in — high
refresh rate is negotiated by the system.

Opting in doubles the orb's per‑frame budget pressure: the same work now has
**8.3 ms** per frame instead of 16.7 ms. Prefer one shared `<Canvas>` (see
[Many orbs?](#-many-orbs-share-one-canvas)) if you render several at once.

## 🚀 Quick start

```tsx
import { ThinkingOrb } from 'expo-thinking-orbs';

export function Status() {
  return <ThinkingOrb state="searching" size={64} />;
}
```

That's it — the orb animates on the UI thread and follows the OS light/dark
appearance automatically. Every orb shares one clock, so several mounted at
different times stay in mutual phase. 🕰️

## 🎭 States & sizes

```tsx
<ThinkingOrb state="working" />    {/* particles on tilted orbits */}
<ThinkingOrb state="searching" />  {/* a scan meridian sweeps a dotted globe */}
<ThinkingOrb state="solving" />    {/* bands scramble, then click back solved */}
<ThinkingOrb state="listening" />  {/* a waveform rolls through the rings */}
<ThinkingOrb state="composing" />  {/* an undulating multi-band sash */}
<ThinkingOrb state="shaping" />    {/* dotted outline: circle → triangle → square */}
```

`size` is any number. Two tunings ship — a dense **64‑point** design and a
chunky **20‑point** design — and the component auto‑picks the nearer one
(cutoff 36), then scales it vectorially to the exact size you pass:

- `size={64}` → chat‑avatar scale
- `size={20}` → inline‑with‑text scale
- anything in between or beyond just works

```tsx
<ThinkingOrb state="working" size={64} />
<ThinkingOrb state="working" size={20} />
<ThinkingOrb state="working" size={120} />
```

## 🎨 Theme & color

By default the orbs are strictly monochrome — dark ink on light backgrounds,
light ink on dark backgrounds — matching the original exactly. The palette is
picked from the OS appearance and can be pinned:

```tsx
<ThinkingOrb theme="auto" />   {/* default — follows useColorScheme() */}
<ThinkingOrb theme="dark" />   {/* pin: light dots, for dark backgrounds */}
<ThinkingOrb theme="light" />  {/* pin: dark dots, for light backgrounds */}
```

An optional `color` tints the dots. The monochrome depth ramp is rebuilt from
your hue toward the theme extreme, so depth shading is preserved:

```tsx
<ThinkingOrb state="composing" color="#3b82f6" />
```

Omit `color` for the faithful grayscale original. 🖤🤍

## ⚙️ Props

| prop | type | default | description |
| --- | --- | --- | --- |
| `state` | `OrbState` | `'working'` | Which animation to show. |
| `size` | `number` | `64` | Rendered size in points; any number. |
| `theme` | `'auto' \| 'dark' \| 'light'` | `'auto'` | Palette; `auto` follows the OS appearance. |
| `speed` | `number` | `1` | Multiplier on the preset's baked speed. |
| `paused` | `boolean` | `false` | Freeze on the current frame (continues from the same pose on resume). |
| `color` | `string` | — | Optional tint; any RN color string. |
| `style` | `StyleProp<ViewStyle>` | — | Container style (size drives width/height). |
| `accessibilityLabel` | `string` | per‑state (e.g. `"Working…"`) | Overrides the default label. |
| `debugFrameMs` | `SharedValue<number>` | — | Instrumentation: the worklet writes each frame's build+record time here. |

`OrbState` is `'working' | 'searching' | 'solving' | 'listening' | 'composing' | 'shaping'`.

## 🎙️ Voice agents

`<VoiceOrb>` is a wrapper that takes a voice agent's lifecycle state and its
two audio levels, and does the routing for you. Its state union is LiveKit's
[`AgentState`](https://docs.livekit.io/reference/agents-js/types/agents.voice.AgentState.html)
verbatim, so a session state passes straight through with no mapping table:

```tsx
import { VoiceOrb } from 'expo-thinking-orbs';

function AgentAvatar() {
  const { state } = useVoiceAssistant(); // '@livekit/components-react'
  return (
    <VoiceOrb
      state={state}
      inputAmplitude={micLevel}      // SharedValue<number>, 0–1
      outputAmplitude={agentLevel}   // SharedValue<number>, 0–1
      size={140}
    />
  );
}
```

Using another SDK? The union is nine plain strings — map yours onto them, or
reach for `<ThinkingOrb>` and the four lifecycle states directly.

**The seven behaviours**

All seven act on one shared dot shell — a latitude-ring lattice, the same
structure `wave` and `globe` use — at the same tempo and scale as the ported
animations. Because the dot set is shared, a state change **blends**: the dots
travel to their new behaviour over ~420 ms instead of cutting.

| state | behaviour |
| --- | --- |
| `disconnected` | dim, drawn in, near-motionless; a faint ping crawls across and finds nothing |
| `connecting` | fast spikes and hard shear, but faint — straining, not yet through |
| `pre-connect-buffering` | a bright band sweeps pole to pole and back; fuller than `connecting` |
| `initializing` | scattered dots assemble onto the shell in a rolling wave |
| `idle` | the undulation at half tempo and a quarter depth — at rest, breathing |
| `listening` | wavefronts **converge inward**, carrying dots toward the core with the mic |
| `thinking` | `wave`'s undulation at a narrower swing — the calm middle of a turn |
| `speaking` | wavefronts **expand outward**, carrying dots to the rim with the agent's voice |

These are staged so progress is legible without reading a label — each step
along `disconnected → connecting → buffering → initializing → idle` is
measurably fuller and brighter than the last. `failed` freezes the shell;
`disconnected` keeps running, because straining for a signal is the point of
it.

### Feeding it real audio

This package renders; it does not capture audio. `useVoiceAmplitude()` is the
bridge — it owns a `SharedValue` the orb reads every frame, and converts the
formats you are actually likely to have. Setting it never re-renders React.

```tsx
import { VoiceOrb, useVoiceAmplitude } from 'expo-thinking-orbs';

function AgentAvatar() {
  const { state } = useVoiceAssistant();
  const mic = useVoiceAmplitude();
  const agent = useVoiceAmplitude();

  return (
    <VoiceOrb
      state={state}
      inputAmplitude={mic.level}
      outputAmplitude={agent.level}
      size={180}
    />
  );
}
```

Then push levels in from whichever source you have:

| your source | call |
| --- | --- |
| already `0`–`1` (LiveKit `useTrackVolume`, a VU meter) | `mic.set(v)` |
| dBFS (`expo-audio` metering, `expo-av`, `AVAudioRecorder`) | `mic.setDb(db)` |
| raw PCM frames in `-1..1` (a Gemini Live / Realtime stream) | `agent.setSamples(frames)` |

`setDb` treats −45 dBFS as silence and 0 dB as full, on an ear-shaped curve —
conversational speech (≈ −20 dB) lands around 0.66 and close talking (≈ −6 dB)
around 0.90, so the orb's range is spent on speech rather than on room noise.
Both the floor and the curve are options if your source runs hotter or
quieter. `setSamples` takes the RMS of the block.

A stalled meter handing you `NaN` reads as silence rather than corrupting the
geometry.

### How amplitude behaves

Audio level scales how **deep** a gesture goes, never how **fast**. The tempo
is fixed at the ported animations' pace — driving the rate from amplitude is
frequency modulation, and reads as vibration rather than as a voice. The
wavefronts travel through screen-space radius, so every dot the same distance
from the centre moves together and the shell stays a surface.

Levels are clamped and smoothed on the UI thread with a fast attack (45 ms)
and slow release (240 ms), so feed a raw meter — pre-smoothing on top will
only make the orb lag the voice.

Amplitude is **ignored** when the OS reduce-motion setting is on, and frozen
while `paused`. The six ported animations have no audio response by design;
`amplitude` only reaches the voice shell.

## 🤖 Many orbs? Share one canvas

Every `<ThinkingOrb>` mounts its own Skia `<Canvas>`, and each canvas is a
separate native surface — on Android each one is composited every frame, so
a screen full of small animating canvases drops UI frames on mid‑range
devices. For those screens, use the `useThinkingOrbPicture` hook and draw
several orbs (plus any other animated Skia content) into **one** canvas:

```tsx
import { Canvas, Group, Picture } from '@shopify/react-native-skia';
import { useThinkingOrbPicture } from 'expo-thinking-orbs';

function StatusRow() {
  const working = useThinkingOrbPicture({ state: 'working', size: 40 });
  const searching = useThinkingOrbPicture({ state: 'searching', size: 40 });
  return (
    <Canvas style={{ width: 96, height: 40 }}>
      <Picture picture={working} />
      <Group transform={[{ translateX: 56 }]}>
        <Picture picture={searching} />
      </Group>
    </Canvas>
  );
}
```

The picture is recorded at `(0, 0, size, size)`; offset it with a
`<Group transform>`. The example app's gallery draws each pill (orb +
shimmering label) this way.

## 🧠 How it works

The original thinking-orbs is **not** shader‑based: each state is pure CPU math
that emits a per‑frame array of a few dozen to a few hundred grayscale dots,
z‑sorted and painted as circles. A full‑screen fragment shader looping over
hundreds of dots per pixel would be *slower* on mobile GPUs, so this port keeps
the CPU‑math design and moves it to the UI thread:

- ⚛️ **React renders once per prop change.** No per‑frame React work.
- 🕰️ A `useFrameCallback` advances a `phase` shared value, seeded from the
  shared frame clock (so instances lock in phase) and accumulated (so speed
  changes and pause/resume never jump).
- 🧵 A `useDerivedValue` **worklet** computes the mode's dot cloud at time `t`,
  z‑sorts it, and records a Skia `Picture`. Dots live in reused
  structure‑of‑arrays `Float32Array` buffers, ordering goes through a reused
  index list, one `Paint` is shared across all orbs, and colors come from a
  256‑entry LUT — a frame allocates essentially nothing but the picture, so
  the UI thread runs **GC‑quiet** even with dozens of orbs mounted. 🗑️🚫
- 🖼️ A `<Picture>` inside a fixed‑size `<Canvas>` draws it. Everything after
  the first render happens on the UI thread; the JS thread stays free.

Time‑independent setup (lattices, orbit bases, shape outlines, hash tables) is
precomputed once per resolved preset on the JS thread.

## ♿ Accessibility

- Each orb is an `accessibilityRole="image"` with a sensible per‑state
  `accessibilityLabel` (e.g. `"Searching…"`), overridable via the prop.
- `prefers-reduced-motion` (via Reanimated's `useReducedMotion`) renders a
  single static, representative frame — no animation — still following the theme.

## 📱 Running the example app

The `example/` app is an Expo SDK 57 project with three screens — a gallery of
states as shimmering status pills (both tuned designs), a playground with live
state/theme/color/size/speed/amplitude controls, and a voice screen that runs
`<VoiceOrb>` through a full agent lifecycle against a synthesised speech
envelope.

```sh
yarn                       # install (from the repo root)
cd example
npx expo run:ios           # or: npx expo run:android
```

Because the library depends on Skia, Reanimated and Worklets (all native), the
example needs a **development build** (`expo run:*`) rather than Expo Go —
though with matched SDK versions Expo Go may work for a quick look. On Android,
also give the release variant a sanity check.

## 📄 License

MIT. Original thinking-orbs © Jakub Antalik; React Native port ©
[Mehdi Davoodi](https://motionary.dev). See [LICENSE](LICENSE).

---

Made with 🤍 by [Mehdi Davoodi](https://motionary.dev) — more of my projects
live at **[motionary.dev](https://motionary.dev)**.
