import React, { useEffect, useMemo, useState } from 'react';
import {
  ScrollView,
  StyleSheet,
  TouchableOpacity,
  View,
} from 'react-native';
import { Text, TextInput } from '../Text';
import { listResources } from '../../kube/client';
import { useClusters } from '../../state/ClustersContext';
import { useClusterNav } from '../../state/ClusterNav';
import { ApiResourceType } from '../../types';
import { BackButton, Card, SquircleIcon } from '../kit';
import { EmptyState } from '../components';
import { categoryColors, colors, radius, spacing } from '../theme';

/** Kinds covered by global search, mirroring the design's search index. */
const SEARCH_TYPES: Array<ApiResourceType & { abbr: string; color: string }> = [
  { group: '', version: 'v1', plural: 'pods', kind: 'Pod', namespaced: true, verbs: [], abbr: 'Po', color: categoryColors.workloads },
  { group: 'apps', version: 'v1', plural: 'deployments', kind: 'Deployment', namespaced: true, verbs: [], abbr: 'De', color: categoryColors.workloads },
  { group: '', version: 'v1', plural: 'services', kind: 'Service', namespaced: true, verbs: [], abbr: 'Sv', color: categoryColors.network },
  { group: '', version: 'v1', plural: 'configmaps', kind: 'ConfigMap', namespaced: true, verbs: [], abbr: 'Cm', color: categoryColors.config },
  { group: '', version: 'v1', plural: 'secrets', kind: 'Secret', namespaced: true, verbs: [], abbr: 'Se', color: categoryColors.config },
  { group: '', version: 'v1', plural: 'nodes', kind: 'Node', namespaced: false, verbs: [], abbr: 'No', color: categoryColors.cluster },
];

interface IndexEntry {
  abbr: string;
  color: string;
  name: string;
  sub: string;
  type: ApiResourceType;
  namespace?: string;
}

/**
 * Search content view. Driven by props (clusterId) so it works both as a
 * pushed route (phone) and as keep-alive content in the wide split layout.
 * Navigation goes through ClusterNav.
 */
export function SearchContent({ clusterId }: { clusterId: string }) {
  const { getById } = useClusters();
  const cluster = getById(clusterId);
  const nav = useClusterNav();

  const [query, setQuery] = useState('');
  const [index, setIndex] = useState<IndexEntry[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!cluster) return;
    let cancelled = false;
    (async () => {
      const settled = await Promise.allSettled(
        SEARCH_TYPES.map((type) => listResources(cluster, type, { limit: 300 }))
      );
      if (cancelled) return;
      const entries: IndexEntry[] = [];
      settled.forEach((result, i) => {
        if (result.status !== 'fulfilled') return;
        const type = SEARCH_TYPES[i];
        for (const item of result.value.items) {
          entries.push({
            abbr: type.abbr,
            color: type.color,
            name: item.name,
            sub: `${type.kind}${item.namespace ? ` · ${item.namespace}` : ''}`,
            type,
            namespace: item.namespace,
          });
        }
      });
      setIndex(entries);
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [cluster]);

  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    return index
      .filter((entry) => `${entry.name} ${entry.sub}`.toLowerCase().includes(q))
      .slice(0, 30);
  }, [index, query]);

  if (!cluster) return <EmptyState message="Cluster not found." />;

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        {!nav.embedded ? <BackButton onPress={() => nav.back()} /> : null}
        <TextInput
          style={styles.input}
          value={query}
          onChangeText={setQuery}
          autoFocus
          placeholder="Search anything in the cluster"
          placeholderTextColor={colors.textFaint}
          autoCapitalize="none"
          autoCorrect={false}
        />
      </View>

      {query.trim() === '' ? (
        <View style={styles.hintWrap}>
          <Text style={styles.hintTitle}>
            {loading ? 'Indexing cluster…' : `${index.length} objects indexed`}
          </Text>
          <Text style={styles.hintSub}>
            Pods, Deployments, Services, ConfigMaps, Secrets and Nodes are searched by name.
          </Text>
        </View>
      ) : (
        <>
          <Text style={styles.meta}>
            {results.length} {results.length === 1 ? 'result' : 'results'}
          </Text>
          <ScrollView style={{ flex: 1 }} contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
            {results.length === 0 ? (
              <EmptyState message="No matches." />
            ) : (
              <Card style={{ padding: 0, overflow: 'hidden', borderRadius: radius.cardLg }}>
                {results.map((entry, index2) => (
                  <TouchableOpacity
                    key={`${entry.sub}/${entry.name}`}
                    style={[
                      styles.row,
                      index2 > 0 && {
                        borderTopColor: colors.borderFaint,
                        borderTopWidth: StyleSheet.hairlineWidth,
                      },
                    ]}
                    onPress={() =>
                      nav.openItem(entry.type, entry.name, entry.namespace)
                    }
                  >
                    <SquircleIcon abbr={entry.abbr} color={entry.color} />
                    <View style={{ flex: 1, gap: 1 }}>
                      <Text style={styles.rowName} numberOfLines={1}>
                        {entry.name}
                      </Text>
                      <Text style={styles.rowSub}>{entry.sub}</Text>
                    </View>
                    <Text style={styles.chevron}>›</Text>
                  </TouchableOpacity>
                ))}
              </Card>
            )}
          </ScrollView>
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  header: {
    paddingTop: 60,
    paddingHorizontal: spacing.lg,
    paddingBottom: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  input: {
    flex: 1,
    backgroundColor: 'rgba(255,255,255,0.07)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.12)',
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingVertical: 11,
    color: colors.text,
    fontSize: 15,
  },
  hintWrap: { paddingHorizontal: 18, gap: 6 },
  hintTitle: { color: colors.textDim, fontSize: 12, fontWeight: '600' },
  hintSub: { color: colors.textFaint, fontSize: 12, lineHeight: 17 },
  meta: { color: colors.textFaint, fontSize: 11.5, paddingHorizontal: 18, paddingBottom: 8 },
  scroll: { paddingHorizontal: spacing.lg, paddingBottom: 60 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 15,
    paddingVertical: 12,
  },
  rowName: { color: colors.text, fontSize: 13.5, fontWeight: '600' },
  rowSub: { color: 'rgba(242,245,250,0.4)', fontSize: 11 },
  chevron: { color: 'rgba(242,245,250,0.22)', fontSize: 18, fontWeight: '600' },
});
