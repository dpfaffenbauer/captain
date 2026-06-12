import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  RefreshControl,
  SectionList,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { categorizeResourceTypes, ResourceCategory } from '../../../src/kube/categories';
import { discoverResourceTypes } from '../../../src/kube/client';
import { useClusters } from '../../../src/state/ClustersContext';
import { ApiResourceType } from '../../../src/types';
import { Button, EmptyState, ErrorBox, Loading } from '../../../src/ui/components';
import { colors, spacing } from '../../../src/ui/theme';

interface Section {
  category: ResourceCategory;
  collapsed: boolean;
  data: ApiResourceType[];
}

export default function ResourceCategoriesScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const { getById } = useClusters();
  const cluster = getById(id);

  const [categories, setCategories] = useState<ResourceCategory[]>([]);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [filter, setFilter] = useState('');
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    if (!cluster) return;
    setError('');
    try {
      const types = await discoverResourceTypes(cluster);
      const result = categorizeResourceTypes(types.filter((type) => type.verbs.includes('list')));
      setCategories(result);
      setCollapsed(new Set(result.filter((c) => c.collapsedByDefault).map((c) => c.key)));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [cluster]);

  useEffect(() => {
    void load();
  }, [load]);

  const sections = useMemo<Section[]>(() => {
    const query = filter.trim().toLowerCase();
    return categories
      .map((category) => {
        const matching = query
          ? category.types.filter(
              (type) =>
                type.kind.toLowerCase().includes(query) ||
                type.plural.includes(query) ||
                type.group.includes(query)
            )
          : category.types;
        // While searching, ignore collapse state so results stay visible.
        const isCollapsed = query === '' && collapsed.has(category.key);
        return {
          category,
          collapsed: isCollapsed,
          data: isCollapsed ? [] : matching,
          matchCount: matching.length,
        };
      })
      .filter((section) => (query ? section.matchCount > 0 : true))
      .map(({ matchCount: _omitted, ...section }) => section);
  }, [categories, collapsed, filter]);

  const toggleSection = (key: string) => {
    setCollapsed((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  if (!cluster) return <EmptyState message="Cluster nicht gefunden." />;

  return (
    <View style={styles.container}>
      <Stack.Screen options={{ title: cluster.name }} />
      <TextInput
        style={styles.search}
        value={filter}
        onChangeText={setFilter}
        placeholder="Ressourcen-Typ suchen…"
        placeholderTextColor={colors.textDim}
        autoCapitalize="none"
        autoCorrect={false}
      />
      {error ? (
        <View style={styles.errorWrap}>
          <ErrorBox message={error} />
          <Button title="Erneut versuchen" variant="secondary" onPress={() => void load()} />
        </View>
      ) : loading ? (
        <Loading />
      ) : (
        <SectionList
          sections={sections}
          keyExtractor={(type) => `${type.group}/${type.version}/${type.plural}`}
          stickySectionHeadersEnabled
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
          ListEmptyComponent={<EmptyState message="Keine Ressourcen-Typen gefunden." />}
          renderSectionHeader={({ section }) => (
            <TouchableOpacity
              style={styles.sectionHeader}
              onPress={() => toggleSection(section.category.key)}
            >
              <Text style={styles.sectionIcon}>{section.category.icon}</Text>
              <Text style={styles.sectionTitle}>{section.category.title}</Text>
              <Text style={styles.sectionCount}>{section.category.types.length}</Text>
              <Text style={styles.sectionChevron}>{section.collapsed ? '›' : '⌄'}</Text>
            </TouchableOpacity>
          )}
          renderItem={({ item, section }) => (
            <TouchableOpacity
              style={styles.row}
              onPress={() =>
                router.push({
                  pathname: '/cluster/[id]/list',
                  params: {
                    id,
                    group: item.group,
                    version: item.version,
                    plural: item.plural,
                    kind: item.kind,
                    namespaced: item.namespaced ? '1' : '0',
                    verbs: item.verbs.join(','),
                  },
                })
              }
            >
              <Text style={styles.kind}>{item.kind}</Text>
              <Text style={styles.detail}>
                {section.category.key === 'custom' || section.category.key === 'other'
                  ? `${item.group || 'core'} · ${item.version}`
                  : `${item.plural} · ${item.version}`}
                {item.namespaced ? '' : ' · clusterweit'}
              </Text>
            </TouchableOpacity>
          )}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  search: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: 8,
    color: colors.text,
    margin: spacing.md,
    paddingHorizontal: spacing.md,
    paddingVertical: 8,
    fontSize: 15,
  },
  errorWrap: { padding: spacing.lg },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surfaceAlt,
    borderBottomColor: colors.border,
    borderBottomWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
  },
  sectionIcon: { fontSize: 15, marginRight: spacing.sm },
  sectionTitle: { flex: 1, color: colors.text, fontSize: 15, fontWeight: '700' },
  sectionCount: { color: colors.textDim, fontSize: 13, marginRight: spacing.md },
  sectionChevron: { color: colors.textDim, fontSize: 17, width: 16, textAlign: 'center' },
  row: {
    backgroundColor: colors.surface,
    borderBottomColor: colors.border,
    borderBottomWidth: StyleSheet.hairlineWidth,
    paddingLeft: spacing.xl + spacing.sm,
    paddingRight: spacing.lg,
    paddingVertical: spacing.md,
  },
  kind: { color: colors.text, fontSize: 15, fontWeight: '500' },
  detail: { color: colors.textDim, fontSize: 12, marginTop: 2 },
});
