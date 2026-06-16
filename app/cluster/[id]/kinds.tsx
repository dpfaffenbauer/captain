import { useLocalSearchParams, useRouter } from 'expo-router';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { FlatList, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { abbreviationFor, categorizeResourceTypes } from '../../../src/kube/categories';
import { discoverResourceTypesCached } from '../../../src/kube/client';
import { useClusters } from '../../../src/state/ClustersContext';
import { ApiResourceType } from '../../../src/types';
import { BackButton, Card, SquircleIcon } from '../../../src/ui/kit';
import { EmptyState, ErrorBox, Loading } from '../../../src/ui/components';
import { colors, spacing } from '../../../src/ui/theme';

/**
 * Sub-list of resource kinds for a single (usually large) category such as
 * Custom Resources — keeps the sidebar tree from drowning in CRDs.
 */
export default function KindsScreen() {
  const { id, category, title } = useLocalSearchParams<{
    id: string;
    category: string;
    title: string;
  }>();
  const router = useRouter();
  const { getById } = useClusters();
  const cluster = getById(id);

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
    router.replace({
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
    } as never);
  };

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <BackButton onPress={() => router.back()} />
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
