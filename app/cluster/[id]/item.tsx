import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import yaml from 'js-yaml';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Alert,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { deleteResource, getResource, replaceResource } from '../../../src/kube/client';
import { useClusters } from '../../../src/state/ClustersContext';
import { ApiResourceType } from '../../../src/types';
import { Button, EmptyState, ErrorBox, Loading } from '../../../src/ui/components';
import { colors, spacing } from '../../../src/ui/theme';

/** managedFields is huge and never hand-edited; hide it like kubectl does. */
function stripManagedFields(manifest: Record<string, unknown>): Record<string, unknown> {
  const metadata = manifest.metadata as Record<string, unknown> | undefined;
  if (metadata && 'managedFields' in metadata) {
    const { managedFields: _omitted, ...rest } = metadata;
    return { ...manifest, metadata: rest };
  }
  return manifest;
}

export default function ResourceItemScreen() {
  const params = useLocalSearchParams<{
    id: string;
    group: string;
    version: string;
    plural: string;
    kind: string;
    namespaced: string;
    verbs: string;
    name: string;
    namespace: string;
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
  const namespace = params.namespace || undefined;

  const [yamlText, setYamlText] = useState('');
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    if (!cluster) return;
    setLoading(true);
    setError('');
    try {
      const manifest = await getResource(cluster, type, params.name, namespace);
      setYamlText(yaml.dump(stripManagedFields(manifest), { noRefs: true, lineWidth: -1 }));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setLoading(false);
    }
  }, [cluster, type, params.name, namespace]);

  useEffect(() => {
    void load();
  }, [load]);

  const canEdit = type.verbs.length === 0 || type.verbs.includes('update');
  const canDelete = type.verbs.length === 0 || type.verbs.includes('delete');

  const handleSave = async () => {
    if (!cluster) return;
    setBusy(true);
    setError('');
    try {
      const manifest = yaml.load(draft);
      if (!manifest || typeof manifest !== 'object') {
        throw new Error('Das YAML-Dokument ist leer oder ungültig.');
      }
      const updated = await replaceResource(
        cluster,
        type,
        params.name,
        manifest as Record<string, unknown>,
        namespace
      );
      setYamlText(yaml.dump(stripManagedFields(updated), { noRefs: true, lineWidth: -1 }));
      setEditing(false);
      Alert.alert('Gespeichert', `${type.kind} „${params.name}" wurde aktualisiert.`);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setBusy(false);
    }
  };

  const handleDelete = () => {
    Alert.alert(
      'Ressource löschen',
      `${type.kind} „${params.name}"${namespace ? ` in ${namespace}` : ''} wirklich löschen?`,
      [
        { text: 'Abbrechen', style: 'cancel' },
        {
          text: 'Löschen',
          style: 'destructive',
          onPress: async () => {
            if (!cluster) return;
            setBusy(true);
            try {
              await deleteResource(cluster, type, params.name, namespace);
              router.back();
            } catch (caught) {
              setError(caught instanceof Error ? caught.message : String(caught));
              setBusy(false);
            }
          },
        },
      ]
    );
  };

  if (!cluster) return <EmptyState message="Cluster nicht gefunden." />;

  return (
    <KeyboardAvoidingView
      style={styles.flex}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <Stack.Screen options={{ title: params.name }} />
      {loading ? (
        <Loading />
      ) : (
        <>
          {error ? (
            <View style={styles.errorWrap}>
              <ErrorBox message={error} />
            </View>
          ) : null}
          {editing ? (
            <TextInput
              style={styles.editor}
              value={draft}
              onChangeText={setDraft}
              multiline
              autoCapitalize="none"
              autoCorrect={false}
              spellCheck={false}
            />
          ) : (
            <ScrollView style={styles.flex} contentContainerStyle={styles.yamlContainer}>
              <Text style={styles.yaml} selectable>
                {yamlText}
              </Text>
            </ScrollView>
          )}
          <View style={styles.actions}>
            {editing ? (
              <>
                <Button title="Speichern" onPress={() => void handleSave()} busy={busy} />
                <Button
                  title="Abbrechen"
                  variant="secondary"
                  onPress={() => {
                    setEditing(false);
                    setError('');
                  }}
                />
              </>
            ) : (
              <>
                {canEdit && (
                  <Button
                    title="Bearbeiten"
                    onPress={() => {
                      setDraft(yamlText);
                      setEditing(true);
                    }}
                  />
                )}
                <Button title="Neu laden" variant="secondary" onPress={() => void load()} />
                {canDelete && <Button title="Löschen" variant="danger" onPress={handleDelete} busy={busy} />}
              </>
            )}
          </View>
        </>
      )}
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: colors.background },
  errorWrap: { paddingHorizontal: spacing.lg, paddingTop: spacing.md },
  yamlContainer: { padding: spacing.lg },
  yaml: { color: colors.mono, fontFamily: 'Menlo', fontSize: 12, lineHeight: 18 },
  editor: {
    flex: 1,
    backgroundColor: colors.surface,
    color: colors.text,
    fontFamily: 'Menlo',
    fontSize: 12,
    lineHeight: 18,
    padding: spacing.lg,
    textAlignVertical: 'top',
  },
  actions: { padding: spacing.lg },
});
