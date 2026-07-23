// Ported from thinking-orbs by Jakub Antalik (MIT) — ThinkingOrb.tsx
//
// The ThinkingOrb component: a thin wrapper that renders the picture from
// `useThinkingOrbPicture` into its own fixed-size <Canvas>. React renders
// once per prop change; all per-frame work lives on the UI thread inside
// the hook. When mounting several orbs (or orbs next to other animated
// Skia content), prefer the hook and one shared <Canvas> — every Canvas
// is a separate native surface, and Android composits each per frame.

import { View } from 'react-native';
import { Canvas, Picture } from '@shopify/react-native-skia';
import { LABELS } from './theme';
import type { ThinkingOrbProps } from './types';
import { useThinkingOrbPicture } from './useThinkingOrbPicture';

export function ThinkingOrb(props: ThinkingOrbProps) {
  const { state = 'working', size = 64, style, accessibilityLabel } = props;
  const picture = useThinkingOrbPicture(props);

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
