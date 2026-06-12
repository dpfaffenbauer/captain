import { useRouter } from 'expo-router';
import React from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import Svg, { Circle, Path, Rect } from 'react-native-svg';
import { colors, radius } from './theme';

export type TabKey = 'home' | 'browse' | 'events';

function TabIcon({ tab, color }: { tab: TabKey; color: string }) {
  if (tab === 'home') {
    return (
      <Svg width={19} height={19} viewBox="0 0 20 20">
        <Circle cx={10} cy={10} r={7} fill="none" stroke={color} strokeWidth={1.7} />
        <Circle cx={10} cy={10} r={2.2} fill={color} />
        <Path d="M10 3v4M10 13v4M3 10h4M13 10h4" stroke={color} strokeWidth={1.7} strokeLinecap="round" />
      </Svg>
    );
  }
  if (tab === 'browse') {
    return (
      <Svg width={19} height={19} viewBox="0 0 20 20">
        <Rect x={2.5} y={2.5} width={6.2} height={6.2} rx={2} fill="none" stroke={color} strokeWidth={1.7} />
        <Rect x={11.3} y={2.5} width={6.2} height={6.2} rx={2} fill="none" stroke={color} strokeWidth={1.7} />
        <Rect x={2.5} y={11.3} width={6.2} height={6.2} rx={2} fill="none" stroke={color} strokeWidth={1.7} />
        <Rect x={11.3} y={11.3} width={6.2} height={6.2} rx={2} fill={color} />
      </Svg>
    );
  }
  return (
    <Svg width={19} height={19} viewBox="0 0 20 20">
      <Path
        d="M2 11h4l2.5-6 3 10 2.5-6H18"
        fill="none"
        stroke={color}
        strokeWidth={1.7}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  );
}

const TABS: Array<{ key: TabKey; label: string; path: string }> = [
  { key: 'home', label: 'Cluster', path: '' },
  { key: 'browse', label: 'Browse', path: 'browse' },
  { key: 'events', label: 'Events', path: 'events' },
];

export function FloatingTabBar({ clusterId, active }: { clusterId: string; active: TabKey }) {
  const router = useRouter();
  return (
    <View style={styles.wrap} pointerEvents="box-none">
      <View style={styles.bar}>
        {TABS.map((tab) => {
          const isActive = tab.key === active;
          const color = isActive ? '#fff' : colors.textDim;
          return (
            <TouchableOpacity
              key={tab.key}
              style={[styles.tab, isActive && styles.tabActive]}
              onPress={() => {
                if (!isActive) {
                  router.replace(`/cluster/${clusterId}/${tab.path}` as never);
                }
              }}
            >
              <TabIcon tab={tab.key} color={color} />
              <Text style={[styles.label, { color }]}>{tab.label}</Text>
            </TouchableOpacity>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 26,
    alignItems: 'center',
    zIndex: 30,
  },
  bar: {
    flexDirection: 'row',
    gap: 4,
    backgroundColor: 'rgba(23,30,45,0.92)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)',
    borderRadius: radius.pill,
    padding: 6,
    shadowColor: '#000',
    shadowOpacity: 0.5,
    shadowRadius: 20,
    shadowOffset: { width: 0, height: 16 },
    elevation: 12,
  },
  tab: {
    alignItems: 'center',
    gap: 3,
    paddingHorizontal: 22,
    paddingTop: 8,
    paddingBottom: 7,
    borderRadius: radius.pill,
  },
  tabActive: { backgroundColor: colors.accentSoft },
  label: { fontSize: 10, fontWeight: '600' },
});
