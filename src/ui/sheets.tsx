import { useRouter } from 'expo-router';
import React, { useEffect, useState } from 'react';
import { ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { listNamespaces } from '../kube/client';
import { namespaceLabel, useClusterScope } from '../state/ClusterScope';
import { useClusters } from '../state/ClustersContext';
import { ClusterConfig } from '../types';
import { BottomSheet, StatusDot } from './kit';
import { colors, radius } from './theme';

function SheetRow({
  title,
  subtitle,
  active,
  onPress,
  dotColor,
}: {
  title: string;
  subtitle?: string;
  active?: boolean;
  onPress: () => void;
  dotColor?: string;
}) {
  return (
    <TouchableOpacity
      style={[styles.row, active && styles.rowActive]}
      onPress={onPress}
    >
      {dotColor ? <StatusDot color={dotColor} /> : null}
      <View style={styles.rowText}>
        <Text style={styles.rowTitle}>{title}</Text>
        {subtitle ? <Text style={styles.rowSub}>{subtitle}</Text> : null}
      </View>
      {active ? <Text style={styles.check}>✓</Text> : null}
    </TouchableOpacity>
  );
}

export function ClusterSwitcherSheet({
  visible,
  onClose,
  activeCluster,
}: {
  visible: boolean;
  onClose: () => void;
  activeCluster: ClusterConfig;
}) {
  const router = useRouter();
  const { clusters } = useClusters();
  return (
    <BottomSheet visible={visible} onClose={onClose} title="Clusters">
      <ScrollView style={{ flexGrow: 0 }} contentContainerStyle={{ gap: 10 }}>
        {clusters.map((cluster) => (
          <SheetRow
            key={cluster.id}
            title={cluster.name}
            subtitle={cluster.server.replace(/^https?:\/\//, '')}
            dotColor={cluster.id === activeCluster.id ? colors.success : colors.textFaint}
            active={cluster.id === activeCluster.id}
            onPress={() => {
              onClose();
              if (cluster.id !== activeCluster.id) {
                router.replace(`/cluster/${cluster.id}` as never);
              }
            }}
          />
        ))}
      </ScrollView>
      <TouchableOpacity
        style={styles.addRow}
        onPress={() => {
          onClose();
          router.push('/cluster-form');
        }}
      >
        <Text style={styles.addText}>+ Add cluster</Text>
      </TouchableOpacity>
    </BottomSheet>
  );
}

export function NamespaceSheet({
  visible,
  onClose,
  cluster,
}: {
  visible: boolean;
  onClose: () => void;
  cluster: ClusterConfig;
}) {
  const { namespace, setNamespace } = useClusterScope();
  const [names, setNames] = useState<string[]>([]);

  useEffect(() => {
    if (!visible) return;
    listNamespaces(cluster)
      .then(setNames)
      .catch(() => setNames([]));
  }, [visible, cluster]);

  return (
    <BottomSheet visible={visible} onClose={onClose} title="Namespaces">
      <ScrollView style={{ flexGrow: 0 }} contentContainerStyle={{ gap: 10 }}>
        {['', ...names].map((name) => (
          <SheetRow
            key={name || '*'}
            title={namespaceLabel(name)}
            active={namespace === name}
            onPress={() => {
              setNamespace(name);
              onClose();
            }}
          />
        ))}
      </ScrollView>
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: colors.surfaceAlt,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.07)',
    borderRadius: radius.card,
    paddingHorizontal: 15,
    paddingVertical: 14,
  },
  rowActive: {
    backgroundColor: 'rgba(91,124,255,0.1)',
    borderColor: 'rgba(91,124,255,0.35)',
  },
  rowText: { flex: 1, gap: 2 },
  rowTitle: { color: colors.text, fontSize: 14, fontWeight: '600' },
  rowSub: { color: colors.textDim, fontSize: 11.5 },
  check: { color: colors.link, fontSize: 13, fontWeight: '700' },
  addRow: {
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: 'rgba(143,165,255,0.4)',
    borderRadius: radius.card,
    paddingVertical: 13,
    alignItems: 'center',
  },
  addText: { color: colors.link, fontSize: 14, fontWeight: '600' },
});
