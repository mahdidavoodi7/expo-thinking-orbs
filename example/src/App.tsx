import { useState } from 'react';
import {
  Platform,
  Pressable,
  StatusBar as RNStatusBar,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { GalleryScreen } from './screens/GalleryScreen';
import { PlaygroundScreen } from './screens/PlaygroundScreen';
import { VoiceScreen } from './screens/VoiceScreen';

type Tab = 'gallery' | 'playground' | 'voice';

const TABS: { key: Tab; label: string }[] = [
  { key: 'gallery', label: 'Gallery' },
  { key: 'playground', label: 'Playground' },
  { key: 'voice', label: 'Voice' },
];

const TOP_INSET =
  Platform.OS === 'android' ? (RNStatusBar.currentHeight ?? 24) : 72;

export default function App() {
  const [tab, setTab] = useState<Tab>('gallery');
  const dark = true;

  const bg = dark ? '#0b0b0c' : '#ffffff';
  const fg = dark ? '#fafafa' : '#0b0b0c';
  const mutedFg = dark ? '#8a8a8f' : '#6b6b70';
  const border = dark ? '#1e1e22' : '#ececef';
  const tabActiveBg = dark ? '#1e1e22' : '#f1f1f4';

  return (
    <View style={[styles.root, { backgroundColor: bg, paddingTop: TOP_INSET }]}>
      <StatusBar style={dark ? 'light' : 'dark'} />
      {/* 
      <View style={styles.header}>
        <View>
          <Text style={[styles.title, { color: fg }]}>expo-thinking-orbs</Text>
          <Text style={[styles.subtitle, { color: mutedFg }]}>
            after thinking-orbs by Jakub Antalik
          </Text>
        </View>
        <Pressable
          onPress={() => setDark((d) => !d)}
          style={[styles.themeBtn, { borderColor: border }]}
          accessibilityRole="button"
          accessibilityLabel="Toggle light and dark theme"
        >
          <Text style={styles.themeIcon}>{dark ? '☀️' : '🌙'}</Text>
        </Pressable>
      </View> */}

      <View style={[styles.tabbar, { borderColor: border }]}>
        {TABS.map(({ key, label }) => {
          const active = key === tab;
          return (
            <Pressable
              key={key}
              onPress={() => setTab(key)}
              style={[styles.tab, active && { backgroundColor: tabActiveBg }]}
              accessibilityRole="tab"
              accessibilityState={{ selected: active }}
            >
              <Text style={[styles.tabLabel, { color: active ? fg : mutedFg }]}>
                {label}
              </Text>
            </Pressable>
          );
        })}
      </View>

      <View style={styles.body}>
        {tab === 'gallery' && <GalleryScreen dark={dark} />}
        {tab === 'playground' && <PlaygroundScreen dark={dark} />}
        {tab === 'voice' && <VoiceScreen dark={dark} />}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingBottom: 12,
  },
  title: {
    fontSize: 22,
    fontWeight: '800',
    letterSpacing: -0.5,
  },
  subtitle: {
    fontSize: 13,
    marginTop: 2,
  },
  themeBtn: {
    width: 44,
    height: 44,
    borderRadius: 22,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
    justifyContent: 'center',
  },
  themeIcon: {
    fontSize: 20,
  },
  tabbar: {
    flexDirection: 'row',
    gap: 6,
    marginHorizontal: 16,
    marginBottom: 8,
    padding: 4,
    borderRadius: 14,
    borderWidth: StyleSheet.hairlineWidth,
  },
  tab: {
    flex: 1,
    paddingVertical: 10,
    borderRadius: 10,
    alignItems: 'center',
  },
  tabLabel: {
    fontSize: 14,
    fontWeight: '700',
  },
  body: {
    flex: 1,
  },
});
