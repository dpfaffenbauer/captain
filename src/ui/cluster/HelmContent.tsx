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
import { HelmRelease, listHelmReleases } from '../../kube/helm';
import { namespaceLabel, useClusterScope } from '../../state/ClusterScope';
import { useClusterNav } from '../../state/ClusterNav';
import { useClusters } from '../../state/ClustersContext';
import { useDetailSelection } from '../../state/DetailSelection';
import { BackButton, Card, Pill, SquircleIcon } from '../kit';
import { helmStatusColor } from '../helmStatus';
import { NamespaceSheet } from '../sheets';
import { EmptyState, ErrorBox, Loading } from '../components';
import { useResponsiveLayout } from '../useResponsiveLayout';
import { colors, spacing } from '../theme';

export { helmStatusColor };

export function HelmContent({ clusterId }: { clusterId: string }) {
  const { getById } = useClusters();
  const cluster = getById(clusterId);
  const { namespace } = useClusterScope();
  const { isWide } = useResponsiveLayout();
  const detail = useDetailSelection();
  const nav = useClusterNav();

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

  // A namespace change invalidates the detail selection; so does leaving.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => detail.close(), [namespace]);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => () => detail.close(), []);

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

  const handlePress = (item: HelmRelease) => {
    nav.openHelmRelease({
      namespace: item.namespace,
      name: item.name,
      revision: String(item.revision),
      secretName: item.secretName,
    });
  };

  const root = detail.stack[0];
  const isSelected = (item: HelmRelease) =>
    isWide &&
    root?.kind === 'helm-release' &&
    root.namespace === item.namespace &&
    root.name === item.name;

  const listView = (
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
        <TouchableOpacity onPress={() => handlePress(item)}>
          <Card style={styles.row} borderColor={isSelected(item) ? 'rgba(91,124,255,0.55)' : undefined}>
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
  );

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        {!nav.embedded ? <BackButton onPress={() => nav.back()} /> : null}
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
          <ErrorBox message={error} onRetry={() => void load()} />
        </View>
      ) : loading ? (
        <Loading />
      ) : (
        listView
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
