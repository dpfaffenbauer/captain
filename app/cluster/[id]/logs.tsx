import { Stack, useLocalSearchParams } from 'expo-router';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { getPodLogs } from '../../../src/kube/client';
import { useClusters } from '../../../src/state/ClustersContext';
import { Button, EmptyState, ErrorBox, Loading } from '../../../src/ui/components';
import { colors, spacing } from '../../../src/ui/theme';

export default function PodLogsScreen() {
  const params = useLocalSearchParams<{
    id: string;
    namespace: string;
    name: string;
    containers: string;
  }>();
  const { getById } = useClusters();
  const cluster = getById(params.id);

  const containers = useMemo(
    () => (params.containers ?? '').split(',').filter(Boolean),
    [params.containers]
  );
  const [container, setContainer] = useState<string | undefined>(containers[0]);
  const [previous, setPrevious] = useState(false);
  const [logs, setLogs] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    if (!cluster || !params.namespace || !params.name) return;
    setLoading(true);
    setError('');
    try {
      const text = await getPodLogs(cluster, params.namespace, params.name, {
        container,
        tailLines: 500,
        previous,
      });
      setLogs(text);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setLoading(false);
    }
  }, [cluster, params.namespace, params.name, container, previous]);

  useEffect(() => {
    void load();
  }, [load]);

  if (!cluster) return <EmptyState message="Cluster nicht gefunden." />;

  return (
    <View style={styles.container}>
      <Stack.Screen options={{ title: `Logs · ${params.name}` }} />
      {containers.length > 1 && (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.chips}>
          {containers.map((name) => (
            <TouchableOpacity
              key={name}
              style={[styles.chip, container === name && styles.chipActive]}
              onPress={() => setContainer(name)}
            >
              <Text style={[styles.chipText, container === name && styles.chipTextActive]}>
                {name}
              </Text>
            </TouchableOpacity>
          ))}
        </ScrollView>
      )}
      {error ? (
        <View style={styles.errorWrap}>
          <ErrorBox message={error} />
        </View>
      ) : loading ? (
        <Loading />
      ) : (
        <ScrollView style={styles.logWrap} contentContainerStyle={styles.logContent}>
          <Text style={styles.logText} selectable>
            {logs || '(keine Log-Ausgabe)'}
          </Text>
        </ScrollView>
      )}
      <View style={styles.actions}>
        <View style={styles.actionItem}>
          <Button title="Aktualisieren" variant="secondary" onPress={() => void load()} />
        </View>
        <View style={styles.actionItem}>
          <Button
            title={previous ? 'Aktuelle Logs' : 'Vorherige Logs'}
            variant="secondary"
            onPress={() => setPrevious(!previous)}
          />
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  chips: { flexGrow: 0, paddingHorizontal: spacing.md, paddingTop: spacing.md },
  chip: {
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: 14,
    backgroundColor: colors.surface,
    paddingHorizontal: spacing.md,
    paddingVertical: 5,
    marginRight: spacing.sm,
  },
  chipActive: { backgroundColor: colors.accent, borderColor: colors.accent },
  chipText: { color: colors.textDim, fontSize: 13 },
  chipTextActive: { color: colors.accentText, fontWeight: '600' },
  errorWrap: { padding: spacing.lg },
  logWrap: { flex: 1, margin: spacing.md, backgroundColor: '#0a0d12', borderRadius: 8 },
  logContent: { padding: spacing.md },
  logText: { color: colors.mono, fontFamily: 'Menlo', fontSize: 11, lineHeight: 16 },
  actions: { flexDirection: 'row', gap: spacing.sm, paddingHorizontal: spacing.lg, paddingBottom: spacing.lg },
  actionItem: { flex: 1 },
});
