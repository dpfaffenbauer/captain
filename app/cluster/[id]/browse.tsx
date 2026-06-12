import { useLocalSearchParams, useRouter } from 'expo-router';
import React, { useCallback, useEffect, useState, useSyncExternalStore } from 'react';
import {
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import {
  abbreviationFor,
  categorizeResourceTypes,
  ResourceCategory,
} from '../../../src/kube/categories';
import { discoverResourceTypes } from '../../../src/kube/client';
import { getForwards, subscribeForwards } from '../../../src/kube/portforward';
import { namespaceLabel, useClusterScope } from '../../../src/state/ClusterScope';
import { useClusters } from '../../../src/state/ClustersContext';
import { ApiResourceType } from '../../../src/types';
import { Card, Pill, SquircleIcon } from '../../../src/ui/kit';
import { NamespaceSheet } from '../../../src/ui/sheets';
import { Button, EmptyState, ErrorBox, Loading } from '../../../src/ui/components';
import { colors, radius, spacing } from '../../../src/ui/theme';

export default function BrowseScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const { getById } = useClusters();
  const cluster = getById(id);
  const { namespace } = useClusterScope();

  const [categories, setCategories] = useState<ResourceCategory[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [nsOpen, setNsOpen] = useState(false);
  const forwardsCount = useSyncExternalStore(subscribeForwards, getForwards).filter(
    (forward) => forward.clusterId === id
  ).length;

  const load = useCallback(async () => {
    if (!cluster) return;
    setError('');
    try {
      const types = await discoverResourceTypes(cluster);
      setCategories(categorizeResourceTypes(types.filter((type) => type.verbs.includes('list'))));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setLoading(false);
    }
  }, [cluster]);

  useEffect(() => {
    void load();
  }, [load]);

  const openType = (type: ApiResourceType) => {
    router.push({
      pathname: '/cluster/[id]/list',
      params: {
        id,
        group: type.group,
        version: type.version,
        plural: type.plural,
        kind: type.kind,
        namespaced: type.namespaced ? '1' : '0',
        verbs: type.verbs.join(','),
      },
    });
  };

  if (!cluster) return <EmptyState message="Cluster not found." />;

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <View style={styles.titleRow}>
          <Text style={styles.title}>Browse</Text>
          <Pill label={`${namespaceLabel(namespace)} ▾`} onPress={() => setNsOpen(true)} />
        </View>
        <TouchableOpacity
          style={styles.search}
          onPress={() => router.push({ pathname: '/cluster/[id]/search', params: { id } })}
        >
          <Text style={styles.searchIcon}>⌕</Text>
          <Text style={styles.searchText}>Search anything in the cluster</Text>
        </TouchableOpacity>
      </View>

      {error ? (
        <View style={{ padding: spacing.lg }}>
          <ErrorBox message={error} />
          <Button title="Retry" variant="secondary" onPress={() => void load()} />
        </View>
      ) : loading ? (
        <Loading />
      ) : (
        <ScrollView style={{ flex: 1 }} contentContainerStyle={styles.scroll}>
          <View style={{ gap: 9 }}>
            <View style={styles.catHead}>
              <Text style={styles.catTitle}>Apps</Text>
            </View>
            <Card style={styles.catCard}>
              <TouchableOpacity
                style={styles.row}
                onPress={() => router.push({ pathname: '/cluster/[id]/helm', params: { id } })}
              >
                <SquircleIcon abbr="He" color="#36B3F4" />
                <View style={{ flex: 1, gap: 1 }}>
                  <Text style={styles.rowLabel}>Helm Releases</Text>
                  <Text style={styles.rowSub}>Charts, history, values, manifests</Text>
                </View>
                <Text style={styles.chevron}>›</Text>
              </TouchableOpacity>
            </Card>
          </View>

          {categories.map((category) => (
            <View key={category.key} style={{ gap: 9 }}>
              <View style={styles.catHead}>
                <Text style={styles.catTitle}>{category.title}</Text>
                <Text style={styles.catMeta}>
                  {category.types.length} {category.types.length === 1 ? 'kind' : 'kinds'}
                </Text>
              </View>
              <Card style={styles.catCard}>
                {category.types.map((type, index) => (
                  <TouchableOpacity
                    key={`${type.group}/${type.version}/${type.plural}`}
                    style={[
                      styles.row,
                      index > 0 && {
                        borderTopColor: colors.borderFaint,
                        borderTopWidth: StyleSheet.hairlineWidth,
                      },
                    ]}
                    onPress={() => openType(type)}
                  >
                    <SquircleIcon abbr={abbreviationFor(type)} color={category.color} />
                    <View style={{ flex: 1, gap: 1 }}>
                      <Text style={styles.rowLabel}>{type.kind}</Text>
                      {category.key === 'custom' || category.key === 'other' ? (
                        <Text style={styles.rowSub}>
                          {type.group || 'core'}/{type.version}
                        </Text>
                      ) : null}
                    </View>
                    {!type.namespaced ? <Text style={styles.scopeTag}>cluster</Text> : null}
                    <Text style={styles.chevron}>›</Text>
                  </TouchableOpacity>
                ))}
                {category.key === 'network' ? (
                  <TouchableOpacity
                    style={[
                      styles.row,
                      { borderTopColor: colors.borderFaint, borderTopWidth: StyleSheet.hairlineWidth },
                    ]}
                    onPress={() =>
                      router.push({ pathname: '/cluster/[id]/forwards', params: { id } })
                    }
                  >
                    <SquircleIcon abbr="Pf" color={category.color} />
                    <View style={{ flex: 1, gap: 1 }}>
                      <Text style={styles.rowLabel}>Port Forwards</Text>
                    </View>
                    {forwardsCount > 0 ? (
                      <View style={styles.liveBadge}>
                        <Text style={styles.liveBadgeText}>{forwardsCount} live</Text>
                      </View>
                    ) : null}
                    <Text style={styles.chevron}>›</Text>
                  </TouchableOpacity>
                ) : null}
              </Card>
            </View>
          ))}
        </ScrollView>
      )}

      <NamespaceSheet visible={nsOpen} onClose={() => setNsOpen(false)} cluster={cluster} />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  header: { paddingTop: 62, paddingHorizontal: spacing.lg, gap: 12 },
  titleRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  title: { color: colors.text, fontSize: 30, fontWeight: '800', letterSpacing: -0.6 },
  search: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 9,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingVertical: 11,
  },
  searchIcon: { color: colors.textFaint, fontSize: 16 },
  searchText: { color: colors.textFaint, fontSize: 14 },
  scroll: { padding: spacing.lg, paddingTop: 14, paddingBottom: 130, gap: 20 },
  catHead: { flexDirection: 'row', alignItems: 'baseline', gap: 8, paddingHorizontal: 4 },
  catTitle: { color: colors.text, fontSize: 15, fontWeight: '700' },
  catMeta: { color: colors.textFaint, fontSize: 11 },
  catCard: { borderRadius: radius.cardLg, padding: 0, overflow: 'hidden' },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 15,
    paddingVertical: 11,
  },
  rowLabel: { color: colors.text, fontSize: 14.5, fontWeight: '500' },
  rowSub: { color: colors.textFaint, fontSize: 10.5 },
  scopeTag: { color: colors.textFaint, fontSize: 10.5, fontWeight: '600' },
  chevron: { color: 'rgba(242,245,250,0.22)', fontSize: 18, fontWeight: '600' },
  liveBadge: {
    backgroundColor: 'rgba(143,165,255,0.15)',
    borderRadius: radius.pill,
    paddingHorizontal: 9,
    paddingVertical: 3,
  },
  liveBadgeText: { color: colors.link, fontSize: 10.5, fontWeight: '700' },
});
