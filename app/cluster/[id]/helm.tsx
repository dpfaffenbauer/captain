import { useLocalSearchParams, useRouter } from 'expo-router';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  FlatList,
  RefreshControl,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { HelmRelease, listHelmReleases } from '../../../src/kube/helm';
import { namespaceLabel, useClusterScope } from '../../../src/state/ClusterScope';
import { useClusters } from '../../../src/state/ClustersContext';
import { BackButton, Card, Pill, SquircleIcon } from '../../../src/ui/kit';
import { NamespaceSheet } from '../../../src/ui/sheets';
import { Button, EmptyState, ErrorBox, Loading } from '../../../src/ui/components';
import { colors, spacing } from '../../../src/ui/theme';

export function helmStatusColor(status: string): string {
  if (status === 'deployed') return colors.success;
  if (status === 'failed' || status === 'unknown') return colors.danger;
  return colors.warning;
}

export default function HelmReleasesScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const { getById } = useClusters();
  const cluster = getById(id);
  const { namespace } = useClusterScope();

  const [releases, setReleases] = useState<HelmRelease[]>([]);
  const [filter, setFilter] = useState('');
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');
  const [nsOpen, setNsOpen] = useState(false);

  const load = useCallback(async () => {
    if (!cluster) return;
    setError('');
    try {
      setReleases(await listHelmReleases(cluster, namespace !== '' ? namespace : undefined));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [cluster, namespace]);

  useEffect(() => {
    setLoading(true);
    void load();
  }, [load]);

  const visible = useMemo(() => {
    const query = filter.trim().toLowerCase();
    if (!query) return releases;
    return releases.filter(
      (release) =>
        release.name.toLowerCase().includes(query) ||
        release.namespace.toLowerCase().includes(query)
    );
  }, [releases, filter]);

  if (!cluster) return <EmptyState message="Cluster not found." />;

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <BackButton onPress={() => router.back()} />
        <Text style={styles.title}>Helm Releases</Text>
        <View style={{ flex: 1 }} />
        <Pill label={`${namespaceLabel(namespace)} ▾`} onPress={() => setNsOpen(true)} />
      </View>
      <View style={styles.toolbar}>
        <TextInput
          style={styles.search}
          value={filter}
          onChangeText={setFilter}
          placeholder="Filter by name"
          placeholderTextColor={colors.textFaint}
          autoCapitalize="none"
          autoCorrect={false}
        />
      </View>

      {error ? (
        <View style={{ padding: spacing.lg }}>
          <ErrorBox message={error} />
          <Button title="Retry" variant="secondary" onPress={() => void load()} />
        </View>
      ) : loading ? (
        <Loading />
      ) : (
        <FlatList
          data={visible}
          keyExtractor={(release) => `${release.namespace}/${release.name}`}
          contentContainerStyle={styles.listContent}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={() => {
                setRefreshing(true);
                void load();
              }}
              tintColor={colors.accent}
            />
          }
          ListEmptyComponent={<EmptyState message="No Helm releases found." />}
          renderItem={({ item }) => (
            <TouchableOpacity
              onPress={() =>
                router.push({
                  pathname: '/cluster/[id]/helm-release',
                  params: {
                    id,
                    namespace: item.namespace,
                    name: item.name,
                    revision: String(item.revision),
                    secretName: item.secretName,
                  },
                })
              }
            >
              <Card style={styles.row}>
                <SquircleIcon abbr="He" color="#36B3F4" />
                <View style={{ flex: 1, gap: 2 }}>
                  <Text style={styles.rowName} numberOfLines={1}>
                    {item.name}
                  </Text>
                  <Text style={styles.rowSub} numberOfLines={1}>
                    {item.namespace} · revision {item.revision}
                  </Text>
                </View>
                <Text style={[styles.status, { color: helmStatusColor(item.status) }]}>
                  {item.status}
                </Text>
                <Text style={styles.chevron}>›</Text>
              </Card>
            </TouchableOpacity>
          )}
        />
      )}

      <NamespaceSheet visible={nsOpen} onClose={() => setNsOpen(false)} cluster={cluster} />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  header: {
    paddingTop: 60,
    paddingHorizontal: spacing.lg,
    paddingBottom: 8,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  title: { color: colors.text, fontSize: 22, fontWeight: '800', letterSpacing: -0.5 },
  toolbar: { paddingHorizontal: spacing.lg, paddingBottom: 10 },
  search: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 12,
    paddingHorizontal: 13,
    paddingVertical: 9,
    color: colors.text,
    fontSize: 14,
  },
  listContent: { paddingHorizontal: spacing.lg, paddingBottom: 60, gap: 9 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 13 },
  rowName: { color: colors.text, fontSize: 13.5, fontWeight: '600' },
  rowSub: { color: colors.textDim, fontSize: 11.5 },
  status: { fontSize: 11.5, fontWeight: '700' },
  chevron: { color: 'rgba(242,245,250,0.22)', fontSize: 18, fontWeight: '600' },
});
