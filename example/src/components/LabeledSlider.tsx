import Slider from '@react-native-community/slider';
import { StyleSheet, Text, View } from 'react-native';

interface Props {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  onChange: (value: number) => void;
  dark: boolean;
  /** Format the displayed value (e.g. add a unit or a design tag). */
  format?: (value: number) => string;
}

export function LabeledSlider({
  label,
  value,
  min,
  max,
  step = 1,
  onChange,
  dark,
  format,
}: Props) {
  const fg = dark ? '#fafafa' : '#0b0b0c';
  const mutedFg = dark ? '#8a8a8f' : '#6b6b70';
  const accent = dark ? '#fafafa' : '#0b0b0c';
  const track = dark ? '#3a3a3e' : '#d4d4d8';

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={[styles.label, { color: mutedFg }]}>{label}</Text>
        <Text style={[styles.value, { color: fg }]}>
          {format ? format(value) : String(value)}
        </Text>
      </View>
      <Slider
        minimumValue={min}
        maximumValue={max}
        step={step}
        value={value}
        onValueChange={onChange}
        minimumTrackTintColor={accent}
        maximumTrackTintColor={track}
        thumbTintColor={accent}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    gap: 2,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'baseline',
  },
  label: {
    fontSize: 13,
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  value: {
    fontSize: 15,
    fontWeight: '700',
    fontVariant: ['tabular-nums'],
  },
});
