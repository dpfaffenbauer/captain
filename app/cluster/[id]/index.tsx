import { useRouter } from 'expo-router';
import { useLocalSearchParams } from 'expo-router';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Alert,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import {
  ClusterEvent,
  getServerVersion,
  listClusterEvents,
  listResources,
} from '../../../src/kube/client';
import { parseCpu, parseMemory, formatCores, formatGiB } from '../../../src/kube/quantity';
import { useClusters } from '../../../src/state/ClustersContext';
import { ApiResourceType, ClusterConfig } from '../../../src/types';
import { FloatingTabBar } from '../../../src/ui/FloatingTabBar';
import { Card, HealthRing, StatusDot, UsageBar } from '../../../src/ui/kit';
import { ClusterSwitcherSheet } from '../../../src/ui/sheets';
import { colors, radius, spacing } from '../../../src/ui/theme';
import { EmptyState, ErrorBox, Loading } from '../../../src/ui/components';
import { ageOf } from '../../../src/util/format';

const POD_TYPE: ApiResourceType = { group: '', version: 'v1', plural: 'pods', kind: 'Pod', namespaced: true, verbs: [] };
const NODE_TYPE: ApiResourceType = { group: '', version: 'v1', plural: 'nodes', kind: 'Node', namespaced: false, verbs: [] };

interface Attention {
  key: string;
  title: string;
  detail: string;
  severity: 'crit' | 'warn';
  onPress: () => void;
}

interface DashboardData {
  version: string;
  podsTotal: number;
  podsRunning: number;
  nodesTotal: number;
  nodesReady: number;
  warningCount: number;
  cpuUsedPct?: number;
  memUsedPct?: number;
  cpuLabel?: string;
  memLabel?: string;
  namespacesCount: number;
  attention: Attention[];
  events: ClusterEvent[];
}

function healthLabel(percent: number): string {
  if (percent >= 99) return 'All healthy';
  if (percent >= 90) return 'Mostly healthy';
  if (percent >= 70) return 'Degraded';
  return 'Needs help';
}

async function loadDashboard(
  cluster: ClusterConfig,
  openPod: (namespace: string, name: string) => void
): Promise<DashboardData> {
  const [pods, nodes, events, version] = await Promise.all([
    listResources(cluster, POD_TYPE, { limit: 500 }),
    listResources(cluster, NODE_TYPE, { limit: 100 }),
    listClusterEvents(cluster).catch(() => [] as ClusterEvent[]),
    getServerVersion(cluster).catch(() => ''),
  ]);

  const attention: Attention[] = [];
  let running = 0;
  const namespaces = new Set<string>();
  let cpuRequests = 0;
  let memRequests = 0;

  for (const pod of pods.items) {
    const raw = pod.raw as any;
    if (pod.namespace) namespaces.add(pod.namespace);
    const phase = raw.status?.phase;
    if (phase === 'Running' || phase === 'Succeeded') running += 1;

    for (const container of raw.spec?.containers ?? []) {
      cpuRequests += parseCpu(container.resources?.requests?.cpu);
      memRequests += parseMemory(container.resources?.requests?.memory);
    }

    const statuses: any[] = raw.status?.containerStatuses ?? [];
    const crash = statuses.find((s) => s.state?.waiting?.reason === 'CrashLoopBackOff');
    if (crash) {
      attention.push({
        key: `pod/${pod.namespace}/${pod.name}`,
        title: pod.name,
        detail: `Crash-looping · ${crash.restartCount ?? 0} restarts · ${pod.namespace}`,
        severity: 'crit',
        onPress: () => openPod(pod.namespace ?? '', pod.name),
      });
    } else if (phase === 'Pending' && Date.now() - Date.parse(raw.metadata?.creationTimestamp ?? '') > 120000) {
      attention.push({
        key: `pod/${pod.namespace}/${pod.name}`,
        title: pod.name,
        detail: `Pending since ${ageOf(raw.metadata?.creationTimestamp)} · ${pod.namespace}`,
        severity: 'warn',
        onPress: () => openPod(pod.namespace ?? '', pod.name),
      });
    } else if (phase === 'Failed') {
      attention.push({
        key: `pod/${pod.namespace}/${pod.name}`,
        title: pod.name,
        detail: `Failed · ${pod.namespace}`,
        severity: 'crit',
        onPress: () => openPod(pod.namespace ?? '', pod.name),
      });
    }
  }

  let nodesReady = 0;
  let cpuAllocatable = 0;
  let memAllocatable = 0;
  for (const node of nodes.items) {
    const raw = node.raw as any;
    const conditions: any[] = raw.status?.conditions ?? [];
    const ready = conditions.find((c) => c.type === 'Ready')?.status === 'True';
    if (ready) nodesReady += 1;
    cpuAllocatable += parseCpu(raw.status?.allocatable?.cpu);
    memAllocatable += parseMemory(raw.status?.allocatable?.memory);
    const pressure = conditions.find(
      (c) => c.type.endsWith('Pressure') && c.status === 'True'
    );
    if (!ready || pressure) {
      attention.push({
        key: `node/${node.name}`,
        title: node.name,
        detail: ready ? `${pressure.type}` : 'NotReady',
        severity: ready ? 'warn' : 'crit',
      onPress: () => {},
      });
    }
  }

  const warningCount = events.filter((event) => event.type === 'Warning').length;

  return {
    version,
    podsTotal: pods.items.length,
    podsRunning: running,
    nodesTotal: nodes.items.length,
    nodesReady,
    warningCount,
    namespacesCount: namespaces.size,
    cpuUsedPct: cpuAllocatable > 0 ? (cpuRequests / cpuAllocatable) * 100 : undefined,
    memUsedPct: memAllocatable > 0 ? (memRequests / memAllocatable) * 100 : undefined,
    cpuLabel:
      cpuAllocatable > 0
        ? `${formatCores(cpuRequests)} of ${formatCores(cpuAllocatable)} cores`
        : undefined,
    memLabel:
      memAllocatable > 0
        ? `${formatGiB(memRequests)} of ${formatGiB(memAllocatable)} GiB`
        : undefined,
    attention: attention.slice(0, 6),
    events: events.slice(0, 4),
  };
}

function StatCard({
  abbr,
  abbrBg,
  value,
  total,
  label,
  onPress,
}: {
  abbr: string;
  abbrBg: string;
  value: string;
  total?: string;
  label: string;
  onPress: () => void;
}) {
  return (
    <TouchableOpacity style={{ flex: 1 }} onPress={onPress}>
      <Card style={styles.statCard}>
        <View style={[styles.statIcon, { backgroundColor: abbrBg }]}>
          <Text style={styles.statIconText}>{abbr}</Text>
        </View>
        <Text style={styles.statValue}>
          {value}
          {total ? <Text style={styles.statTotal}>/{total}</Text> : null}
        </Text>
        <Text style={styles.statLabel}>{label}</Text>
      </Card>
    </TouchableOpacity>
  );
}

export default function DashboardScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const { getById, remove } = useClusters();
  const cluster = getById(id);

  const [data, setData] = useState<DashboardData | null>(null);
  const [error, setError] = useState('');
  const [refreshing, setRefreshing] = useState(false);
  const [switcherOpen, setSwitcherOpen] = useState(false);

  const openPod = useCallback(
    (namespace: string, name: string) => {
      router.push({
        pathname: '/cluster/[id]/item',
        params: {
          id,
          group: '',
          version: 'v1',
          plural: 'pods',
          kind: 'Pod',
          namespaced: '1',
          verbs: 'get,list,update,delete',
          name,
          namespace,
        },
      });
    },
    [router, id]
  );

  const load = useCallback(async () => {
    if (!cluster) return;
    setError('');
    try {
      setData(await loadDashboard(cluster, openPod));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setRefreshing(false);
    }
  }, [cluster, openPod]);

  useEffect(() => {
    void load();
  }, [load]);

  const healthPct = useMemo(() => {
    if (!data || data.podsTotal === 0) return 100;
    return Math.round((data.podsRunning / data.podsTotal) * 100);
  }, [data]);

  if (!cluster) return <EmptyState message="Cluster not found." />;

  const initials = cluster.name
    .split(/[\s-_]+/)
    .map((part) => part[0])
    .filter(Boolean)
    .slice(0, 2)
    .join('')
    .toUpperCase();

  const onAvatar = () => {
    Alert.alert(cluster.name, cluster.server, [
      {
        text: 'Cluster bearbeiten',
        onPress: () => router.push({ pathname: '/cluster-form', params: { id: cluster.id } }),
      },
      {
        text: 'Cluster entfernen',
        style: 'destructive',
        onPress: () => {
          void remove(cluster.id).then(() => router.replace('/'));
        },
      },
      { text: 'Abbrechen', style: 'cancel' },
    ]);
  };

  return (
    <View style={styles.container}>
      {/* Header: cluster pill + avatar */}
      <View style={styles.header}>
        <TouchableOpacity style={styles.clusterPill} onPress={() => setSwitcherOpen(true)}>
          <StatusDot color={error ? colors.danger : colors.success} size={8} />
          <Text style={styles.clusterPillText}>{cluster.name}</Text>
          <Text style={styles.clusterPillChevron}>⌄</Text>
        </TouchableOpacity>
        <View style={{ flex: 1 }} />
        <TouchableOpacity style={styles.avatar} onPress={onAvatar}>
          <Text style={styles.avatarText}>{initials}</Text>
        </TouchableOpacity>
      </View>

      {error ? (
        <View style={{ paddingHorizontal: spacing.lg }}>
          <ErrorBox message={error} />
        </View>
      ) : null}

      {!data && !error ? (
        <Loading />
      ) : data ? (
        <ScrollView
          style={{ flex: 1 }}
          contentContainerStyle={styles.scroll}
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
        >
          {/* Health hero */}
          <Card style={styles.hero}>
            <HealthRing percent={healthPct} label={String(healthPct)} />
            <View style={styles.heroText}>
              <Text style={styles.heroTitle}>{healthLabel(healthPct)}</Text>
              <Text style={styles.heroSub}>
                {data.podsRunning} of {data.podsTotal} pods running
                {data.nodesReady < data.nodesTotal
                  ? ` · ${data.nodesTotal - data.nodesReady} node${data.nodesTotal - data.nodesReady > 1 ? 's' : ''} not ready`
                  : ''}
              </Text>
              <Text style={styles.heroMeta}>
                {[data.version, `${data.namespacesCount} namespaces`].filter(Boolean).join(' · ')}
              </Text>
            </View>
          </Card>

          {/* Stat cards */}
          <View style={styles.statRow}>
            <StatCard
              abbr="Po"
              abbrBg="#5B7CFF"
              value={String(data.podsRunning)}
              total={String(data.podsTotal)}
              label="Pods"
              onPress={() =>
                router.push({
                  pathname: '/cluster/[id]/list',
                  params: { id, group: '', version: 'v1', plural: 'pods', kind: 'Pod', namespaced: '1', verbs: 'get,list,update,delete' },
                })
              }
            />
            <StatCard
              abbr="No"
              abbrBg="#F472B6"
              value={String(data.nodesReady)}
              total={String(data.nodesTotal)}
              label="Nodes"
              onPress={() =>
                router.push({
                  pathname: '/cluster/[id]/list',
                  params: { id, group: '', version: 'v1', plural: 'nodes', kind: 'Node', namespaced: '0', verbs: 'get,list' },
                })
              }
            />
            <StatCard
              abbr="!"
              abbrBg="#FB7185"
              value={String(data.warningCount)}
              label="Warnings"
              onPress={() => router.replace(`/cluster/${id}/events` as never)}
            />
          </View>

          {/* Capacity */}
          {data.cpuLabel || data.memLabel ? (
            <Card style={{ gap: 13 }}>
              <Text style={styles.sectionInCard}>Cluster capacity</Text>
              {data.cpuLabel ? (
                <View style={{ gap: 6 }}>
                  <View style={styles.capRow}>
                    <Text style={styles.capLabel}>CPU requests</Text>
                    <Text style={styles.capValue}>{data.cpuLabel}</Text>
                  </View>
                  <UsageBar percent={data.cpuUsedPct ?? 0} color={colors.accent} />
                </View>
              ) : null}
              {data.memLabel ? (
                <View style={{ gap: 6 }}>
                  <View style={styles.capRow}>
                    <Text style={styles.capLabel}>Memory requests</Text>
                    <Text style={styles.capValue}>{data.memLabel}</Text>
                  </View>
                  <UsageBar percent={data.memUsedPct ?? 0} color={colors.warning} />
                </View>
              ) : null}
            </Card>
          ) : null}

          {/* Needs attention */}
          {data.attention.length > 0 ? (
            <>
              <View style={styles.sectionRow}>
                <Text style={styles.sectionTitle}>Needs attention</Text>
                <View style={styles.badge}>
                  <Text style={styles.badgeText}>{data.attention.length}</Text>
                </View>
              </View>
              {data.attention.map((item) => {
                const tone = item.severity === 'crit' ? colors.danger : colors.warning;
                const toneLight = item.severity === 'crit' ? colors.dangerLight : colors.warningLight;
                return (
                  <TouchableOpacity key={item.key} onPress={item.onPress}>
                    <View style={[styles.attention, { borderColor: `${tone}40`, backgroundColor: `${tone}14` }]}>
                      <View style={[styles.attentionIcon, { backgroundColor: `${tone}30` }]}>
                        <StatusDot color={tone} size={10} />
                      </View>
                      <View style={{ flex: 1, gap: 3 }}>
                        <Text style={styles.attentionTitle} numberOfLines={1}>
                          {item.title}
                        </Text>
                        <Text style={[styles.attentionDetail, { color: toneLight }]}>{item.detail}</Text>
                      </View>
                      <Text style={[styles.chevron, { color: `${tone}80` }]}>›</Text>
                    </View>
                  </TouchableOpacity>
                );
              })}
            </>
          ) : null}

          {/* Recent events */}
          <View style={styles.sectionRow}>
            <Text style={styles.sectionTitle}>Recent events</Text>
            <View style={{ flex: 1 }} />
            <TouchableOpacity onPress={() => router.replace(`/cluster/${id}/events` as never)}>
              <Text style={styles.viewAll}>View all</Text>
            </TouchableOpacity>
          </View>
          <Card style={{ paddingVertical: 4 }}>
            {data.events.length === 0 ? (
              <Text style={[styles.heroMeta, { paddingVertical: 12 }]}>No recent events</Text>
            ) : (
              data.events.map((event, index) => (
                <View
                  key={index}
                  style={[styles.eventRow, index > 0 && { borderTopColor: colors.borderFaint, borderTopWidth: StyleSheet.hairlineWidth }]}
                >
                  <View style={{ marginTop: 4 }}>
                    <StatusDot color={event.type === 'Warning' ? colors.warning : colors.success} size={8} />
                  </View>
                  <View style={{ flex: 1, gap: 2 }}>
                    <View style={styles.eventHead}>
                      <Text style={styles.eventReason}>{event.reason}</Text>
                      <Text style={styles.eventAge}>{ageOf(event.lastTimestamp)}</Text>
                    </View>
                    <Text style={styles.eventObject} numberOfLines={1}>
                      {event.object}
                    </Text>
                  </View>
                </View>
              ))
            )}
          </Card>
        </ScrollView>
      ) : null}

      <FloatingTabBar clusterId={id} active="home" />
      <ClusterSwitcherSheet
        visible={switcherOpen}
        onClose={() => setSwitcherOpen(false)}
        activeCluster={cluster}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  header: {
    paddingTop: 62,
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.md,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  clusterPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.pill,
    paddingVertical: 8,
    paddingLeft: 12,
    paddingRight: 14,
  },
  clusterPillText: { color: colors.text, fontSize: 13.5, fontWeight: '600' },
  clusterPillChevron: { color: colors.textDim, fontSize: 12, marginTop: -4 },
  avatar: {
    width: 36,
    height: 36,
    borderRadius: radius.pill,
    backgroundColor: colors.accent,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: { color: '#fff', fontSize: 12.5, fontWeight: '700' },
  scroll: { paddingHorizontal: spacing.lg, paddingBottom: 130, gap: 12 },
  hero: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 18,
    borderRadius: radius.hero,
    padding: 18,
  },
  heroText: { flex: 1, gap: 4 },
  heroTitle: { color: colors.text, fontSize: 17, fontWeight: '700' },
  heroSub: { color: 'rgba(242,245,250,0.55)', fontSize: 12.5, lineHeight: 18 },
  heroMeta: { color: colors.textFaint, fontSize: 11, paddingTop: 2 },
  statRow: { flexDirection: 'row', gap: 10 },
  statCard: { gap: 7, padding: 13, borderRadius: radius.card },
  statIcon: {
    width: 26,
    height: 26,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  statIconText: { color: '#fff', fontSize: 10, fontWeight: '800' },
  statValue: { color: colors.text, fontSize: 19, fontWeight: '800' },
  statTotal: { color: colors.textFaint, fontSize: 13, fontWeight: '600' },
  statLabel: { color: 'rgba(242,245,250,0.5)', fontSize: 11 },
  sectionInCard: { color: colors.text, fontSize: 13.5, fontWeight: '700' },
  capRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline' },
  capLabel: { color: 'rgba(242,245,250,0.55)', fontSize: 12 },
  capValue: { color: colors.text, fontSize: 12, fontWeight: '600' },
  sectionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 4,
    paddingTop: 6,
  },
  sectionTitle: { color: colors.text, fontSize: 15, fontWeight: '700' },
  badge: {
    backgroundColor: 'rgba(251,113,133,0.18)',
    borderRadius: radius.pill,
    paddingHorizontal: 9,
    paddingVertical: 2,
  },
  badgeText: { color: colors.dangerLight, fontSize: 11, fontWeight: '700' },
  viewAll: { color: colors.link, fontSize: 12.5, fontWeight: '600' },
  attention: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 13,
    borderWidth: 1,
    borderRadius: radius.card + 2,
    padding: 14,
  },
  attentionIcon: {
    width: 38,
    height: 38,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  attentionTitle: { color: colors.text, fontSize: 13.5, fontWeight: '600' },
  attentionDetail: { fontSize: 12 },
  chevron: { fontSize: 22, fontWeight: '600' },
  eventRow: { flexDirection: 'row', gap: 11, paddingVertical: 12, alignItems: 'flex-start' },
  eventHead: { flexDirection: 'row', justifyContent: 'space-between', gap: 8 },
  eventReason: { color: colors.text, fontSize: 13, fontWeight: '600' },
  eventAge: { color: colors.textFaint, fontSize: 11 },
  eventObject: { color: 'rgba(242,245,250,0.45)', fontSize: 11.5 },
});
