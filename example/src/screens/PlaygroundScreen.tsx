import { useState } from 'react';
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  useColorScheme,
  View,
} from 'react-native';
import {
  pickDesignSize,
  ThinkingOrb,
  type OrbState,
  type OrbTheme,
} from 'expo-thinking-orbs';
import { LabeledSlider } from '../components/LabeledSlider';
import { Segmented, type SegmentedOption } from '../components/Segmented';

const STATE_OPTS: SegmentedOption<OrbState>[] = [
  { label: 'working', value: 'working' },
  { label: 'searching', value: 'searching' },
  { label: 'solving', value: 'solving' },
  { label: 'listening', value: 'listening' },
  { label: 'composing', value: 'composing' },
  { label: 'shaping', value: 'shaping' },
];

const THEME_OPTS: SegmentedOption<OrbTheme>[] = [
  { label: 'auto', value: 'auto' },
  { label: 'light', value: 'light' },
  { label: 'dark', value: 'dark' },
];

const COLOR_OPTS: SegmentedOption<string>[] = [
  { label: 'none', value: 'none', swatch: 'none' },
  { label: 'blue', value: '#3b82f6', swatch: '#3b82f6' },
  { label: 'violet', value: '#a855f7', swatch: '#a855f7' },
  { label: 'rose', value: '#f43f5e', swatch: '#f43f5e' },
  { label: 'emerald', value: '#10b981', swatch: '#10b981' },
  { label: 'amber', value: '#f59e0b', swatch: '#f59e0b' },
];

export function PlaygroundScreen({ dark: appDark }: { dark: boolean }) {
  const scheme = useColorScheme();
  const [state, setState] = useState<OrbState>('working');
  const [theme, setTheme] = useState<OrbTheme>('auto');
  const [colorVal, setColorVal] = useState<string>('none');
  const [size, setSize] = useState(120);
  const [speed, setSpeed] = useState(1);
  const [paused, setPaused] = useState(false);

  // resolve the preview background so light-ink orbs sit on a dark card
  const orbDark =
    theme === 'dark' ? true : theme === 'light' ? false : scheme === 'dark';
  const color = colorVal === 'none' ? undefined : colorVal;

  const fg = appDark ? '#fafafa' : '#0b0b0c';
  const mutedFg = appDark ? '#8a8a8f' : '#6b6b70';
  const card = appDark ? '#161618' : '#f5f5f7';
  const accentBg = appDark ? '#2a2a2e' : '#e6e6ea';
  const previewBg = orbDark ? '#0b0b0c' : '#fafafa';
  const previewBorder = appDark ? '#26262a' : '#e4e4e8';

  return (
    <ScrollView contentContainerStyle={styles.content}>
      <View
        style={[
          styles.preview,
          { backgroundColor: previewBg, borderColor: previewBorder },
        ]}
      >
        <ThinkingOrb
          state={state}
          size={size}
          theme={theme}
          speed={speed}
          paused={paused}
          color={color}
        />
      </View>

      <View style={[styles.panel, { backgroundColor: card }]}>
        <Field label="State" mutedFg={mutedFg}>
          <Segmented
            options={STATE_OPTS}
            value={state}
            onChange={setState}
            dark={appDark}
            scroll
          />
        </Field>
        <Field label="Theme" mutedFg={mutedFg}>
          <Segmented
            options={THEME_OPTS}
            value={theme}
            onChange={setTheme}
            dark={appDark}
          />
        </Field>
        <Field label="Color" mutedFg={mutedFg}>
          <Segmented
            options={COLOR_OPTS}
            value={colorVal}
            onChange={setColorVal}
            dark={appDark}
            scroll
          />
        </Field>

        <LabeledSlider
          label="Size"
          value={size}
          min={16}
          max={160}
          step={1}
          onChange={(v) => setSize(Math.round(v))}
          dark={appDark}
          format={(v) => `${Math.round(v)}px · ${pickDesignSize(v)} design`}
        />
        <LabeledSlider
          label="Speed"
          value={speed}
          min={0.25}
          max={3}
          step={0.05}
          onChange={setSpeed}
          dark={appDark}
          format={(v) => `${v.toFixed(2)}×`}
        />

        <Pressable
          onPress={() => setPaused((p) => !p)}
          style={[styles.toggle, { backgroundColor: accentBg }]}
          accessibilityRole="button"
          accessibilityState={{ selected: paused }}
        >
          <Text style={[styles.toggleText, { color: fg }]}>
            {paused ? '▶  Resume' : '❙❙  Pause'}
          </Text>
        </Pressable>
      </View>
    </ScrollView>
  );
}

function Field({
  label,
  mutedFg,
  children,
}: {
  label: string;
  mutedFg: string;
  children: React.ReactNode;
}) {
  return (
    <View style={styles.field}>
      <Text style={[styles.fieldLabel, { color: mutedFg }]}>{label}</Text>
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  content: {
    padding: 16,
    gap: 16,
  },
  preview: {
    height: 240,
    borderRadius: 20,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
    justifyContent: 'center',
  },
  panel: {
    borderRadius: 20,
    padding: 16,
    gap: 18,
  },
  field: {
    gap: 8,
  },
  fieldLabel: {
    fontSize: 13,
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  toggle: {
    paddingVertical: 14,
    borderRadius: 12,
    alignItems: 'center',
  },
  toggleText: {
    fontSize: 15,
    fontWeight: '700',
  },
});
