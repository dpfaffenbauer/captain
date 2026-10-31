import { useRouter } from 'expo-router';
import React, { useEffect, useMemo, useRef } from 'react';
import { Animated, LayoutChangeEvent, RawText, StyleSheet, Text, TouchableOpacity, View } from './rn';
import { hapticTap } from '../util/haptics';
import { TabIcon, TABS, TabKey } from './clusterTabs';
import { useHasSystemRail, useRailContent } from './SystemSafeArea';
import { colors, radius } from './theme';

export type { TabKey };

const SPRING = { friction: 9, tension: 110 };

interface TabBarProps {
  clusterId: string;
  active: TabKey;
  visible?: boolean;
}

export function FloatingTabBar(props: TabBarProps) {
  const hasRail = useHasSystemRail();
  return hasRail ? <RailTabBar {...props} /> : <BottomTabBar {...props} />;
}

/** iPhone Duo: the tabs move into the system rail, clear of the content. */
function RailTabBar({ clusterId, active, visible = true }: TabBarProps) {
  const router = useRouter();
  const content = useMemo(
    () =>
      visible ? (
        <View style={styles.railWrap} pointerEvents="box-none">
          <View style={styles.railBar}>
            {TABS.map((tab) => {
              const isActive = tab.key === active;
              const color = isActive ? '#fff' : colors.textDim;
              return (
                <TouchableOpacity
                  key={tab.key}
                  style={[styles.railTab, isActive && styles.railTabActive]}
                  onPress={() => {
                    if (!isActive) {
                      hapticTap();
                      router.replace(`/cluster/${clusterId}/${tab.path}` as never);
                    }
                  }}
                >
                  <TabIcon tab={tab.key} color={color} />
                  <RawText style={[styles.label, { color }]}>{tab.label}</RawText>
                </TouchableOpacity>
              );
            })}
          </View>
        </View>
      ) : null,
    [active, clusterId, router, visible]
  );
  useRailContent(content);
  return null;
}

function BottomTabBar({ clusterId, active, visible = true }: TabBarProps) {
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
  railWrap: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 26,
    alignItems: 'center',
  },
  railBar: {
    backgroundColor: 'rgba(23,30,45,0.92)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)',
    borderRadius: 26,
    padding: 5,
    gap: 4,
  },
  railTab: {
    alignItems: 'center',
    gap: 3,
    width: 62,
    paddingTop: 9,
    paddingBottom: 8,
    borderRadius: 21,
  },
  railTabActive: { backgroundColor: colors.accentSoft },
});
