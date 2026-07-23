// Ported from thinking-orbs by Jakub Antalik (MIT) — theme.ts
//
// Theme resolution for React Native: explicit prop wins, otherwise the OS
// / app appearance via `useColorScheme`, updating live. Dark renders
// light ink (for dark backgrounds); light renders dark ink.

import { useColorScheme } from 'react-native';
import type { OrbState, OrbTheme } from './types';

/** Resolve the effective dark/light substrate. */
export function useResolvedDark(theme: OrbTheme): boolean {
  const scheme = useColorScheme();
  if (theme === 'dark') return true;
  if (theme === 'light') return false;
  return scheme === 'dark';
}

/** Per-state default accessibility labels. */
export const LABELS: Record<OrbState, string> = {
  working: 'Working…',
  searching: 'Searching…',
  solving: 'Solving…',
  listening: 'Listening…',
  composing: 'Composing…',
  shaping: 'Shaping…',
};
