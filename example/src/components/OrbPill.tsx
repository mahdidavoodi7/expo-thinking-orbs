// One-Canvas status pill: the orb picture (via useThinkingOrbPicture) and
// the shimmering label drawn together in a SINGLE Skia canvas. Mounting a
// separate <Canvas> per orb AND per label meant 12 always-animating
// native surfaces in the gallery — on Android each one is its own
// hardware-buffer view composited every frame, which drops UI frames on
// mid-range devices. Merging halves the surface count.
//
// The shimmer replicates the original demo's `.t-shimmer` CSS
// (demo/styles.css): base text at ~50% ink under the same text clipped to
// a 400%-wide highlight gradient (transparent 40% → highlight 50% →
// transparent 60%) whose background-position sweeps 100% → 0% over
// 2000ms, linear, infinite. Reduced motion → static base text.

import { useEffect, useMemo } from 'react';
import { Platform } from 'react-native';
import {
  Canvas,
  Group,
  LinearGradient,
  matchFont,
  Picture,
  Text as SkText,
  vec,
} from '@shopify/react-native-skia';
import {
  Easing,
  useDerivedValue,
  useReducedMotion,
  useSharedValue,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';
import { useThinkingOrbPicture, type OrbState } from 'expo-thinking-orbs';

const DURATION_MS = 2000;
const BAND = 4; // --shimmer-band: 400%

const fontFamily = Platform.select({
  ios: 'Helvetica Neue',
  default: 'sans-serif',
});

interface Props {
  state: OrbState;
  label: string;
  orbSize: number;
  fontSize: number;
  /** Gap between orb and label, in points. */
  gap: number;
  dark: boolean;
}

export function OrbPill({ state, label, orbSize, fontSize, gap, dark }: Props) {
  const reduced = useReducedMotion();
  const theme = dark ? 'dark' : 'light';
  const picture = useThinkingOrbPicture({ state, size: orbSize, theme });

  const font = useMemo(
    () => matchFont({ fontFamily, fontSize, fontWeight: '400' }),
    [fontSize]
  );

  // Tight glyph bounds → canvas size, text offset and baseline.
  const layout = useMemo(() => {
    const m = font.measureText(label);
    const pad = 2;
    const textW = Math.ceil(m.width) + pad * 2;
    const textH = Math.ceil(m.height) + pad * 2;
    const height = Math.max(orbSize, textH);
    const textX = orbSize + gap + pad - m.x;
    const baseline = (height - textH) / 2 + pad - m.y;
    return {
      width: orbSize + gap + textW,
      height,
      textX,
      baseline,
      textW,
      orbY: (height - orbSize) / 2,
    };
  }, [font, label, orbSize, gap]);

  const base = dark ? 'rgba(251,251,251,0.5)' : 'rgba(7,7,7,0.45)';
  const highlight = dark ? '#ffffff' : '#0d0d0d';
  const transparent = dark ? 'rgba(255,255,255,0)' : 'rgba(13,13,13,0)';

  // background-position 100% → 0% ⇒ gradient strip offset −3w → 0,
  // relative to the label's left edge.
  const progress = useSharedValue(0);
  useEffect(() => {
    if (reduced) return;
    progress.value = 0;
    progress.value = withRepeat(
      withTiming(1, { duration: DURATION_MS, easing: Easing.linear }),
      -1,
      false
    );
  }, [progress, reduced]);

  const w = layout.textW;
  const x0 = layout.textX;
  const start = useDerivedValue(
    () => vec(x0 - (BAND - 1) * w * (1 - progress.value), 0),
    [x0, w]
  );
  const end = useDerivedValue(
    () => vec(x0 - (BAND - 1) * w * (1 - progress.value) + BAND * w, 0),
    [x0, w]
  );

  return (
    <Canvas style={{ width: layout.width, height: layout.height }}>
      <Group transform={[{ translateY: layout.orbY }]}>
        <Picture picture={picture} />
      </Group>
      <SkText
        x={layout.textX}
        y={layout.baseline}
        text={label}
        font={font}
        color={base}
      />
      {!reduced && (
        <SkText x={layout.textX} y={layout.baseline} text={label} font={font}>
          <LinearGradient
            start={start}
            end={end}
            colors={[
              transparent,
              transparent,
              highlight,
              transparent,
              transparent,
            ]}
            positions={[0, 0.4, 0.5, 0.6, 1]}
          />
        </SkText>
      )}
    </Canvas>
  );
}
