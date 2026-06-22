import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Alert,
  FlatList,
  RefreshControl,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from '../rn';
import { GitOpsApp, listGitOpsApps, triggerSync } from '../../kube/gitops';
import { useClusters } from '../../state/ClustersContext';
import { useClusterNav } from '../../state/ClusterNav';
import { hapticTap } from '../../util/haptics';
import { BackButton, Card, SquircleIcon, StatusDot } from '../kit';
import { EmptyState, ErrorBox, Loading } from '../components';
import { colors, radius, spacing } from '../theme';

function syncColor(app: GitOpsApp): string {
  if (app.suspended) return colors.textDim;
  if (app.syncStatus === 'Synced' || app.syncStatus === 'Ready') return colors.success;
  if (app.syncStatus === 'Reconciling' || app.syncStatus === 'Progressing') return colors.warning;
  return colors.danger;
}

function healthColor(status: string | undefined): string {
  if (status === 'Healthy') return colors.success;
  if (status === 'Progressing' || status === 'Suspended') return colors.warning;
  return colors.danger;
}

export function GitopsContent({ clusterId }: { clusterId: string }) {
  const nav = useClusterNav();
  const { getById } = useClusters();
  const cluster = getById(clusterId);

  const [apps, setApps] = useState<GitOpsApp[]>([]);
  const [filter, setFilter] = useState('');
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [syncing, setSyncing] = useState<string | null>(null);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    if (!cluster) return;
    setError('');
    try {
      setApps(await listGitOpsApps(cluster));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [cluster]);

  useEffect(() => {
    void load();
  }, [load]);

  const visible = useMemo(() => {
    const query = filter.trim().toLowerCase();
    if (!query) return apps;
    return apps.filter(
      (app) => app.name.toLowerCase().includes(query) || app.namespace.toLowerCase().includes(query)
    );
  }, [apps, filter]);

  const keyOf = (app: GitOpsApp) => `${app.type.kind}/${app.namespace}/${app.name}`;

  const handleSync = (app: GitOpsApp) => {
    Alert.alert(
      app.source === 'argocd' ? 'Sync application' : 'Reconcile now',
      `Trigger ${app.source === 'argocd' ? 'a sync' : 'a reconciliation'} of "${app.name}"?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: app.source === 'argocd' ? 'Sync' : 'Reconcile',
          onPress: () => {
            if (!cluster) return;
            hapticTap();
            setSyncing(keyOf(app));
            triggerSync(cluster, app)
              .then(() => load())
              .catch((caught) =>
                setError(caught instanceof Error ? caught.message : String(caught))
              )
              .finally(() => setSyncing(null));
          },
        },
      ]
    );
  };

  const openApp = (app: GitOpsApp) => {
    nav.openItem(app.type, app.name, app.namespace);
  };

  if (!cluster) return <EmptyState message="Cluster not found." />;

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        {!nav.embedded ? <BackButton onPress={() => nav.back()} /> : null}
        <Text style={styles.title}>GitOps</Text>
        <View style={{ flex: 1 }} />
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
        <FlatList
          data={visible}
          keyExtractor={keyOf}
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
          ListEmptyComponent={
            <EmptyState message="No Argo CD applications or Flux resources found." />
          }
          renderItem={({ item }) => (
            <TouchableOpacity onPress={() => openApp(item)}>
              <Card style={styles.row}>
                <View style={styles.rowHead}>
                  <SquircleIcon
                    abbr={item.source === 'argocd' ? 'Ar' : 'Fx'}
                    color={item.source === 'argocd' ? '#F4845C' : '#3D6DE2'}
                  />
                  <View style={{ flex: 1, gap: 2 }}>
                    <Text style={styles.rowName} numberOfLines={1}>
                      {item.name}
                    </Text>
                    <Text style={styles.rowSub} numberOfLines={1}>
                      {item.type.kind} · {item.namespace}
                      {item.revision ? ` · ${item.revision}` : ''}
                    </Text>
                  </View>
                  <View style={{ alignItems: 'flex-end', gap: 3 }}>
                    <View style={styles.statusLine}>
                      <StatusDot color={syncColor(item)} size={7} />
                      <Text style={[styles.statusText, { color: syncColor(item) }]}>
                        {item.suspended ? 'Suspended' : item.syncStatus}
                      </Text>
                    </View>
                    {item.healthStatus ? (
                      <Text style={[styles.statusText, { color: healthColor(item.healthStatus) }]}>
                        {item.healthStatus}
                      </Text>
                    ) : null}
                  </View>
                </View>
                {item.message ? (
                  <Text style={styles.message} numberOfLines={2}>
                    {item.message}
                  </Text>
                ) : null}
                <View style={styles.rowFoot}>
                  <TouchableOpacity
                    style={styles.syncButton}
                    disabled={syncing !== null}
                    onPress={() => handleSync(item)}
                  >
                    <Text style={styles.syncText}>
                      {syncing === keyOf(item)
                        ? 'Syncing…'
                        : item.source === 'argocd'
                          ? '⟳ Sync'
                          : '⟳ Reconcile'}
                    </Text>
                  </TouchableOpacity>
                </View>
              </Card>
            </TouchableOpacity>
          )}
        />
      )}
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
  row: { gap: 9, padding: 13 },
  rowHead: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  rowName: { color: colors.text, fontSize: 13.5, fontWeight: '600' },
  rowSub: { color: colors.textDim, fontSize: 11.5 },
  statusLine: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  statusText: { fontSize: 11, fontWeight: '700' },
  message: { color: colors.textDim, fontSize: 11.5, lineHeight: 16 },
  rowFoot: { flexDirection: 'row', justifyContent: 'flex-end' },
  syncButton: {
    backgroundColor: colors.accentSoft,
    borderRadius: radius.pill,
    paddingHorizontal: 13,
    paddingVertical: 6,
  },
  syncText: { color: '#fff', fontSize: 12, fontWeight: '600' },
});
