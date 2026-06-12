import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import React, { useCallback, useMemo, useState } from 'react';
import {
  Alert,
  FlatList,
  RefreshControl,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { listResources, restartRollout } from '../../../src/kube/client';
import { namespaceLabel, useClusterScope } from '../../../src/state/ClusterScope';
import { useClusters } from '../../../src/state/ClustersContext';
import { ApiResourceType, KubeListItem } from '../../../src/types';
import { BackButton, Card, Pill, StatusDot, UsageBar } from '../../../src/ui/kit';
import { NamespaceSheet } from '../../../src/ui/sheets';
import { Button, EmptyState, ErrorBox, Loading } from '../../../src/ui/components';
import { colors, radius, spacing } from '../../../src/ui/theme';
import { ageOf } from '../../../src/util/format';

function podSeverity(raw: any): { color: string; status: string } {
  const phase = raw.status?.phase ?? 'Unknown';
  const waiting = (raw.status?.containerStatuses ?? []).find((s: any) => s.state?.waiting)?.state
    ?.waiting?.reason;
  if (waiting === 'CrashLoopBackOff' || phase === 'Failed') {
    return { color: colors.danger, status: waiting ?? phase };
  }
  if (phase === 'Pending' || waiting) {
    return { color: colors.warning, status: waiting ?? phase };
  }
  if (phase === 'Running' || phase === 'Succeeded') {
    return { color: colors.success, status: phase };
  }
  return { color: colors.textDim, status: phase };
}

function podReady(raw: any): string {
  const statuses: any[] = raw.status?.containerStatuses ?? [];
  const ready = statuses.filter((s) => s.ready).length;
  return `${ready}/${statuses.length || (raw.spec?.containers ?? []).length}`;
}

function podRestarts(raw: any): number {
  return (raw.status?.containerStatuses ?? []).reduce(
    (sum: number, s: any) => sum + (s.restartCount ?? 0),
    0
  );
}

export default function ResourceListScreen() {
  const params = useLocalSearchParams<{
    id: string;
    group: string;
    version: string;
    plural: string;
    kind: string;
    namespaced: string;
    verbs: string;
  }>();
  const router = useRouter();
  const { getById } = useClusters();
  const cluster = getById(params.id);
  const { namespace } = useClusterScope();

  const type = useMemo<ApiResourceType>(
    () => ({
      group: params.group ?? '',
      version: params.version ?? 'v1',
      plural: params.plural ?? '',
      kind: params.kind ?? '',
      namespaced: params.namespaced === '1',
      verbs: (params.verbs ?? '').split(',').filter(Boolean),
    }),
    [params.group, params.version, params.plural, params.kind, params.namespaced, params.verbs]
  );

  const [items, setItems] = useState<KubeListItem[]>([]);
  const [continueToken, setContinueToken] = useState<string | undefined>();
  const [filter, setFilter] = useState('');
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');
  const [nsOpen, setNsOpen] = useState(false);

  const isPods = type.group === '' && type.kind === 'Pod';
  const isDeployments = type.group === 'apps' && type.kind === 'Deployment';

  const load = useCallback(
    async (reset: boolean, token?: string) => {
      if (!cluster) return;
      setError('');
      try {
        const result = await listResources(cluster, type, {
          namespace: type.namespaced && namespace !== '' ? namespace : undefined,
          continueToken: token,
        });
        let next = reset ? result.items : [...items, ...result.items];
        if (isPods) {
          // Problems first, like the design.
          next = [...next].sort((a, b) => {
            const rank = (item: KubeListItem) => {
              const sev = podSeverity(item.raw as any);
              return sev.color === colors.danger ? 0 : sev.color === colors.warning ? 1 : 2;
            };
            return rank(a) - rank(b);
          });
        }
        setItems(next);
        setContinueToken(result.continueToken);
      } catch (caught) {
        setError(caught instanceof Error ? caught.message : String(caught));
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [cluster, type, namespace]
  );

  useFocusEffect(
    useCallback(() => {
      setLoading(true);
      void load(true);
    }, [load])
  );

  const visibleItems = useMemo(() => {
    const query = filter.trim().toLowerCase();
    if (!query) return items;
    return items.filter(
      (item) =>
        item.name.toLowerCase().includes(query) ||
        (item.namespace ?? '').toLowerCase().includes(query)
    );
  }, [items, filter]);

  const openItem = (item: KubeListItem) => {
    router.push({
      pathname: '/cluster/[id]/item',
      params: {
        id: params.id,
        group: type.group,
        version: type.version,
        plural: type.plural,
        kind: type.kind,
        namespaced: type.namespaced ? '1' : '0',
        verbs: type.verbs.join(','),
        name: item.name,
        namespace: item.namespace ?? '',
      },
    });
  };

  const handleRestart = (item: KubeListItem) => {
    Alert.alert('Restart rollout', `Restart ${item.name}?`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Restart',
        onPress: () => {
          if (!cluster) return;
          restartRollout(cluster, type, item.name, item.namespace)
            .then(() => load(true))
            .catch((caught) =>
              setError(caught instanceof Error ? caught.message : String(caught))
            );
        },
      },
    ]);
  };

  const renderItem = ({ item }: { item: KubeListItem }) => {
    const raw = item.raw as any;

    if (isPods) {
      const sev = podSeverity(raw);
      const restarts = podRestarts(raw);
      return (
        <TouchableOpacity onPress={() => openItem(item)}>
          <Card style={styles.podCard}>
            <StatusDot color={sev.color} size={10} />
            <View style={{ flex: 1, gap: 3 }}>
              <Text style={styles.itemName} numberOfLines={1}>
                {item.name}
              </Text>
              <View style={styles.podMetaRow}>
                <Text style={[styles.podStatus, { color: sev.color }]}>{sev.status}</Text>
                <Text style={styles.podMeta}>{podReady(raw)}</Text>
                <Text style={styles.podMeta}>
                  {restarts} {restarts === 1 ? 'restart' : 'restarts'}
                </Text>
              </View>
            </View>
            <View style={styles.podRight}>
              <Text style={styles.podNs}>{item.namespace}</Text>
              <Text style={styles.podAge}>{ageOf(item.creationTimestamp)}</Text>
            </View>
          </Card>
        </TouchableOpacity>
      );
    }

    if (isDeployments) {
      const desired = raw.spec?.replicas ?? 0;
      const ready = raw.status?.readyReplicas ?? 0;
      const pct = desired > 0 ? (ready / desired) * 100 : 0;
      const tone = ready >= desired && desired > 0 ? colors.success : desired === 0 ? colors.textDim : colors.warning;
      const image = raw.spec?.template?.spec?.containers?.[0]?.image ?? '';
      return (
        <TouchableOpacity onPress={() => openItem(item)}>
          <Card style={styles.depCard}>
            <View style={styles.depHead}>
              <Text style={[styles.itemName, { flex: 1 }]} numberOfLines={1}>
                {item.name}
              </Text>
              <Text style={[styles.depReady, { color: tone }]}>
                {ready}/{desired} ready
              </Text>
            </View>
            <UsageBar percent={pct} color={tone} />
            <View style={styles.depFoot}>
              <Text style={styles.depImage} numberOfLines={1}>
                {image}
              </Text>
              <TouchableOpacity style={styles.restartButton} onPress={() => handleRestart(item)}>
                <Text style={styles.restartText}>↺ Restart</Text>
              </TouchableOpacity>
            </View>
          </Card>
        </TouchableOpacity>
      );
    }

    return (
      <TouchableOpacity onPress={() => openItem(item)}>
        <Card style={styles.genericCard}>
          <StatusDot color={colors.success} size={8} />
          <View style={{ flex: 1, gap: 2 }}>
            <Text style={styles.itemName} numberOfLines={1}>
              {item.name}
            </Text>
            {item.namespace ? <Text style={styles.podNs}>{item.namespace}</Text> : null}
          </View>
          <Text style={styles.podAge}>{ageOf(item.creationTimestamp)}</Text>
          <Text style={styles.chevron}>›</Text>
        </Card>
      </TouchableOpacity>
    );
  };

  if (!cluster) return <EmptyState message="Cluster not found." />;

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <BackButton onPress={() => router.back()} />
        <Text style={styles.title} numberOfLines={1}>
          {type.kind}s
        </Text>
        <View style={{ flex: 1 }} />
        {type.namespaced ? (
          <Pill label={`${namespaceLabel(namespace)} ▾`} onPress={() => setNsOpen(true)} />
        ) : (
          <Pill label="cluster" />
        )}
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
      <Text style={styles.meta}>
        {visibleItems.length} shown{isPods ? ' · problems first' : ''}
      </Text>

      {error ? (
        <View style={{ padding: spacing.lg }}>
          <ErrorBox message={error} />
          <Button title="Retry" variant="secondary" onPress={() => void load(true)} />
        </View>
      ) : loading ? (
        <Loading />
      ) : (
        <FlatList
          data={visibleItems}
          keyExtractor={(item) => `${item.namespace ?? ''}/${item.name}`}
          contentContainerStyle={styles.listContent}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={() => {
                setRefreshing(true);
                void load(true);
              }}
              tintColor={colors.accent}
            />
          }
          ListEmptyComponent={<EmptyState message={`No ${type.plural} found.`} />}
          ListFooterComponent={
            continueToken ? (
              <View style={{ paddingTop: spacing.md }}>
                <Button
                  title="Load more"
                  variant="secondary"
                  onPress={() => void load(false, continueToken)}
                />
              </View>
            ) : null
          }
          renderItem={renderItem}
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
  title: { color: colors.text, fontSize: 24, fontWeight: '800', letterSpacing: -0.5 },
  toolbar: { paddingHorizontal: spacing.lg, paddingBottom: 6 },
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
  meta: { color: colors.textFaint, fontSize: 11.5, paddingHorizontal: 18, paddingBottom: 10 },
  listContent: { paddingHorizontal: spacing.lg, paddingBottom: 60, gap: 9 },
  itemName: { color: colors.text, fontSize: 13.5, fontWeight: '600' },
  podCard: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 13 },
  podMetaRow: { flexDirection: 'row', gap: 9 },
  podStatus: { fontSize: 11.5, fontWeight: '600' },
  podMeta: { color: colors.textDim, fontSize: 11.5 },
  podRight: { alignItems: 'flex-end', gap: 3 },
  podNs: { color: 'rgba(242,245,250,0.4)', fontSize: 11 },
  podAge: { color: colors.textFaint, fontSize: 10.5 },
  depCard: { gap: 10, padding: 15 },
  depHead: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  depReady: { fontSize: 12.5, fontWeight: '700' },
  depFoot: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10 },
  depImage: {
    flex: 1,
    color: 'rgba(242,245,250,0.38)',
    fontFamily: 'Menlo',
    fontSize: 10,
  },
  restartButton: {
    backgroundColor: colors.accentSoft,
    borderRadius: radius.pill,
    paddingHorizontal: 13,
    paddingVertical: 6,
  },
  restartText: { color: '#fff', fontSize: 12, fontWeight: '600' },
  genericCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: 13,
    borderRadius: radius.card,
  },
  chevron: { color: 'rgba(242,245,250,0.22)', fontSize: 18, fontWeight: '600' },
});
