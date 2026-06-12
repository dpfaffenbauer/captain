import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { FlatList, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { discoverResourceTypes } from '../../../src/kube/client';
import { useClusters } from '../../../src/state/ClustersContext';
import { ApiResourceType } from '../../../src/types';
import { Button, EmptyState, ErrorBox, Loading } from '../../../src/ui/components';
import { colors, spacing } from '../../../src/ui/theme';

type Row =
  | { kind: 'header'; key: string; title: string }
  | { kind: 'resource'; key: string; type: ApiResourceType };

export default function ResourceTypesScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const { getById } = useClusters();
  const cluster = getById(id);

  const [types, setTypes] = useState<ApiResourceType[]>([]);
  const [filter, setFilter] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    if (!cluster) return;
    setLoading(true);
    setError('');
    try {
      setTypes(await discoverResourceTypes(cluster));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setLoading(false);
    }
  }, [cluster]);

  useEffect(() => {
    void load();
  }, [load]);

  const rows = useMemo<Row[]>(() => {
    const query = filter.trim().toLowerCase();
    const visible = types.filter(
      (type) =>
        type.verbs.includes('list') &&
        (query === '' ||
          type.kind.toLowerCase().includes(query) ||
          type.plural.includes(query) ||
          type.group.includes(query))
    );
    const byGroup = new Map<string, ApiResourceType[]>();
    for (const type of visible) {
      const groupName = type.group === '' ? 'core' : type.group;
      const list = byGroup.get(groupName) ?? [];
      list.push(type);
      byGroup.set(groupName, list);
    }
    const groupNames = [...byGroup.keys()].sort((a, b) =>
      a === 'core' ? -1 : b === 'core' ? 1 : a.localeCompare(b)
    );
    const result: Row[] = [];
    for (const groupName of groupNames) {
      result.push({ kind: 'header', key: `header:${groupName}`, title: groupName });
      for (const type of byGroup.get(groupName)!) {
        result.push({ kind: 'resource', key: `${groupName}/${type.version}/${type.plural}`, type });
      }
    }
    return result;
  }, [types, filter]);

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
        <FlatList
          data={rows}
          keyExtractor={(row) => row.key}
          ListEmptyComponent={<EmptyState message="Keine Ressourcen-Typen gefunden." />}
          renderItem={({ item }) =>
            item.kind === 'header' ? (
              <Text style={styles.groupHeader}>{item.title}</Text>
            ) : (
              <TouchableOpacity
                style={styles.row}
                onPress={() =>
                  router.push({
                    pathname: '/cluster/[id]/list',
                    params: {
                      id,
                      group: item.type.group,
                      version: item.type.version,
                      plural: item.type.plural,
                      kind: item.type.kind,
                      namespaced: item.type.namespaced ? '1' : '0',
                      verbs: item.type.verbs.join(','),
                    },
                  })
                }
              >
                <Text style={styles.kind}>{item.type.kind}</Text>
                <Text style={styles.plural}>
                  {item.type.plural} · {item.type.version}
                  {item.type.namespaced ? '' : ' · clusterweit'}
                </Text>
              </TouchableOpacity>
            )
          }
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
  groupHeader: {
    color: colors.accent,
    fontSize: 13,
    fontWeight: '700',
    textTransform: 'uppercase',
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.lg,
    paddingBottom: spacing.xs,
  },
  row: {
    backgroundColor: colors.surface,
    borderBottomColor: colors.border,
    borderBottomWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
  },
  kind: { color: colors.text, fontSize: 16, fontWeight: '500' },
  plural: { color: colors.textDim, fontSize: 12, marginTop: 2 },
});
