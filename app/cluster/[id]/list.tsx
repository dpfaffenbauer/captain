import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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
import { listResources, restartRollout, scaleResource } from '../../../src/kube/client';
import { KubeStreamHandle } from '../../../src/kube/stream';
import { isWatchAvailable, watchResources } from '../../../src/kube/watch';
import {
  formatCpuUsage,
  formatMemoryUsage,
  getNodeMetrics,
  getPodMetrics,
  ResourceUsage,
} from '../../../src/kube/metrics';
import { parseCpu, parseMemory } from '../../../src/kube/quantity';
import { namespaceLabel, useClusterScope } from '../../../src/state/ClusterScope';
import { useClusters } from '../../../src/state/ClustersContext';
import { ApiResourceType, KubeListItem } from '../../../src/types';
import { useDetailSelection } from '../../../src/state/DetailSelection';
import { BackButton, Card, Pill, StatusDot, UsageBar } from '../../../src/ui/kit';
import { NamespaceSheet } from '../../../src/ui/sheets';
import { Button, EmptyState, ErrorBox, Loading } from '../../../src/ui/components';
import { useResponsiveLayout } from '../../../src/ui/useResponsiveLayout';
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

/** Problems first, like the design. */
function sortPodsBySeverity(items: KubeListItem[]): KubeListItem[] {
  const rank = (item: KubeListItem) => {
    const sev = podSeverity(item.raw as any);
    return sev.color === colors.danger ? 0 : sev.color === colors.warning ? 1 : 2;
  };
  return [...items].sort((a, b) => rank(a) - rank(b));
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
  const detail = useDetailSelection();

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
  const [usage, setUsage] = useState<Map<string, ResourceUsage> | null>(null);
  const [live, setLive] = useState(false);

  // iPad / landscape: list on the left, inspector pane on the right.
  const { isWide } = useResponsiveLayout();

  const isPods = type.group === '' && type.kind === 'Pod';
  const isDeployments = type.group === 'apps' && type.kind === 'Deployment';
  const isNodes = type.group === '' && type.kind === 'Node';

  // Each (re)load invalidates the previous watch; the generation counter
  // makes late events from an old stream harmless.
  const watchRef = useRef<KubeStreamHandle | null>(null);
  const watchGeneration = useRef(0);

  const stopWatch = useCallback(() => {
    watchGeneration.current += 1;
    watchRef.current?.stop();
    watchRef.current = null;
    setLive(false);
  }, []);

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
          next = sortPodsBySeverity(next);
        }
        setItems(next);
        setContinueToken(result.continueToken);
        if (reset) startWatch(result.resourceVersion);
        // Live usage from the metrics-server, when installed.
        if (isPods) {
          void getPodMetrics(cluster, type.namespaced && namespace !== '' ? namespace : undefined).then(setUsage);
        } else if (isNodes) {
          void getNodeMetrics(cluster).then(setUsage);
        }
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

  /** Keeps the list in sync via the watch API (only with the native build). */
  const startWatch = useCallback(
    (resourceVersion: string | undefined) => {
      stopWatch();
      if (!cluster || !resourceVersion || !isWatchAvailable()) return;
      const generation = watchGeneration.current;
      const keyOf = (item: KubeListItem) => `${item.namespace ?? ''}/${item.name}`;
      watchResources(
        cluster,
        type,
        {
          namespace: type.namespaced && namespace !== '' ? namespace : undefined,
          resourceVersion,
        },
        {
          onEvent: (event) => {
            if (watchGeneration.current !== generation) return;
            setItems((current) => {
              const key = keyOf(event.item);
              if (event.type === 'DELETED') {
                return current.filter((entry) => keyOf(entry) !== key);
              }
              const index = current.findIndex((entry) => keyOf(entry) === key);
              const next =
                index >= 0
                  ? [...current.slice(0, index), event.item, ...current.slice(index + 1)]
                  : [...current, event.item];
              return isPods ? sortPodsBySeverity(next) : next;
            });
          },
          onStale: () => {
            // resourceVersion expired or connection dropped: re-list.
            if (watchGeneration.current !== generation) return;
            void load(true);
          },
          onEnd: () => {
            if (watchGeneration.current === generation) setLive(false);
          },
        }
      )
        .then((handle) => {
          if (watchGeneration.current !== generation) {
            handle.stop();
            return;
          }
          watchRef.current = handle;
          setLive(true);
        })
        .catch(() => setLive(false));
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [cluster, type, namespace, isPods, stopWatch]
  );

  useFocusEffect(
    useCallback(() => {
      setLoading(true);
      void load(true);
      return stopWatch;
    }, [load, stopWatch])
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

  // A new kind or namespace invalidates the detail selection; so does leaving.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => detail.close(), [type, namespace]);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => () => detail.close(), []);

  const handlePress = (item: KubeListItem) => {
    if (isWide) {
      detail.open({
        kind: 'item',
        type,
        name: item.name,
        namespace: type.namespaced ? item.namespace : undefined,
      });
    } else {
      openItem(item);
    }
  };

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

  const handleScale = (item: KubeListItem) => {
    const current = (item.raw as any).spec?.replicas ?? 0;
    Alert.prompt(
      'Scale',
      `${item.name} · currently ${current} replicas`,
      (value) => {
        const replicas = parseInt(value, 10);
        if (Number.isNaN(replicas) || replicas < 0 || !cluster) return;
        scaleResource(cluster, type, item.name, replicas, item.namespace)
          .then(() => load(true))
          .catch((caught) =>
            setError(caught instanceof Error ? caught.message : String(caught))
          );
      },
      'plain-text',
      String(current),
      'number-pad'
    );
  };

  const renderItem = ({ item }: { item: KubeListItem }) => {
    const raw = item.raw as any;
    const root = detail.stack[0];
    const isSelected =
      isWide &&
      root?.kind === 'item' &&
      root.type.plural === type.plural &&
      root.name === item.name &&
      (root.namespace ?? '') === (item.namespace ?? '');
    const selectionBorder = isSelected ? 'rgba(91,124,255,0.55)' : undefined;

    if (isPods) {
      const sev = podSeverity(raw);
      const restarts = podRestarts(raw);
      const podUsage = usage?.get(`${item.namespace ?? ''}/${item.name}`);
      return (
        <TouchableOpacity onPress={() => handlePress(item)}>
          <Card style={styles.podCard} borderColor={selectionBorder}>
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
              <Text style={styles.podCpu}>
                {podUsage ? formatCpuUsage(podUsage.cpu) : item.namespace}
              </Text>
              <Text style={styles.podAge}>{ageOf(item.creationTimestamp)}</Text>
            </View>
          </Card>
        </TouchableOpacity>
      );
    }

    if (isNodes) {
      const conditions: any[] = raw.status?.conditions ?? [];
      const ready = conditions.find((c: any) => c.type === 'Ready')?.status === 'True';
      const pressure = conditions.find(
        (c: any) => c.type.endsWith('Pressure') && c.status === 'True'
      );
      const status = !ready ? 'NotReady' : pressure ? pressure.type : 'Ready';
      const tone = !ready ? colors.danger : pressure ? colors.warning : colors.success;
      const role = Object.keys(raw.metadata?.labels ?? {})
        .find((label: string) => label.startsWith('node-role.kubernetes.io/'))
        ?.split('/')[1] ?? 'worker';
      const version = raw.status?.nodeInfo?.kubeletVersion ?? '';
      const nodeUsage = usage?.get(item.name);
      const cpuAlloc = parseCpu(raw.status?.allocatable?.cpu);
      const memAlloc = parseMemory(raw.status?.allocatable?.memory);
      const cpuPct = nodeUsage && cpuAlloc > 0 ? (nodeUsage.cpu / cpuAlloc) * 100 : undefined;
      const memPct = nodeUsage && memAlloc > 0 ? (nodeUsage.memory / memAlloc) * 100 : undefined;
      const barColor = (pct: number) =>
        pct >= 85 ? colors.danger : pct >= 60 ? colors.warning : colors.accent;
      return (
        <TouchableOpacity onPress={() => handlePress(item)}>
          <Card
            style={styles.nodeCard}
            borderColor={
              selectionBorder ?? (tone === colors.warning ? 'rgba(251,191,85,0.3)' : undefined)
            }
          >
            <View style={styles.nodeHead}>
              <StatusDot color={tone} size={9} />
              <Text style={[styles.itemName, { flex: 1, fontSize: 14.5 }]} numberOfLines={1}>
                {item.name}
              </Text>
              <Text style={[styles.nodeStatus, { color: tone }]}>{status}</Text>
            </View>
            <View style={styles.nodeMetaRow}>
              <Text style={styles.podMeta}>{role}</Text>
              <Text style={styles.podMeta}>{version}</Text>
            </View>
            {cpuPct !== undefined || memPct !== undefined ? (
              <View style={styles.nodeBars}>
                {cpuPct !== undefined ? (
                  <View style={{ flex: 1, gap: 5 }}>
                    <View style={styles.nodeBarHead}>
                      <Text style={styles.nodeBarLabel}>CPU</Text>
                      <Text style={styles.nodeBarLabel}>{Math.round(cpuPct)}%</Text>
                    </View>
                    <UsageBar percent={cpuPct} color={barColor(cpuPct)} />
                  </View>
                ) : null}
                {memPct !== undefined && nodeUsage ? (
                  <View style={{ flex: 1, gap: 5 }}>
                    <View style={styles.nodeBarHead}>
                      <Text style={styles.nodeBarLabel}>Memory</Text>
                      <Text style={styles.nodeBarLabel}>
                        {formatMemoryUsage(nodeUsage.memory)} · {Math.round(memPct)}%
                      </Text>
                    </View>
                    <UsageBar percent={memPct} color={barColor(memPct)} />
                  </View>
                ) : null}
              </View>
            ) : null}
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
        <TouchableOpacity onPress={() => handlePress(item)}>
          <Card style={styles.depCard} borderColor={selectionBorder}>
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
              <View style={styles.depActions}>
                <TouchableOpacity style={styles.restartButton} onPress={() => handleScale(item)}>
                  <Text style={styles.restartText}>⇅ Scale</Text>
                </TouchableOpacity>
                <TouchableOpacity style={styles.restartButton} onPress={() => handleRestart(item)}>
                  <Text style={styles.restartText}>↺ Restart</Text>
                </TouchableOpacity>
              </View>
            </View>
          </Card>
        </TouchableOpacity>
      );
    }

    return (
      <TouchableOpacity onPress={() => handlePress(item)}>
        <Card style={styles.genericCard} borderColor={selectionBorder}>
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

  const listView = (
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
  );

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
      <View style={styles.metaRow}>
        <Text style={styles.meta}>
          {visibleItems.length} shown{isPods ? ' · problems first' : ''}
        </Text>
        {live ? (
          <View style={styles.liveTag}>
            <StatusDot color={colors.success} size={6} />
            <Text style={styles.liveText}>live</Text>
          </View>
        ) : null}
      </View>

      {error ? (
        <View style={{ padding: spacing.lg }}>
          <ErrorBox message={error} />
          <Button title="Retry" variant="secondary" onPress={() => void load(true)} />
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
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 18,
    paddingBottom: 10,
  },
  meta: { color: colors.textFaint, fontSize: 11.5 },
  liveTag: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  liveText: { color: colors.success, fontSize: 10.5, fontWeight: '700' },
  listContent: { paddingHorizontal: spacing.lg, paddingBottom: 60, gap: 9 },
  itemName: { color: colors.text, fontSize: 13.5, fontWeight: '600' },
  podCard: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 13 },
  podMetaRow: { flexDirection: 'row', gap: 9 },
  podStatus: { fontSize: 11.5, fontWeight: '600' },
  podMeta: { color: colors.textDim, fontSize: 11.5 },
  podRight: { alignItems: 'flex-end', gap: 3 },
  podNs: { color: 'rgba(242,245,250,0.4)', fontSize: 11 },
  podCpu: { color: 'rgba(242,245,250,0.7)', fontSize: 12, fontWeight: '600' },
  podAge: { color: colors.textFaint, fontSize: 10.5 },
  nodeCard: { gap: 11, padding: 15 },
  nodeHead: { flexDirection: 'row', alignItems: 'center', gap: 9 },
  nodeStatus: { fontSize: 11.5, fontWeight: '600' },
  nodeMetaRow: { flexDirection: 'row', gap: 12 },
  nodeBars: { flexDirection: 'row', gap: 12 },
  nodeBarHead: { flexDirection: 'row', justifyContent: 'space-between' },
  nodeBarLabel: { color: 'rgba(242,245,250,0.5)', fontSize: 10.5, fontWeight: '600' },
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
  depActions: { flexDirection: 'row', gap: 7 },
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
