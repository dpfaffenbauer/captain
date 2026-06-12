import { useRouter } from 'expo-router';
import React from 'react';
import { Alert, FlatList, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useClusters } from '../src/state/ClustersContext';
import { ClusterConfig } from '../src/types';
import { Button, EmptyState, Loading } from '../src/ui/components';
import { colors, spacing } from '../src/ui/theme';

function authLabel(cluster: ClusterConfig): string {
  switch (cluster.auth.type) {
    case 'token':
      return 'Bearer-Token';
    case 'clientCert':
      return 'Client-Zertifikat';
    case 'eks':
      return `AWS EKS (${cluster.auth.region})`;
    case 'gke':
      return 'Google GKE';
    case 'aks':
      return 'Azure AKS';
  }
}

export default function ClusterListScreen() {
  const router = useRouter();
  const { clusters, loading, remove } = useClusters();

  if (loading) return <Loading />;

  const confirmDelete = (cluster: ClusterConfig) => {
    Alert.alert('Cluster entfernen', `„${cluster.name}" wirklich entfernen?`, [
      { text: 'Abbrechen', style: 'cancel' },
      { text: 'Entfernen', style: 'destructive', onPress: () => void remove(cluster.id) },
    ]);
  };

  return (
    <View style={styles.container}>
      <FlatList
        data={clusters}
        keyExtractor={(cluster) => cluster.id}
        contentContainerStyle={clusters.length === 0 && styles.emptyContent}
        ListEmptyComponent={
          <EmptyState message="Noch keine Cluster. Füge einen Cluster hinzu oder importiere eine Kubeconfig." />
        }
        renderItem={({ item }) => (
          <TouchableOpacity
            style={styles.row}
            onPress={() => router.push({ pathname: '/cluster/[id]', params: { id: item.id } })}
            onLongPress={() => confirmDelete(item)}
          >
            <View style={styles.rowText}>
              <Text style={styles.name}>{item.name}</Text>
              <Text style={styles.detail} numberOfLines={1}>
                {item.server}
              </Text>
              <Text style={styles.auth}>{authLabel(item)}</Text>
            </View>
            <TouchableOpacity
              style={styles.editButton}
              onPress={() =>
                router.push({ pathname: '/cluster-form', params: { id: item.id } })
              }
            >
              <Text style={styles.editText}>Bearbeiten</Text>
            </TouchableOpacity>
          </TouchableOpacity>
        )}
      />
      <View style={styles.footer}>
        <Button title="Cluster hinzufügen" onPress={() => router.push('/cluster-form')} />
        <Button
          title="Kubeconfig importieren"
          variant="secondary"
          onPress={() => router.push('/kubeconfig-import')}
        />
        <Text style={styles.hint}>Tipp: Cluster lange drücken zum Entfernen.</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  emptyContent: { flexGrow: 1 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderBottomColor: colors.border,
    borderBottomWidth: StyleSheet.hairlineWidth,
    padding: spacing.lg,
  },
  rowText: { flex: 1, marginRight: spacing.md },
  name: { color: colors.text, fontSize: 17, fontWeight: '600' },
  detail: { color: colors.textDim, fontSize: 13, marginTop: 2 },
  auth: { color: colors.accent, fontSize: 12, marginTop: 4 },
  editButton: {
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: 6,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
  },
  editText: { color: colors.textDim, fontSize: 13 },
  footer: { padding: spacing.lg },
  hint: { color: colors.textDim, fontSize: 12, textAlign: 'center', marginTop: spacing.xs },
});
