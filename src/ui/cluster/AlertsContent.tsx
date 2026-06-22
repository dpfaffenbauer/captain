import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import {
  getFiringAlerts,
  PromAlert,
  resolvePrometheus,
} from '../../kube/prometheus';
import { useClusters } from '../../state/ClustersContext';
import { useClusterNav } from '../../state/ClusterNav';
import { ApiResourceType, ClusterConfig } from '../../types';
import { BackButton, Pill, StatusDot } from '../kit';
import { AlertSheet } from '../sheets';
import { EmptyState, ErrorBox, Loading } from '../components';
import { colors, radius, spacing } from '../theme';

type Bucket = 'all' | 'critical' | 'warning' | 'info';

function bucketOf(severity: string): Exclude<Bucket, 'all'> {
  if (severity === 'critical' || severity === 'error') return 'critical';
  if (severity === 'warning') return 'warning';
  return 'info';
}

const BUCKET_COLOR: Record<Exclude<Bucket, 'all'>, string> = {
  critical: colors.danger,
  warning: colors.warning,
  info: colors.link,
};

async function loadAlerts(
  cluster: ClusterConfig
): Promise<{ detected: true; alerts: PromAlert[] } | { detected: false }> {
  const cfg = await resolvePrometheus(cluster);
  if (!cfg) return { detected: false };
  const alerts = await getFiringAlerts(cluster, cfg);
  return { detected: true, alerts };
}

const POD_TYPE: ApiResourceType = {
  group: '',
  version: 'v1',
  plural: 'pods',
  kind: 'Pod',
  namespaced: true,
  verbs: ['get', 'list', 'update', 'delete'],
};

export function AlertsContent({ clusterId }: { clusterId: string }) {
  const { getById } = useClusters();
  const cluster = getById(clusterId);
  const nav = useClusterNav();

  const [alerts, setAlerts] = useState<PromAlert[] | null>(null);
  const [detected, setDetected] = useState(true);
  const [error, setError] = useState('');
  const [refreshing, setRefreshing] = useState(false);
  const [filter, setFilter] = useState<Bucket>('all');
  const [selected, setSelected] = useState<PromAlert | null>(null);

  const openPod = useCallback(
    (namespace: string, name: string) => {
      nav.openItem(POD_TYPE, name, namespace);
    },
    [nav]
  );

  const load = useCallback(async () => {
    if (!cluster) return;
    setError('');
    try {
      const result = await loadAlerts(cluster);
      setDetected(result.detected);
      setAlerts(result.detected ? result.alerts : []);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setRefreshing(false);
    }
  }, [cluster]);

  useEffect(() => {
    void load();
  }, [load]);

  const counts = useMemo(() => {
    const acc = { critical: 0, warning: 0, info: 0 };
    for (const alert of alerts ?? []) acc[bucketOf(alert.severity)] += 1;
    return acc;
  }, [alerts]);

  const visible = useMemo(
    () =>
      (alerts ?? []).filter(
        (a: PromAlert) => filter === 'all' || bucketOf(a.severity) === filter
      ),
    [alerts, filter]
  );

  if (!cluster) return <EmptyState message="Cluster not found." />;

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        {!nav.embedded ? <BackButton onPress={() => nav.back()} /> : null}
        <Text style={styles.title}>Firing Alerts</Text>
        <View style={{ flex: 1 }} />
        {alerts ? <Text style={styles.total}>{alerts.length}</Text> : null}
      </View>

      {error ? (
        <View style={{ paddingHorizontal: spacing.lg }}>
          <ErrorBox message={error} onRetry={() => void load()} />
        </View>
      ) : null}

      {alerts && detected && alerts.length > 0 ? (
        <View style={styles.filterRow}>
          <Pill label={`All ${alerts.length}`} active={filter === 'all'} onPress={() => setFilter('all')} />
          {counts.critical > 0 ? (
            <Pill
              label={`Critical ${counts.critical}`}
              active={filter === 'critical'}
              onPress={() => setFilter('critical')}
            />
          ) : null}
          {counts.warning > 0 ? (
            <Pill
              label={`Warning ${counts.warning}`}
              active={filter === 'warning'}
              onPress={() => setFilter('warning')}
            />
          ) : null}
          {counts.info > 0 ? (
            <Pill label={`Info ${counts.info}`} active={filter === 'info'} onPress={() => setFilter('info')} />
          ) : null}
        </View>
      ) : null}

      {!alerts && !error ? (
        <Loading />
      ) : !detected ? (
        <EmptyState message="Prometheus was not detected in this cluster. Alerts appear once a Prometheus service is reachable." />
      ) : (
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
          {visible.length === 0 ? (
            <EmptyState message="No firing alerts. All clear." />
          ) : (
            visible.map((alert: PromAlert, index: number) => {
              const tone = BUCKET_COLOR[bucketOf(alert.severity)];
              const detail =
                alert.summary ||
                [alert.namespace, alert.pod].filter(Boolean).join('/') ||
                alert.severity;
              return (
                <TouchableOpacity key={`${alert.name}-${index}`} onPress={() => setSelected(alert)}>
                  <View style={[styles.row, { borderColor: `${tone}40`, backgroundColor: `${tone}14` }]}>
                    <View style={[styles.icon, { backgroundColor: `${tone}30` }]}>
                      <StatusDot color={tone} size={10} />
                    </View>
                    <View style={{ flex: 1, gap: 3 }}>
                      <Text style={styles.name} numberOfLines={1}>
                        {alert.name}
                      </Text>
                      <Text style={styles.detail} numberOfLines={2}>
                        {detail}
                      </Text>
                    </View>
                    <Text style={[styles.chevron, { color: `${tone}80` }]}>›</Text>
                  </View>
                </TouchableOpacity>
              );
            })
          )}
        </ScrollView>
      )}

      <AlertSheet
        visible={selected !== null}
        onClose={() => setSelected(null)}
        alert={selected}
        onOpenPod={openPod}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  header: {
    paddingTop: 60,
    paddingHorizontal: spacing.lg,
    paddingBottom: 10,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  title: { color: colors.text, fontSize: 24, fontWeight: '800', letterSpacing: -0.5 },
  total: { color: colors.textDim, fontSize: 15, fontWeight: '700' },
  filterRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    paddingHorizontal: spacing.lg,
    paddingBottom: 10,
  },
  scroll: { padding: spacing.lg, paddingBottom: 60, gap: 9, flexGrow: 1 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    borderWidth: 1,
    borderRadius: radius.card,
    padding: 13,
  },
  icon: {
    width: 30,
    height: 30,
    borderRadius: 9,
    alignItems: 'center',
    justifyContent: 'center',
  },
  name: { color: colors.text, fontSize: 14, fontWeight: '600' },
  detail: { color: colors.textMid, fontSize: 12 },
  chevron: { fontSize: 20, fontWeight: '700' },
});
