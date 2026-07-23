import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

export interface SegmentedOption<T extends string | number> {
  label: string;
  value: T;
  /** Optional color swatch shown as a dot before the label. */
  swatch?: string;
}

interface Props<T extends string | number> {
  options: SegmentedOption<T>[];
  value: T;
  onChange: (value: T) => void;
  dark: boolean;
  /** Let the control scroll horizontally when it has many options. */
  scroll?: boolean;
}

export function Segmented<T extends string | number>({
  options,
  value,
  onChange,
  dark,
  scroll,
}: Props<T>) {
  const fg = dark ? '#fafafa' : '#0b0b0c';
  const mutedFg = dark ? '#8a8a8f' : '#6b6b70';
  const selBg = dark ? '#2a2a2e' : '#e6e6ea';
  const border = dark ? '#2a2a2e' : '#e0e0e4';

  const pills = options.map((opt) => {
    const selected = opt.value === value;
    return (
      <Pressable
        key={String(opt.value)}
        onPress={() => onChange(opt.value)}
        accessibilityRole="button"
        accessibilityState={{ selected }}
        style={[
          styles.pill,
          { borderColor: border },
          selected && { backgroundColor: selBg },
        ]}
      >
        {opt.swatch != null && (
          <View
            style={[
              styles.swatch,
              {
                backgroundColor:
                  opt.swatch === 'none' ? 'transparent' : opt.swatch,
                borderColor: opt.swatch === 'none' ? mutedFg : opt.swatch,
              },
            ]}
          />
        )}
        <Text style={[styles.label, { color: selected ? fg : mutedFg }]}>
          {opt.label}
        </Text>
      </Pressable>
    );
  });

  if (scroll) {
    return (
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.row}
      >
        {pills}
      </ScrollView>
    );
  }
  return <View style={[styles.row, styles.wrap]}>{pills}</View>;
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    gap: 8,
  },
  wrap: {
    flexWrap: 'wrap',
  },
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 999,
    borderWidth: StyleSheet.hairlineWidth,
  },
  label: {
    fontSize: 14,
    fontWeight: '600',
  },
  swatch: {
    width: 12,
    height: 12,
    borderRadius: 6,
    borderWidth: 1,
  },
});
