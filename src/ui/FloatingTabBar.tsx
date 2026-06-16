import { useRouter } from 'expo-router';
import React, { useEffect, useRef } from 'react';
import { Animated, LayoutChangeEvent, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { hapticTap } from '../util/haptics';
import { TabIcon, TABS, TabKey } from './clusterTabs';
import { colors, radius } from './theme';

export type { TabKey };

const SPRING = { friction: 9, tension: 110 };

export function FloatingTabBar({
  clusterId,
  active,
  visible = true,
}: {
  clusterId: string;
  active: TabKey;
  visible?: boolean;
}) {
  const router = useRouter();
  const layouts = useRef<Partial<Record<TabKey, { x: number; width: number }>>>({});
  const placed = useRef(false);
  const pillX = useRef(new Animated.Value(0)).current;
  const pillWidth = useRef(new Animated.Value(0)).current;
  const pillOpacity = useRef(new Animated.Value(0)).current;
  const shown = useRef(new Animated.Value(visible ? 1 : 0)).current;

  const movePill = (key: TabKey, animate: boolean) => {
    const layout = layouts.current[key];
    if (!layout) return;
    if (!animate) {
      pillX.setValue(layout.x);
      pillWidth.setValue(layout.width);
      pillOpacity.setValue(1);
      placed.current = true;
      return;
    }
    // Position and size can't go through the native driver, but the pill is a
    // single cheap view so the JS-driven spring stays smooth.
    Animated.parallel([
      Animated.spring(pillX, { toValue: layout.x, useNativeDriver: false, ...SPRING }),
      Animated.spring(pillWidth, { toValue: layout.width, useNativeDriver: false, ...SPRING }),
    ]).start();
  };

  useEffect(() => {
    movePill(active, placed.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active]);

  useEffect(() => {
    Animated.timing(shown, { toValue: visible ? 1 : 0, duration: 160, useNativeDriver: true }).start();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  const onTabLayout = (key: TabKey) => (event: LayoutChangeEvent) => {
    const { x, width } = event.nativeEvent.layout;
    layouts.current[key] = { x, width };
    if (key === active && !placed.current) movePill(key, false);
  };

  return (
    <Animated.View
      style={[
        styles.wrap,
        {
          opacity: shown,
          transform: [{ translateY: shown.interpolate({ inputRange: [0, 1], outputRange: [24, 0] }) }],
        },
      ]}
      pointerEvents={visible ? 'box-none' : 'none'}
    >
      <View style={styles.bar}>
        <View style={styles.inner}>
          <Animated.View style={[styles.pill, { left: pillX, width: pillWidth, opacity: pillOpacity }]} />
          {TABS.map((tab) => {
            const isActive = tab.key === active;
            const color = isActive ? '#fff' : colors.textDim;
            return (
              <TouchableOpacity
                key={tab.key}
                style={styles.tab}
                onLayout={onTabLayout(tab.key)}
                onPress={() => {
                  if (!isActive) {
                    hapticTap();
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
    </Animated.View>
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
  inner: { flexDirection: 'row', gap: 4 },
  pill: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    borderRadius: radius.pill,
    backgroundColor: colors.accentSoft,
  },
  tab: {
    alignItems: 'center',
    gap: 3,
    paddingHorizontal: 22,
    paddingTop: 8,
    paddingBottom: 7,
    borderRadius: radius.pill,
  },
  label: { fontSize: 10, fontWeight: '600' },
});
