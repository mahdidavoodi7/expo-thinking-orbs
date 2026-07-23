// Shimmer label — RN Skia port of the original thinking-orbs demo's
// `.t-shimmer` CSS (demo/styles.css): base text at ~50% ink, overlaid by
// the same text clipped to a moving highlight gradient. The gradient
// strip is 400% of the text width (transparent 0–40%, highlight 50%,
// transparent 60–100%) and its background-position sweeps 100% → 0% over
// 2000ms, linear, infinite — i.e. the strip translates from −3w to 0.
// Reduced-motion users get the static base text, like the original's
// @media (prefers-reduced-motion) rule.

import { useEffect, useMemo } from 'react';
import { Platform } from 'react-native';
import {
  Canvas,
  LinearGradient,
  matchFont,
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

const DURATION_MS = 2000;
const BAND = 4; // --shimmer-band: 400%

const fontFamily = Platform.select({
  ios: 'Helvetica Neue',
  default: 'sans-serif',
});

interface Props {
  text: string;
  fontSize: number;
  dark: boolean;
}

export function ShimmerText({ text, fontSize, dark }: Props) {
  const reduced = useReducedMotion();
  const font = useMemo(
    () => matchFont({ fontFamily, fontSize, fontWeight: '400' }),
    [fontSize]
  );

  // Tight glyph bounds → canvas size + baseline.
  const layout = useMemo(() => {
    const m = font.measureText(text);
    const pad = 2;
    return {
      width: Math.ceil(m.width) + pad * 2,
      height: Math.ceil(m.height) + pad * 2,
      x: pad - m.x,
      baseline: pad - m.y,
    };
  }, [font, text]);

  const base = dark ? 'rgba(251,251,251,0.5)' : 'rgba(7,7,7,0.45)';
  const highlight = dark ? '#ffffff' : '#0d0d0d';
  const transparent = dark ? 'rgba(255,255,255,0)' : 'rgba(13,13,13,0)';

  // background-position 100% → 0% ⇒ strip offset −3w → 0.
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

  const w = layout.width;
  const start = useDerivedValue(
    () => vec(-(BAND - 1) * w * (1 - progress.value), 0),
    [w]
  );
  const end = useDerivedValue(
    () => vec(-(BAND - 1) * w * (1 - progress.value) + BAND * w, 0),
    [w]
  );

  return (
    <Canvas style={{ width: layout.width, height: layout.height }}>
      <SkText
        x={layout.x}
        y={layout.baseline}
        text={text}
        font={font}
        color={base}
      />
      {!reduced && (
        <SkText x={layout.x} y={layout.baseline} text={text} font={font}>
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
