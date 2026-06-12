import { Stack, useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import React, { useCallback, useMemo, useState } from 'react';
import {
  FlatList,
  Modal,
  RefreshControl,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { listNamespaces, listResources } from '../../../src/kube/client';
import { useClusters } from '../../../src/state/ClustersContext';
import { ApiResourceType, KubeListItem } from '../../../src/types';
import { Button, EmptyState, ErrorBox, Loading } from '../../../src/ui/components';
import { colors, spacing } from '../../../src/ui/theme';
import { ageOf } from '../../../src/util/format';

const ALL_NAMESPACES = '';

export default function ResourceListScreen() {
  const params = useLocalSearchParams<{
    id: string;
    group: string;
    version: string;
    plural: string;
    kind: string;
    namespaced: string;
    verbs: string;
  }>();
  const router = useRouter();
  const { getById } = useClusters();
  const cluster = getById(params.id);

  const type = useMemo<ApiResourceType>(
    () => ({
      group: params.group ?? '',
      version: params.version ?? 'v1',
      plural: params.plural ?? '',
      kind: params.kind ?? '',
      namespaced: params.namespaced === '1',
      verbs: (params.verbs ?? '').split(',').filter(Boolean),
    }),
    [params.group, params.version, params.plural, params.kind, params.namespaced, params.verbs]
  );

  const [items, setItems] = useState<KubeListItem[]>([]);
  const [continueToken, setContinueToken] = useState<string | undefined>();
  const [namespace, setNamespace] = useState<string>(ALL_NAMESPACES);
  const [namespaces, setNamespaces] = useState<string[]>([]);
  const [pickerVisible, setPickerVisible] = useState(false);
  const [filter, setFilter] = useState('');
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(
    async (reset: boolean, token?: string) => {
      if (!cluster) return;
      setError('');
      try {
        const result = await listResources(cluster, type, {
          namespace: type.namespaced && namespace !== ALL_NAMESPACES ? namespace : undefined,
          continueToken: token,
        });
        setItems((current) => (reset ? result.items : [...current, ...result.items]));
        setContinueToken(result.continueToken);
      } catch (caught) {
        setError(caught instanceof Error ? caught.message : String(caught));
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [cluster, type, namespace]
  );

  useFocusEffect(
    useCallback(() => {
      setLoading(true);
      void load(true);
    }, [load])
  );

  const openNamespacePicker = async () => {
    setPickerVisible(true);
    if (namespaces.length === 0 && cluster) {
      try {
        setNamespaces(await listNamespaces(cluster));
      } catch {
        // Namespace list may be forbidden; the picker still offers "all".
      }
    }
  };

  const visibleItems = useMemo(() => {
    const query = filter.trim().toLowerCase();
    if (!query) return items;
    return items.filter(
      (item) =>
        item.name.toLowerCase().includes(query) ||
        (item.namespace ?? '').toLowerCase().includes(query)
    );
  }, [items, filter]);

  if (!cluster) return <EmptyState message="Cluster nicht gefunden." />;

  return (
    <View style={styles.container}>
      <Stack.Screen options={{ title: type.kind }} />

      <View style={styles.toolbar}>
        <TextInput
          style={styles.search}
          value={filter}
          onChangeText={setFilter}
          placeholder="Nach Name filtern…"
          placeholderTextColor={colors.textDim}
          autoCapitalize="none"
          autoCorrect={false}
        />
        {type.namespaced && (
          <TouchableOpacity style={styles.nsButton} onPress={() => void openNamespacePicker()}>
            <Text style={styles.nsButtonText} numberOfLines={1}>
              {namespace === ALL_NAMESPACES ? 'Alle NS' : namespace}
            </Text>
          </TouchableOpacity>
        )}
      </View>

      {error ? (
        <View style={styles.errorWrap}>
          <ErrorBox message={error} />
          <Button title="Erneut versuchen" variant="secondary" onPress={() => void load(true)} />
        </View>
      ) : loading ? (
        <Loading />
      ) : (
        <FlatList
          data={visibleItems}
          keyExtractor={(item) => `${item.namespace ?? ''}/${item.name}`}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={() => {
                setRefreshing(true);
                void load(true);
              }}
              tintColor={colors.accent}
            />
          }
          ListEmptyComponent={<EmptyState message={`Keine ${type.plural} gefunden.`} />}
          ListFooterComponent={
            continueToken ? (
              <View style={styles.footer}>
                <Button
                  title="Mehr laden"
                  variant="secondary"
                  onPress={() => void load(false, continueToken)}
                />
              </View>
            ) : null
          }
          renderItem={({ item }) => (
            <TouchableOpacity
              style={styles.row}
              onPress={() =>
                router.push({
                  pathname: '/cluster/[id]/item',
                  params: {
                    id: params.id,
                    group: type.group,
                    version: type.version,
                    plural: type.plural,
                    kind: type.kind,
                    namespaced: type.namespaced ? '1' : '0',
                    verbs: type.verbs.join(','),
                    name: item.name,
                    namespace: item.namespace ?? '',
                  },
                })
              }
            >
              <View style={styles.rowText}>
                <Text style={styles.name}>{item.name}</Text>
                {item.namespace ? <Text style={styles.namespace}>{item.namespace}</Text> : null}
              </View>
              <Text style={styles.age}>{ageOf(item.creationTimestamp)}</Text>
            </TouchableOpacity>
          )}
        />
      )}

      <Modal visible={pickerVisible} animationType="slide" transparent>
        <View style={styles.modalBackdrop}>
          <View style={styles.modalSheet}>
            <Text style={styles.modalTitle}>Namespace wählen</Text>
            <FlatList
              data={[ALL_NAMESPACES, ...namespaces]}
              keyExtractor={(name) => name || '*all*'}
              renderItem={({ item }) => (
                <TouchableOpacity
                  style={styles.modalRow}
                  onPress={() => {
                    setNamespace(item);
                    setPickerVisible(false);
                  }}
                >
                  <Text
                    style={[styles.modalRowText, item === namespace && styles.modalRowActive]}
                  >
                    {item === ALL_NAMESPACES ? 'Alle Namespaces' : item}
                  </Text>
                </TouchableOpacity>
              )}
            />
            <Button title="Schließen" variant="secondary" onPress={() => setPickerVisible(false)} />
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  toolbar: { flexDirection: 'row', alignItems: 'center', padding: spacing.md, gap: spacing.sm },
  search: {
    flex: 1,
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: 8,
    color: colors.text,
    paddingHorizontal: spacing.md,
    paddingVertical: 8,
    fontSize: 15,
  },
  nsButton: {
    maxWidth: 140,
    backgroundColor: colors.surfaceAlt,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: spacing.md,
    paddingVertical: 9,
  },
  nsButtonText: { color: colors.text, fontSize: 13 },
  errorWrap: { padding: spacing.lg },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderBottomColor: colors.border,
    borderBottomWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
  },
  rowText: { flex: 1, marginRight: spacing.md },
  name: { color: colors.text, fontSize: 15, fontWeight: '500' },
  namespace: { color: colors.textDim, fontSize: 12, marginTop: 2 },
  age: { color: colors.textDim, fontSize: 13 },
  footer: { padding: spacing.lg },
  modalBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'flex-end' },
  modalSheet: {
    backgroundColor: colors.surface,
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    maxHeight: '70%',
    padding: spacing.lg,
  },
  modalTitle: { color: colors.text, fontSize: 17, fontWeight: '600', marginBottom: spacing.md },
  modalRow: { paddingVertical: spacing.md, borderBottomColor: colors.border, borderBottomWidth: StyleSheet.hairlineWidth },
  modalRowText: { color: colors.text, fontSize: 15 },
  modalRowActive: { color: colors.accent, fontWeight: '600' },
});
