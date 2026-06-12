import { useLocalSearchParams, useRouter } from 'expo-router';
import React, { useSyncExternalStore } from 'react';
import { ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import {
  getForwards,
  stopPortForward,
  subscribeForwards,
} from '../../../src/kube/portforward';
import { useClusters } from '../../../src/state/ClustersContext';
import { BackButton, Card, StatusDot } from '../../../src/ui/kit';
import { EmptyState } from '../../../src/ui/components';
import { colors, radius, spacing } from '../../../src/ui/theme';
import { ageOf } from '../../../src/util/format';
import { hapticTap } from '../../../src/util/haptics';

export default function PortForwardsScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const { getById } = useClusters();
  const cluster = getById(id);
  const forwards = useSyncExternalStore(subscribeForwards, getForwards).filter(
    (forward) => forward.clusterId === id
  );

  if (!cluster) return <EmptyState message="Cluster not found." />;

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <BackButton onPress={() => router.back()} />
        <Text style={styles.title}>Port Forwards</Text>
        <View style={{ flex: 1 }} />
      </View>

      <ScrollView style={{ flex: 1 }} contentContainerStyle={styles.scroll}>
        {forwards.length === 0 ? (
          <EmptyState message="No active port forwards. Start one from a pod's detail screen." />
        ) : (
          forwards.map((forward) => (
            <Card key={forward.id} style={styles.row}>
              <StatusDot color={colors.link} />
              <View style={{ flex: 1, gap: 3 }}>
                <Text style={styles.name} numberOfLines={1}>
                  {forward.pod} :{forward.remotePort} → localhost:{forward.localPort}
                </Text>
                <Text style={styles.sub}>
                  {forward.namespace} · active · started{' '}
                  {ageOf(new Date(forward.startedAt).toISOString())} ago
                </Text>
              </View>
              <TouchableOpacity
                style={styles.stopButton}
                onPress={() => {
                  hapticTap();
                  stopPortForward(forward.id);
                }}
              >
                <Text style={styles.stopText}>Stop</Text>
              </TouchableOpacity>
            </Card>
          ))
        )}
      </ScrollView>
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
  scroll: { padding: spacing.lg, paddingBottom: 60, gap: 9, flexGrow: 1 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14 },
  name: { color: colors.text, fontSize: 13, fontWeight: '600', fontFamily: 'Menlo' },
  sub: { color: colors.textDim, fontSize: 11.5 },
  stopButton: {
    backgroundColor: 'rgba(251,113,133,0.12)',
    borderWidth: 1,
    borderColor: 'rgba(251,113,133,0.25)',
    borderRadius: radius.pill,
    paddingHorizontal: 13,
    paddingVertical: 6,
  },
  stopText: { color: colors.dangerLight, fontSize: 12, fontWeight: '600' },
});
