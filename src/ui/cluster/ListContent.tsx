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
  ViewStyle,
} from 'react-native';
import { listResources, restartRollout, scaleResource } from '../../kube/client';
import { KubeStreamHandle } from '../../kube/stream';
import { isWatchAvailable, watchResources } from '../../kube/watch';
import {
  formatCpuUsage,
  formatMemoryUsage,
  getNodeMetrics,
  getPodMetrics,
  ResourceUsage,
} from '../../kube/metrics';
import { parseCpu, parseMemory } from '../../kube/quantity';
import { useAccess } from '../../state/AccessContext';
import { namespaceLabel, useClusterScope } from '../../state/ClusterScope';
import { useClusterNav } from '../../state/ClusterNav';
import { useClusters } from '../../state/ClustersContext';
import { ApiResourceType, KubeListItem } from '../../types';
import { useDetailSelection } from '../../state/DetailSelection';
import { BackButton, Card, Pill, StatusDot, UsageBar } from '../kit';
import { NamespaceSheet } from '../sheets';
import { Button, EmptyState, ErrorBox, Loading } from '../components';
import { useResponsiveLayout } from '../useResponsiveLayout';
import { colors, radius, spacing } from '../theme';
import { ageOf } from '../../util/format';

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

function nodeMeta(raw: any): { status: string; tone: string; role: string; version: string } {
  const conditions: any[] = raw.status?.conditions ?? [];
  const ready = conditions.find((c: any) => c.type === 'Ready')?.status === 'True';
  const pressure = conditions.find((c: any) => c.type.endsWith('Pressure') && c.status === 'True');
  const status = !ready ? 'NotReady' : pressure ? pressure.type : 'Ready';
  const tone = !ready ? colors.danger : pressure ? colors.warning : colors.success;
  const role =
    Object.keys(raw.metadata?.labels ?? {})
      .find((label: string) => label.startsWith('node-role.kubernetes.io/'))
      ?.split('/')[1] ?? 'worker';
  const version = raw.status?.nodeInfo?.kubeletVersion ?? '';
  return { status, tone, role, version };
}

/** Problems first, like the design. */
function sortPodsBySeverity(items: KubeListItem[]): KubeListItem[] {
  const rank = (item: KubeListItem) => {
    const sev = podSeverity(item.raw as any);
    return sev.color === colors.danger ? 0 : sev.color === colors.warning ? 1 : 2;
  };
  return [...items].sort((a, b) => rank(a) - rank(b));
}

/**
 * Resource list master view. Driven by props (clusterId + resource type) so it
 * works both as a pushed route (phone) and as keep-alive content in the wide
 * split layout. Navigation goes through ClusterNav.
 */
export function ListContent({ clusterId, type }: { clusterId: string; type: ApiResourceType }) {
  const { getById } = useClusters();
  const cluster = getById(clusterId);
  const { namespace } = useClusterScope();
  const { checkAccess } = useAccess();
  const detail = useDetailSelection();
  const nav = useClusterNav();

  const [items, setItems] = useState<KubeListItem[]>([]);
  const [continueToken, setContinueToken] = useState<string | undefined>();
  const [filter, setFilter] = useState('');
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');
  const [denied, setDenied] = useState(false);
  const [nsOpen, setNsOpen] = useState(false);
  const [usage, setUsage] = useState<Map<string, ResourceUsage> | null>(null);
  const [live, setLive] = useState(false);
  const [sort, setSort] = useState<{ key: string; dir: 'asc' | 'desc' } | null>(null);

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
      const scopeNamespace = type.namespaced && namespace !== '' ? namespace : undefined;
      try {
        // Ask the API server whether we may list this kind in this scope before
        // trying — turns a hard "forbidden" into a clear, actionable message.
        const allowed = await checkAccess({
          verb: 'list',
          group: type.group,
          resource: type.plural,
          namespace: scopeNamespace,
        });
        if (!allowed) {
          stopWatch();
          setDenied(true);
          setItems([]);
          setContinueToken(undefined);
          return;
        }
        setDenied(false);
        const result = await listResources(cluster, type, {
          namespace: scopeNamespace,
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
    [cluster, type, namespace, checkAccess]
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

  // Re-list whenever the resource kind or namespace changes, and stop the watch
  // on unmount. (Replaces the route-focus effect; this component stays mounted.)
  useEffect(() => {
    setLoading(true);
    void load(true);
    return stopWatch;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [load, stopWatch]);

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
    nav.openItem(type, item.name, type.namespaced ? item.namespace : undefined);
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

  // Wide layout: a real table with per-kind columns (phone keeps cards).
  const cellText = (value: string, muted?: boolean, color?: string) => (
    <Text
      style={[styles.cellText, muted && styles.cellMuted, color ? { color } : null]}
      numberOfLines={1}
    >
      {value}
    </Text>
  );
  const nameCell = (name: string, dotColor?: string) => (
    <View style={styles.nameCell}>
      {dotColor ? <StatusDot color={dotColor} size={8} /> : null}
      <Text style={styles.cellName} numberOfLines={1}>
        {name}
      </Text>
    </View>
  );

  type Column = {
    key: string;
    label: string;
    style: ViewStyle;
    align?: 'right';
    render: (item: KubeListItem) => React.ReactNode;
    sortValue?: (item: KubeListItem) => string | number;
  };

  const ageValue = (item: KubeListItem) => Date.parse(item.creationTimestamp ?? '') || 0;
  const nameValue = (item: KubeListItem) => item.name.toLowerCase();
  const podRank = (raw: any) => {
    const c = podSeverity(raw).color;
    return c === colors.danger ? 0 : c === colors.warning ? 1 : 2;
  };
  const podReadyCount = (raw: any) =>
    (raw.status?.containerStatuses ?? []).filter((s: any) => s.ready).length;

  let columns: Column[];
  if (isPods) {
    columns = [
      { key: 'name', label: 'Name', style: { flex: 2.4 }, sortValue: nameValue, render: (item) => nameCell(item.name, podSeverity(item.raw as any).color) },
      { key: 'status', label: 'Status', style: { flex: 1.3 }, sortValue: (item) => podRank(item.raw as any), render: (item) => { const s = podSeverity(item.raw as any); return cellText(s.status, false, s.color); } },
      { key: 'ready', label: 'Ready', style: { width: 64 }, sortValue: (item) => podReadyCount(item.raw as any), render: (item) => cellText(podReady(item.raw as any)) },
      { key: 'restarts', label: 'Restarts', style: { width: 76 }, align: 'right', sortValue: (item) => podRestarts(item.raw as any), render: (item) => cellText(String(podRestarts(item.raw as any)), true) },
      { key: 'cpu', label: 'CPU', style: { width: 78 }, align: 'right', sortValue: (item) => usage?.get(`${item.namespace ?? ''}/${item.name}`)?.cpu ?? -1, render: (item) => { const u = usage?.get(`${item.namespace ?? ''}/${item.name}`); return cellText(u ? formatCpuUsage(u.cpu) : '—', true); } },
      { key: 'mem', label: 'Memory', style: { width: 92 }, align: 'right', sortValue: (item) => usage?.get(`${item.namespace ?? ''}/${item.name}`)?.memory ?? -1, render: (item) => { const u = usage?.get(`${item.namespace ?? ''}/${item.name}`); return cellText(u ? formatMemoryUsage(u.memory) : '—', true); } },
      { key: 'age', label: 'Age', style: { width: 56 }, align: 'right', sortValue: ageValue, render: (item) => cellText(ageOf(item.creationTimestamp), true) },
    ];
  } else if (isNodes) {
    columns = [
      { key: 'name', label: 'Name', style: { flex: 2.2 }, sortValue: nameValue, render: (item) => nameCell(item.name, nodeMeta(item.raw as any).tone) },
      { key: 'status', label: 'Status', style: { flex: 1 }, sortValue: (item) => nodeMeta(item.raw as any).status, render: (item) => { const m = nodeMeta(item.raw as any); return cellText(m.status, false, m.tone); } },
      { key: 'role', label: 'Roles', style: { width: 96 }, sortValue: (item) => nodeMeta(item.raw as any).role, render: (item) => cellText(nodeMeta(item.raw as any).role) },
      { key: 'version', label: 'Version', style: { width: 108 }, sortValue: (item) => nodeMeta(item.raw as any).version, render: (item) => cellText(nodeMeta(item.raw as any).version, true) },
      { key: 'cpu', label: 'CPU', style: { width: 70 }, align: 'right', sortValue: (item) => { const u = usage?.get(item.name); const alloc = parseCpu((item.raw as any).status?.allocatable?.cpu); return u && alloc > 0 ? (u.cpu / alloc) * 100 : -1; }, render: (item) => { const u = usage?.get(item.name); const alloc = parseCpu((item.raw as any).status?.allocatable?.cpu); const pct = u && alloc > 0 ? (u.cpu / alloc) * 100 : undefined; return cellText(pct !== undefined ? `${Math.round(pct)}%` : '—', true); } },
      { key: 'mem', label: 'Memory', style: { width: 80 }, align: 'right', sortValue: (item) => { const u = usage?.get(item.name); const alloc = parseMemory((item.raw as any).status?.allocatable?.memory); return u && alloc > 0 ? (u.memory / alloc) * 100 : -1; }, render: (item) => { const u = usage?.get(item.name); const alloc = parseMemory((item.raw as any).status?.allocatable?.memory); const pct = u && alloc > 0 ? (u.memory / alloc) * 100 : undefined; return cellText(pct !== undefined ? `${Math.round(pct)}%` : '—', true); } },
      { key: 'age', label: 'Age', style: { width: 56 }, align: 'right', sortValue: ageValue, render: (item) => cellText(ageOf(item.creationTimestamp), true) },
    ];
  } else if (isDeployments) {
    columns = [
      { key: 'name', label: 'Name', style: { flex: 2.6 }, sortValue: nameValue, render: (item) => nameCell(item.name) },
      { key: 'ready', label: 'Ready', style: { width: 90 }, sortValue: (item) => { const raw = item.raw as any; const d = raw.spec?.replicas ?? 0; return d > 0 ? (raw.status?.readyReplicas ?? 0) / d : 0; }, render: (item) => { const raw = item.raw as any; const desired = raw.spec?.replicas ?? 0; const ready = raw.status?.readyReplicas ?? 0; const tone = ready >= desired && desired > 0 ? colors.success : desired === 0 ? colors.textDim : colors.warning; return cellText(`${ready}/${desired}`, false, tone); } },
      { key: 'updated', label: 'Up-to-date', style: { width: 96 }, align: 'right', sortValue: (item) => (item.raw as any).status?.updatedReplicas ?? 0, render: (item) => cellText(String((item.raw as any).status?.updatedReplicas ?? 0), true) },
      { key: 'available', label: 'Available', style: { width: 86 }, align: 'right', sortValue: (item) => (item.raw as any).status?.availableReplicas ?? 0, render: (item) => cellText(String((item.raw as any).status?.availableReplicas ?? 0), true) },
      { key: 'age', label: 'Age', style: { width: 56 }, align: 'right', sortValue: ageValue, render: (item) => cellText(ageOf(item.creationTimestamp), true) },
    ];
  } else {
    columns = [
      { key: 'name', label: 'Name', style: { flex: 2.4 }, sortValue: nameValue, render: (item) => nameCell(item.name, colors.success) },
      ...(type.namespaced
        ? [{ key: 'ns', label: 'Namespace', style: { flex: 1.4 }, sortValue: (item: KubeListItem) => (item.namespace ?? '').toLowerCase(), render: (item: KubeListItem) => cellText(item.namespace ?? '', true) } as Column]
        : []),
      { key: 'age', label: 'Age', style: { width: 64 }, align: 'right', sortValue: ageValue, render: (item) => cellText(ageOf(item.creationTimestamp), true) },
    ];
  }

  const toggleSort = (key: string) =>
    setSort((current) =>
      current?.key === key
        ? { key, dir: current.dir === 'asc' ? 'desc' : 'asc' }
        : { key, dir: 'asc' }
    );

  const sortedItems = (() => {
    const col = sort && columns.find((c) => c.key === sort.key);
    if (!sort || !col?.sortValue) return visibleItems;
    const sortValue = col.sortValue;
    const dir = sort.dir === 'asc' ? 1 : -1;
    return [...visibleItems].sort((a, b) => {
      const va = sortValue(a);
      const vb = sortValue(b);
      if (va < vb) return -dir;
      if (va > vb) return dir;
      return 0;
    });
  })();

  const tableHeader = (
    <View style={styles.tableHeader}>
      {columns.map((col) => {
        const active = sort?.key === col.key;
        return (
          <TouchableOpacity
            key={col.key}
            style={[col.style, styles.thCell, col.align === 'right' && styles.cellRightAlign]}
            disabled={!col.sortValue}
            onPress={() => toggleSort(col.key)}
          >
            <Text style={[styles.thText, active && styles.thTextActive]} numberOfLines={1}>
              {col.label}
              {active ? (sort?.dir === 'asc' ? ' ↑' : ' ↓') : ''}
            </Text>
          </TouchableOpacity>
        );
      })}
    </View>
  );

  const renderTableRow = ({ item, index }: { item: KubeListItem; index: number }) => {
    const root = detail.stack[0];
    const isSelected =
      root?.kind === 'item' &&
      root.type.plural === type.plural &&
      root.name === item.name &&
      (root.namespace ?? '') === (item.namespace ?? '');
    return (
      <TouchableOpacity
        style={[
          styles.tableRow,
          index % 2 === 1 && styles.tableRowAlt,
          isSelected && styles.tableRowSelected,
        ]}
        onPress={() => handlePress(item)}
      >
        {columns.map((col) => (
          <View key={col.key} style={[col.style, styles.cell, col.align === 'right' && styles.cellRightAlign]}>
            {col.render(item)}
          </View>
        ))}
      </TouchableOpacity>
    );
  };

  const tableView = (
    <FlatList
      data={sortedItems}
      keyExtractor={(item) => `${item.namespace ?? ''}/${item.name}`}
      style={styles.table}
      stickyHeaderIndices={[0]}
      ListHeaderComponent={tableHeader}
      ListEmptyComponent={<EmptyState message={`No ${type.plural} found.`} />}
      ListFooterComponent={
        continueToken ? (
          <View style={{ padding: spacing.md }}>
            <Button
              title="Load more"
              variant="secondary"
              onPress={() => void load(false, continueToken)}
            />
          </View>
        ) : null
      }
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
      renderItem={renderTableRow}
    />
  );

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
        {!nav.embedded ? <BackButton onPress={() => nav.back()} /> : null}
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

      {denied ? (
        <EmptyState
          message={`You don't have permission to list ${type.kind}s${
            type.namespaced && namespace !== ''
              ? ` in ${namespace}`
              : type.namespaced
                ? ' across all namespaces'
                : ''
          }.${type.namespaced ? ' Try switching namespace above.' : ''}`}
        />
      ) : error ? (
        <View style={{ padding: spacing.lg }}>
          <ErrorBox message={error} />
          <Button title="Retry" variant="secondary" onPress={() => void load(true)} />
        </View>
      ) : loading ? (
        <Loading />
      ) : isWide ? (
        tableView
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
  table: { flex: 1 },
  tableHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: spacing.lg,
    paddingVertical: 9,
    backgroundColor: colors.background,
    borderBottomColor: colors.border,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  thCell: { justifyContent: 'center' },
  thText: {
    color: colors.textFaint,
    fontSize: 11,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.4,
  },
  thTextActive: { color: colors.link },
  tableRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: spacing.lg,
    paddingVertical: 9,
    borderBottomColor: colors.borderFaint,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  tableRowAlt: { backgroundColor: 'rgba(255,255,255,0.022)' },
  tableRowSelected: { backgroundColor: 'rgba(91,124,255,0.1)' },
  cell: { justifyContent: 'center' },
  cellRightAlign: { alignItems: 'flex-end' },
  nameCell: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  cellName: { color: colors.text, fontSize: 13, fontWeight: '600', flexShrink: 1 },
  cellText: { color: colors.textMid, fontSize: 12.5 },
  cellMuted: { color: colors.textDim },
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
