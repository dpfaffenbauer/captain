import React, { useCallback, useEffect, useState } from 'react';
import {
  RefreshControl,
  ScrollView,
  StyleSheet,
  View,
} from 'react-native';
import { Text } from '../Text';
import { ClusterEvent, listClusterEvents } from '../../kube/client';
import { useClusterScope } from '../../state/ClusterScope';
import { useClusters } from '../../state/ClustersContext';
import { Card, Pill, StatusDot } from '../kit';
import { ClusterSwitcherButton } from '../sheets';
import { EmptyState, ErrorBox, Loading } from '../components';
import { useResponsiveLayout } from '../useResponsiveLayout';
import { colors, spacing } from '../theme';
import { ageOf } from '../../util/format';

const FILTERS = ['All', 'Warning', 'Normal'] as const;
type Filter = (typeof FILTERS)[number];

export function EventsContent({ clusterId }: { clusterId: string }) {
  const { getById } = useClusters();
  const cluster = getById(clusterId);
  const { namespace } = useClusterScope();
  const { isWide } = useResponsiveLayout();

  const [events, setEvents] = useState<ClusterEvent[] | null>(null);
  const [filter, setFilter] = useState<Filter>('All');
  const [error, setError] = useState('');
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    if (!cluster) return;
    setError('');
    try {
      setEvents(await listClusterEvents(cluster, namespace || undefined));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setRefreshing(false);
    }
  }, [cluster, namespace]);

  useEffect(() => {
    void load();
    const timer = setInterval(() => void load(), 15000);
    return () => clearInterval(timer);
  }, [load]);

  if (!cluster) return <EmptyState message="Cluster not found." />;

  const visible = (events ?? []).filter((event) => filter === 'All' || event.type === filter);

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        {/* The sidebar owns cluster switching on iPad/wide. */}
        {!isWide ? <ClusterSwitcherButton cluster={cluster} online={!error} /> : null}
        <View style={styles.titleRow}>
          <Text style={styles.title}>Events</Text>
          <Pill
            label="Live"
            icon={<StatusDot color={colors.success} size={7} />}
          />
        </View>
        <View style={styles.chips}>
          {FILTERS.map((entry) => (
            <Pill
              key={entry}
              label={entry}
              active={filter === entry}
              onPress={() => setFilter(entry)}
            />
          ))}
        </View>
      </View>

      {error ? (
        <View style={{ padding: spacing.lg }}>
          <ErrorBox message={error} />
        </View>
      ) : events === null ? (
        <Loading />
      ) : (
        <ScrollView
          style={{ flex: 1 }}
          contentContainerStyle={[styles.scroll, isWide && styles.scrollWide]}
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
            <EmptyState message="No events." />
          ) : (
            <Card style={{ padding: 0, paddingHorizontal: 15 }}>
              {visible.map((event, index) => (
                <View
                  key={index}
                  style={[
                    styles.row,
                    index > 0 && {
                      borderTopColor: colors.borderFaint,
                      borderTopWidth: StyleSheet.hairlineWidth,
                    },
                  ]}
                >
                  <View style={{ marginTop: 4 }}>
                    <StatusDot
                      color={event.type === 'Warning' ? colors.warning : colors.success}
                      size={8}
                    />
                  </View>
                  <View style={{ flex: 1, gap: 3 }}>
                    <View style={styles.head}>
                      <Text style={styles.reason}>{event.reason}</Text>
                      <Text style={styles.age}>
                        {ageOf(event.lastTimestamp)}
                        {event.count && event.count > 1 ? ` · x${event.count}` : ''}
                      </Text>
                    </View>
                    <Text style={styles.object} numberOfLines={1}>
                      {event.object}
                      {event.namespace ? ` · ${event.namespace}` : ''}
                    </Text>
                    <Text style={styles.message}>{event.message}</Text>
                  </View>
                </View>
              ))}
            </Card>
          )}
        </ScrollView>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  header: { paddingTop: 62, paddingHorizontal: spacing.lg, gap: 12 },
  titleRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  title: { color: colors.text, fontSize: 30, fontWeight: '800', letterSpacing: -0.6 },
  chips: { flexDirection: 'row', gap: 7, paddingBottom: 10 },
  scroll: { paddingHorizontal: spacing.lg, paddingBottom: 130 },
  scrollWide: { paddingBottom: 28 },
  row: { flexDirection: 'row', gap: 11, paddingVertical: 13, alignItems: 'flex-start' },
  head: { flexDirection: 'row', justifyContent: 'space-between', gap: 8 },
  reason: { color: colors.text, fontSize: 13.5, fontWeight: '600' },
  age: { color: colors.textFaint, fontSize: 11 },
  object: { color: colors.link, fontSize: 11.5, fontWeight: '600' },
  message: { color: 'rgba(242,245,250,0.5)', fontSize: 12, lineHeight: 17 },
});
