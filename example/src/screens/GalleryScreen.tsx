// Gallery — RN port of the original demo's Examples section
// (demo/components/Examples.tsx): a two-column masonry of surface cards,
// each with a centred pill of orb + shimmering label, sized to fill the
// screen with no scrolling. Tall cards span roughly double the short
// ones (the original's 314/151 row rhythm). Small chips run the 20-tuned
// design; everything else runs the 64 design (any orb size ≥ 36 picks
// it), scaled down to fit the phone-width columns.
import { StyleSheet, View } from 'react-native';
import { type OrbState } from 'expo-thinking-orbs';
import { OrbPill } from '../components/OrbPill';

interface Entry {
  state: OrbState;
  label: string;
  /** Large pill (64 design) vs small chip (20 design). */
  large: boolean;
  /** Flex weight — tall hero cards ≈ 2× the short chip cards. */
  grow: number;
}

// Two columns arranged like the original demo / screenshot:
// left: Solving · Agent listening · Searching
// right: Thinking · Working · Agent shaping
const LEFT: Entry[] = [
  { state: 'solving', label: 'Solving….', large: true, grow: 2 },
  { state: 'listening', label: 'Agent listening…', large: false, grow: 1 },
  { state: 'searching', label: 'Searching….', large: true, grow: 2 },
];
const RIGHT: Entry[] = [
  { state: 'composing', label: 'Thinking….', large: true, grow: 2 },
  { state: 'working', label: 'Working….', large: true, grow: 2 },
  { state: 'shaping', label: 'Agent shaping…', large: false, grow: 1 },
];

export function GalleryScreen({ dark }: { dark: boolean }) {
  // --hero-surface / --pill-fill / pill ring, from the original styles.css
  const surface = dark ? 'rgba(217,217,217,0.035)' : 'rgba(0,0,0,0.028)';
  const pillFill = dark ? 'rgba(29,29,29,0.42)' : 'rgba(255,255,255,0.6)';
  const pillRing = dark ? 'rgba(44,47,54,0.31)' : 'rgba(0,0,0,0.036)';

  const renderCard = ({ state, label, large, grow }: Entry) => (
    <View
      key={state}
      style={[styles.card, { backgroundColor: surface, flexGrow: grow }]}
    >
      <View
        style={[
          large ? styles.pill : styles.chip,
          { backgroundColor: pillFill, borderColor: pillRing },
        ]}
      >
        <OrbPill
          state={state}
          label={label}
          orbSize={large ? 40 : 20}
          fontSize={large ? 15 : 11}
          gap={large ? 8 : 7}
          dark={dark}
        />
      </View>
    </View>
  );

  return (
    <View style={styles.grid}>
      <View style={styles.column}>{LEFT.map(renderCard)}</View>
      <View style={styles.column}>{RIGHT.map(renderCard)}</View>
    </View>
  );
}

const styles = StyleSheet.create({
  grid: {
    flex: 1,
    flexDirection: 'row',
    gap: 10,
    padding: 12,
    paddingTop: 4,
  },
  column: {
    flex: 1,
    gap: 10,
  },
  card: {
    flexBasis: 0,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  // scaled-down take on the original 74pt pill (pl 9 / pr 32, gap 12)
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    height: 54,
    paddingLeft: 7,
    paddingRight: 18,
    borderRadius: 999,
    borderWidth: 1,
    maxWidth: '96%',
  },
  // original chip: 36pt tall, pl 8 / pr 14, gap 8
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    height: 34,
    paddingLeft: 7,
    paddingRight: 12,
    borderRadius: 999,
    borderWidth: 1,
    maxWidth: '96%',
  },
});
