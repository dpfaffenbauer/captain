import React, { useRef } from 'react';
import {
  PanResponder,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  useWindowDimensions,
  View,
} from 'react-native';
import { useClusters } from '../state/ClustersContext';
import { useDock } from '../state/DockContext';
import { ExecView } from './ExecView';
import { LogsView } from './LogsView';
import { colors, radius, spacing } from './theme';

const MIN_HEIGHT = 160;

/**
 * Dockable panel at the bottom of the content area (wide screens) holding log
 * and exec sessions as tabs. Resizable via the top handle and collapsible to a
 * slim bar; it persists while the user navigates the list and sidebar.
 */
export function BottomDock({ clusterId }: { clusterId: string }) {
  const { sessions, activeId, height, minimized, close, setActive, setHeight, setMinimized } =
    useDock();
  const { getById } = useClusters();
  const { height: windowHeight } = useWindowDimensions();
  const cluster = getById(clusterId);

  // Refs let a single stable PanResponder read the latest height/bounds.
  const startHeight = useRef(height);
  const heightRef = useRef(height);
  heightRef.current = height;
  const maxHeightRef = useRef(windowHeight * 0.8);
  maxHeightRef.current = windowHeight * 0.8;

  const responder = useRef(
    PanResponder.create({
      onMoveShouldSetPanResponder: (_evt, gesture) => Math.abs(gesture.dy) > 2,
      onPanResponderGrant: () => {
        startHeight.current = heightRef.current;
      },
      onPanResponderMove: (_evt, gesture) => {
        const next = Math.max(
          MIN_HEIGHT,
          Math.min(maxHeightRef.current, startHeight.current - gesture.dy)
        );
        setHeight(next);
      },
    })
  ).current;

  if (!cluster || sessions.length === 0) return null;

  const tabStrip = (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      style={styles.tabScroll}
      contentContainerStyle={styles.tabStrip}
    >
      {sessions.map((session) => {
        const isActive = session.id === activeId;
        return (
          <View key={session.id} style={[styles.tab, isActive && styles.tabActive]}>
            <TouchableOpacity
              style={styles.tabLabelWrap}
              onPress={() => {
                setActive(session.id);
                if (minimized) setMinimized(false);
              }}
            >
              <Text style={[styles.tabGlyph, { color: session.target.kind === 'logs' ? colors.link : colors.success }]}>
                {session.target.kind === 'logs' ? '≣' : '>_'}
              </Text>
              <Text style={[styles.tabLabel, isActive && styles.tabLabelActive]} numberOfLines={1}>
                {session.title}
              </Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.tabClose} onPress={() => close(session.id)} hitSlop={6}>
              <Text style={styles.tabCloseGlyph}>×</Text>
            </TouchableOpacity>
          </View>
        );
      })}
    </ScrollView>
  );

  if (minimized) {
    return (
      <View style={styles.minimizedBar}>
        {tabStrip}
        <TouchableOpacity style={styles.barButton} onPress={() => setMinimized(false)} hitSlop={6}>
          <Text style={styles.barGlyph}>▴</Text>
        </TouchableOpacity>
      </View>
    );
  }

  const active = sessions.find((s) => s.id === activeId) ?? sessions[sessions.length - 1];

  return (
    <View style={[styles.dock, { height }]}>
      <View style={styles.handleZone} {...responder.panHandlers}>
        <View style={styles.handle} />
      </View>
      <View style={styles.headerRow}>
        <View style={{ flex: 1, minWidth: 0 }}>{tabStrip}</View>
        <TouchableOpacity style={styles.barButton} onPress={() => setMinimized(true)} hitSlop={6}>
          <Text style={styles.barGlyph}>▾</Text>
        </TouchableOpacity>
      </View>
      <View style={styles.body}>
        {active.target.kind === 'logs' ? (
          <LogsView
            key={active.id}
            cluster={cluster}
            namespace={active.target.namespace}
            name={active.target.name}
            containers={active.target.containers}
            previous={active.target.previous}
            mode="pane"
            onClose={() => close(active.id)}
          />
        ) : (
          <ExecView
            key={active.id}
            cluster={cluster}
            namespace={active.target.namespace}
            name={active.target.name}
            container={active.target.container}
            mode="pane"
            onClose={() => close(active.id)}
          />
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  dock: {
    // In-flow (not absolute): the dock pushes the content up instead of
    // covering it, the opposite of the right detail overlay.
    backgroundColor: colors.backgroundDeep,
    borderTopColor: colors.border,
    borderTopWidth: 1,
    shadowColor: '#000',
    shadowOpacity: 0.4,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: -8 },
    elevation: 16,
  },
  handleZone: { alignItems: 'center', paddingTop: 6, paddingBottom: 2 },
  handle: { width: 44, height: 4, borderRadius: 2, backgroundColor: colors.border },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.sm,
    borderBottomColor: colors.border,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  tabScroll: { flexGrow: 0 },
  tabStrip: { gap: 6, paddingVertical: 6, paddingHorizontal: 4, alignItems: 'center' },
  tab: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    maxWidth: 220,
    paddingLeft: 11,
    paddingRight: 7,
    paddingVertical: 7,
    borderRadius: radius.pill,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  tabActive: { backgroundColor: colors.accentSoft, borderColor: 'rgba(91,124,255,0.5)' },
  tabLabelWrap: { flexDirection: 'row', alignItems: 'center', gap: 6, flexShrink: 1 },
  tabGlyph: { fontSize: 12, fontWeight: '700' },
  tabLabel: { color: colors.textMid, fontSize: 12, fontWeight: '600', flexShrink: 1 },
  tabLabelActive: { color: '#fff' },
  tabClose: { paddingHorizontal: 3 },
  tabCloseGlyph: { color: colors.textDim, fontSize: 15, fontWeight: '700' },
  barButton: {
    width: 34,
    height: 34,
    alignItems: 'center',
    justifyContent: 'center',
  },
  barGlyph: { color: colors.textDim, fontSize: 15, fontWeight: '700' },
  body: { flex: 1 },
  minimizedBar: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.backgroundDeep,
    borderTopColor: colors.border,
    borderTopWidth: 1,
    paddingHorizontal: spacing.sm,
  },
});
