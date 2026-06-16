import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { FlatList, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { abbreviationFor, categorizeResourceTypes } from '../../kube/categories';
import { discoverResourceTypesCached } from '../../kube/client';
import { useClusterNav } from '../../state/ClusterNav';
import { useClusters } from '../../state/ClustersContext';
import { ApiResourceType } from '../../types';
import { BackButton, Card, SquircleIcon } from '../kit';
import { EmptyState, ErrorBox, Loading } from '../components';
import { colors, spacing } from '../theme';

/**
 * Sub-list of resource kinds for a single (usually large) category such as
 * Custom Resources — keeps the sidebar tree from drowning in CRDs.
 *
 * Prop-driven so it works both as a pushed route (phone) and as keep-alive
 * content in the wide split layout. Navigation goes through ClusterNav.
 */
export function KindsContent({
  clusterId,
  category,
  title,
}: {
  clusterId: string;
  category: string;
  title: string;
}) {
  const nav = useClusterNav();
  const { getById } = useClusters();
  const cluster = getById(clusterId);

  const [types, setTypes] = useState<ApiResourceType[]>([]);
  const [filter, setFilter] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    if (!cluster) return;
    setError('');
    try {
      const discovered = await discoverResourceTypesCached(cluster);
      const categories = categorizeResourceTypes(
        discovered.filter((type) => type.verbs.includes('list'))
      );
      setTypes(categories.find((entry) => entry.key === category)?.types ?? []);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setLoading(false);
    }
  }, [cluster, category]);

  useEffect(() => {
    void load();
  }, [load]);

  const visible = useMemo(() => {
    const query = filter.trim().toLowerCase();
    if (!query) return types;
    return types.filter(
      (type) =>
        type.kind.toLowerCase().includes(query) || type.group.toLowerCase().includes(query)
    );
  }, [types, filter]);

  if (!cluster) return <EmptyState message="Cluster not found." />;

  const openType = (type: ApiResourceType) => {
    nav.show({ kind: 'list', type });
  };

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        {!nav.embedded ? <BackButton onPress={() => nav.back()} /> : null}
        <Text style={styles.title} numberOfLines={1}>
          {title || 'Resources'}
        </Text>
      </View>
      <View style={styles.toolbar}>
        <TextInput
          style={styles.search}
          value={filter}
          onChangeText={setFilter}
          placeholder="Filter by kind or group"
          placeholderTextColor={colors.textFaint}
          autoCapitalize="none"
          autoCorrect={false}
        />
      </View>

      {error ? (
        <View style={{ padding: spacing.lg }}>
          <ErrorBox message={error} />
        </View>
      ) : loading ? (
        <Loading />
      ) : (
        <FlatList
          data={visible}
          keyExtractor={(type) => `${type.group}/${type.version}/${type.plural}`}
          contentContainerStyle={styles.listContent}
          ListEmptyComponent={<EmptyState message="No resource kinds found." />}
          renderItem={({ item }) => (
            <TouchableOpacity onPress={() => openType(item)}>
              <Card style={styles.row}>
                <SquircleIcon abbr={abbreviationFor(item)} color={colors.accent} size={30} />
                <View style={{ flex: 1, gap: 2 }}>
                  <Text style={styles.rowName} numberOfLines={1}>
                    {item.kind}
                  </Text>
                  <Text style={styles.rowSub} numberOfLines={1}>
                    {item.group || 'core'}/{item.version}
                  </Text>
                </View>
                {!item.namespaced ? <Text style={styles.scopeTag}>cluster</Text> : null}
                <Text style={styles.chevron}>›</Text>
              </Card>
            </TouchableOpacity>
          )}
        />
      )}
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
  title: { color: colors.text, fontSize: 22, fontWeight: '800', letterSpacing: -0.5 },
  toolbar: { paddingHorizontal: spacing.lg, paddingBottom: 10 },
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
  listContent: { paddingHorizontal: spacing.lg, paddingBottom: 60, gap: 9 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 13 },
  rowName: { color: colors.text, fontSize: 13.5, fontWeight: '600' },
  rowSub: { color: colors.textDim, fontSize: 11.5 },
  scopeTag: { color: colors.textFaint, fontSize: 10.5 },
  chevron: { color: 'rgba(242,245,250,0.22)', fontSize: 18, fontWeight: '600' },
});
