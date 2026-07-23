# expo-thinking-orbs

Dotted thinking-orb loading indicators for AI & agent UIs — six hand‑tuned
animated states, rendered entirely on the UI thread with
[React Native Skia](https://shopify.github.io/react-native-skia/) and
[Reanimated](https://docs.swmansion.com/react-native-reanimated/). For React
Native and Expo.

> ### Credit
>
> This is a React Native port of **[thinking-orbs](https://github.com/Jakubantalik/thinking-orbs)**
> by **[Jakub Antalik](https://github.com/Jakubantalik)** — see the original
> web library and its live demo at **[orbs.jakubantalik.com](https://orbs.jakubantalik.com)**.
> All of the animation design and the per‑frame engine math are his; this package
> re‑implements that engine on the UI thread for React Native. Original
> library MIT © Jakub Antalik; React Native port MIT ©
> [Mehdi Davoodi](https://motionary.dev).

| state | verb | animation |
| --- | --- | --- |
| `working` | thinking | particles on tilted orbits |
| `searching` | looking | a scan meridian sweeps a dotted globe |
| `solving` | reasoning | bands scramble in quarter turns, then click back solved |
| `listening` | hearing | a waveform rolls through latitude rings |
| `composing` | writing | an undulating multi‑band sash |
| `shaping` | forming | a dotted outline morphs circle → triangle → square |

## Installation

The library ships JavaScript only; the heavy lifting is done by three peer
dependencies. Install them with `expo install` so you get versions matched to
your Expo SDK:

```sh
npx expo install expo-thinking-orbs @shopify/react-native-skia react-native-reanimated react-native-worklets
```

In a bare React Native project, install the same packages with your package
manager and follow the Skia / Reanimated setup guides (Reanimated needs its
Babel plugin — `babel-preset-expo` adds it automatically on Expo).

**Peer dependencies**

| package | version |
| --- | --- |
| `react` | >= 19 |
| `react-native` | >= 0.79 |
| `@shopify/react-native-skia` | >= 2.0.0 |
| `react-native-reanimated` | >= 4.0.0 |
| `react-native-worklets` | >= 0.7.0 |

## Quick start

```tsx
import { ThinkingOrb } from 'expo-thinking-orbs';

export function Status() {
  return <ThinkingOrb state="searching" size={64} />;
}
```

That's it — the orb animates on the UI thread and follows the OS light/dark
appearance automatically. Every orb shares one clock, so several mounted at
different times stay in mutual phase.

## States & sizes

```tsx
<ThinkingOrb state="working" />    {/* particles on tilted orbits */}
<ThinkingOrb state="searching" />  {/* a scan meridian sweeps a dotted globe */}
<ThinkingOrb state="solving" />    {/* bands scramble, then click back solved */}
<ThinkingOrb state="listening" />  {/* a waveform rolls through the rings */}
<ThinkingOrb state="composing" />  {/* an undulating multi-band sash */}
<ThinkingOrb state="shaping" />    {/* dotted outline: circle → triangle → square */}
```

`size` is any number. Two tunings ship — a dense 64‑point design and a chunky
20‑point design — and the component auto‑picks the nearer one (cutoff 36),
then scales it vectorially to the exact size you pass. `size={64}` is
chat‑avatar scale; `size={20}` is inline‑with‑text scale; anything in between
or beyond works.

```tsx
<ThinkingOrb state="working" size={64} />
<ThinkingOrb state="working" size={20} />
<ThinkingOrb state="working" size={120} />
```

## Theme & color

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

Omit `color` for the faithful grayscale original.

## Props

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

## How it works

The original thinking-orbs is **not** shader‑based: each state is pure CPU math
that emits a per‑frame array of a few dozen to a few hundred grayscale dots,
z‑sorted and painted as circles. A full‑screen fragment shader looping over
hundreds of dots per pixel would be *slower* on mobile GPUs, so this port keeps
the CPU‑math design and moves it to the UI thread:

- **React renders once per prop change.** No per‑frame React work.
- A `useFrameCallback` advances a `phase` shared value, seeded from the shared
  frame clock (so instances lock in phase) and accumulated (so speed changes
  and pause/resume never jump).
- A `useDerivedValue` **worklet** computes the mode's dot cloud at time `t`,
  z‑sorts it, and records a Skia `Picture`. Dots live in reused
  structure‑of‑arrays `Float32Array` buffers, ordering goes through a reused
  index list, one `Paint` is shared across all orbs, and colors come from a
  256‑entry LUT — a frame allocates essentially nothing but the picture, so
  the UI thread runs GC‑quiet even with dozens of orbs mounted.
- A `<Picture>` inside a fixed‑size `<Canvas>` draws it. Everything after the
  first render happens on the UI thread; the JS thread stays free.

Time‑independent setup (lattices, orbit bases, shape outlines, hash tables) is
precomputed once per resolved preset on the JS thread.

## Accessibility

- Each orb is an `accessibilityRole="image"` with a sensible per‑state
  `accessibilityLabel` (e.g. `"Searching…"`), overridable via the prop.
- `prefers-reduced-motion` (via Reanimated's `useReducedMotion`) renders a
  single static, representative frame — no animation — still following the theme.

## Running the example app

The `example/` app is an Expo SDK 56 project with two screens — a gallery of
all six states as shimmering status pills (both tuned designs), and a
playground with live state/theme/color/size/speed controls.

```sh
yarn                       # install (from the repo root)
cd example
npx expo run:ios           # or: npx expo run:android
```

Because the library depends on Skia, Reanimated and Worklets (all native), the
example needs a **development build** (`expo run:*`) rather than Expo Go —
though with matched SDK versions Expo Go may work for a quick look. On Android,
also give the release variant a sanity check.

## License

MIT. Original thinking-orbs © Jakub Antalik; React Native port ©
[Mehdi Davoodi](https://motionary.dev). See [LICENSE](LICENSE).

---

Ported and maintained by [Mehdi Davoodi](https://motionary.dev) — more of my
projects live at **[motionary.dev](https://motionary.dev)**.
