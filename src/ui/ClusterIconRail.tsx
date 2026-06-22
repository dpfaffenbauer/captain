import { useRouter } from 'expo-router';
import React from 'react';
import { ScrollView, StyleSheet, Text, TouchableOpacity, View } from './rn';
import { useClusterSwitch } from '../state/ClusterSwitch';
import { ConnectionState, useClusterStatus } from '../state/ClusterStatusContext';
import { useClusters } from '../state/ClustersContext';
import { ClusterConfig } from '../types';
import { hapticTap } from '../util/haptics';
import { colors, radius } from './theme';

function connectionColor(state: ConnectionState): string {
  switch (state) {
    case 'connected':
      return colors.success;
    case 'error':
      return colors.danger;
    case 'checking':
      return colors.warning;
    default:
      return colors.textFaint;
  }
}

/** Stable, pleasant avatar colors picked per cluster. */
const AVATAR_COLORS = [
  '#5B7CFF',
  '#34D399',
  '#A78BFA',
  '#F472B6',
  '#F4A85C',
  '#2DD4BF',
  '#818CF8',
  '#FB7185',
  '#4ADE80',
  '#36B3F4',
];

function colorFor(id: string): string {
  let hash = 0;
  for (let i = 0; i < id.length; i += 1) hash = (hash * 31 + id.charCodeAt(i)) >>> 0;
  return AVATAR_COLORS[hash % AVATAR_COLORS.length];
}

function initialsFor(name: string): string {
  const words = name.split(/[\s\-_@.]+/).filter(Boolean);
  if (words.length === 0) return '?';
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return words
    .slice(0, 3)
    .map((word) => word[0])
    .join('')
    .toUpperCase();
}

/**
 * Permanent vertical cluster rail (Lens/Slack style) for the iPad/macOS layout.
 * Sits at the far left, left of the navigation sidebar, listing every cluster
 * as an avatar. Tapping one switches clusters, restoring the route the user
 * last had open there.
 */
export function ClusterIconRail({ clusterId }: { clusterId: string }) {
  const router = useRouter();
  const { clusters } = useClusters();
  const { switchTo: switchCluster } = useClusterSwitch();
  const { statusOf } = useClusterStatus();

  const switchTo = (cluster: ClusterConfig) => {
    hapticTap();
    switchCluster(cluster.id);
  };

  return (
    <View style={styles.rail}>
      <ScrollView
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
      >
        {clusters.map((cluster) => {
          const active = cluster.id === clusterId;
          return (
            <TouchableOpacity
              key={cluster.id}
              style={styles.item}
              onPress={() => switchTo(cluster)}
              accessibilityLabel={cluster.name}
            >
              {active ? <View style={styles.activeBar} pointerEvents="none" /> : null}
              <View
                style={[
                  styles.avatar,
                  { backgroundColor: colorFor(cluster.id) },
                  active && styles.avatarActive,
                ]}
              >
                <Text style={styles.avatarText}>{initialsFor(cluster.name)}</Text>
                <View
                  style={[styles.statusDot, { backgroundColor: connectionColor(statusOf(cluster.id)) }]}
                />
              </View>
            </TouchableOpacity>
          );
        })}

        <TouchableOpacity
          style={styles.item}
          onPress={() => {
            hapticTap();
            router.push('/cluster-form');
          }}
          accessibilityLabel="Add cluster"
        >
          <View style={styles.addAvatar}>
            <Text style={styles.addGlyph}>＋</Text>
          </View>
        </TouchableOpacity>
      </ScrollView>
    </View>
  );
}

const RAIL_WIDTH = 64;
const AVATAR_SIZE = 46;

const styles = StyleSheet.create({
  rail: {
    width: RAIL_WIDTH,
    backgroundColor: colors.backgroundDeep,
    borderRightColor: colors.border,
    borderRightWidth: StyleSheet.hairlineWidth,
    paddingTop: 60,
  },
  content: { alignItems: 'center', gap: 12, paddingVertical: 4, paddingBottom: 20 },
  item: { alignItems: 'center', justifyContent: 'center', width: RAIL_WIDTH },
  activeBar: {
    position: 'absolute',
    left: 0,
    top: 8,
    bottom: 8,
    width: 3,
    borderRadius: 2,
    backgroundColor: '#fff',
  },
  avatar: {
    width: AVATAR_SIZE,
    height: AVATAR_SIZE,
    borderRadius: 15,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: 'transparent',
  },
  avatarActive: {
    borderColor: '#fff',
  },
  avatarText: { color: '#fff', fontSize: 14, fontWeight: '800', letterSpacing: 0.3 },
  statusDot: {
    position: 'absolute',
    right: -2,
    bottom: -2,
    width: 14,
    height: 14,
    borderRadius: 7,
    borderWidth: 2.5,
    borderColor: colors.backgroundDeep,
  },
  addAvatar: {
    width: AVATAR_SIZE,
    height: AVATAR_SIZE,
    borderRadius: 15,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: colors.border,
    backgroundColor: colors.surfaceAlt,
  },
  addGlyph: { color: colors.textDim, fontSize: 22, fontWeight: '600' },
});
