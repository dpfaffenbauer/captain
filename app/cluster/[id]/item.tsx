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
  TouchableOpacity,
  View,
} from 'react-native';
import {
  deleteResource,
  getResource,
  listEventsFor,
  replaceResource,
  ResourceEvent,
  restartRollout,
  scaleResource,
} from '../../../src/kube/client';
import { summarizeResource, SummarySection } from '../../../src/kube/summarize';
import { useClusters } from '../../../src/state/ClustersContext';
import { ApiResourceType } from '../../../src/types';
import { Button, EmptyState, ErrorBox, Loading } from '../../../src/ui/components';
import { colors, spacing } from '../../../src/ui/theme';
import { ageOf } from '../../../src/util/format';

/** managedFields is huge and never hand-edited; hide it like kubectl does. */
function stripManagedFields(manifest: Record<string, unknown>): Record<string, unknown> {
  const metadata = manifest.metadata as Record<string, unknown> | undefined;
  if (metadata && 'managedFields' in metadata) {
    const { managedFields: _omitted, ...rest } = metadata;
    return { ...manifest, metadata: rest };
  }
  return manifest;
}

const SCALABLE = new Set(['apps/Deployment', 'apps/StatefulSet', 'apps/ReplicaSet', '/ReplicationController']);
const RESTARTABLE = new Set(['apps/Deployment', 'apps/StatefulSet', 'apps/DaemonSet']);

const STATUS_COLORS = { ok: colors.success, warn: colors.warning, bad: colors.danger } as const;

function SummaryView({ sections }: { sections: SummarySection[] }) {
  return (
    <>
      {sections.map((section) => (
        <View key={section.title} style={styles.card}>
          <Text style={styles.cardTitle}>{section.title}</Text>
          {section.rows.map((entry, index) => (
            <View key={`${entry.label}-${index}`} style={styles.kvRow}>
              <View style={styles.kvLabelWrap}>
                {entry.status ? (
                  <View style={[styles.dot, { backgroundColor: STATUS_COLORS[entry.status] }]} />
                ) : null}
                <Text style={styles.kvLabel}>{entry.label}</Text>
              </View>
              <Text style={[styles.kvValue, entry.mono && styles.kvValueMono]} selectable>
                {entry.value}
              </Text>
            </View>
          ))}
        </View>
      ))}
    </>
  );
}

function EventsCard({ events }: { events: ResourceEvent[] }) {
  if (events.length === 0) return null;
  return (
    <View style={styles.card}>
      <Text style={styles.cardTitle}>Events</Text>
      {events.map((event, index) => (
        <View key={index} style={styles.eventRow}>
          <View style={styles.kvLabelWrap}>
            <View
              style={[
                styles.dot,
                { backgroundColor: event.type === 'Normal' ? colors.success : colors.warning },
              ]}
            />
            <Text style={styles.kvLabel}>
              {event.reason}
              {event.count && event.count > 1 ? ` ×${event.count}` : ''}
              {event.lastTimestamp ? ` · ${ageOf(event.lastTimestamp)}` : ''}
            </Text>
          </View>
          <Text style={styles.eventMessage} selectable>
            {event.message}
          </Text>
        </View>
      ))}
    </View>
  );
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
  const typeKey = `${type.group}/${type.kind}`;

  const [manifest, setManifest] = useState<Record<string, unknown> | null>(null);
  const [events, setEvents] = useState<ResourceEvent[]>([]);
  const [tab, setTab] = useState<'overview' | 'yaml'>('overview');
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const yamlText = useMemo(
    () =>
      manifest ? yaml.dump(stripManagedFields(manifest), { noRefs: true, lineWidth: -1 }) : '',
    [manifest]
  );
  const sections = useMemo(
    () => (manifest ? summarizeResource(type, manifest) : []),
    [manifest, type]
  );

  const load = useCallback(async () => {
    if (!cluster) return;
    setLoading(true);
    setError('');
    try {
      setManifest(await getResource(cluster, type, params.name, namespace));
      // Events are best-effort; ignore RBAC errors.
      listEventsFor(cluster, type.kind, params.name, namespace)
        .then(setEvents)
        .catch(() => setEvents([]));
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

  const runAction = async (action: () => Promise<void>, successMessage?: string) => {
    if (!cluster) return;
    setBusy(true);
    setError('');
    try {
      await action();
      if (successMessage) Alert.alert(successMessage);
      await load();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setBusy(false);
    }
  };

  const handleSave = async () => {
    await runAction(async () => {
      const parsed = yaml.load(draft);
      if (!parsed || typeof parsed !== 'object') {
        throw new Error('Das YAML-Dokument ist leer oder ungültig.');
      }
      await replaceResource(cluster!, type, params.name, parsed as Record<string, unknown>, namespace);
      setEditing(false);
    });
  };

  const handleScale = () => {
    const current = (manifest?.spec as any)?.replicas ?? 0;
    Alert.prompt(
      'Skalieren',
      `Aktuell: ${current} Replicas`,
      (value) => {
        const replicas = parseInt(value, 10);
        if (Number.isNaN(replicas) || replicas < 0) return;
        void runAction(() => scaleResource(cluster!, type, params.name, replicas, namespace));
      },
      'plain-text',
      String(current),
      'number-pad'
    );
  };

  const handleRestart = () => {
    Alert.alert('Rollout neu starten', `${type.kind} „${params.name}" neu ausrollen?`, [
      { text: 'Abbrechen', style: 'cancel' },
      {
        text: 'Neu starten',
        onPress: () => void runAction(() => restartRollout(cluster!, type, params.name, namespace)),
      },
    ]);
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
          {!editing && (
            <View style={styles.tabs}>
              {(['overview', 'yaml'] as const).map((key) => (
                <TouchableOpacity
                  key={key}
                  style={[styles.tab, tab === key && styles.tabActive]}
                  onPress={() => setTab(key)}
                >
                  <Text style={[styles.tabText, tab === key && styles.tabTextActive]}>
                    {key === 'overview' ? 'Übersicht' : 'YAML'}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
          )}
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
          ) : tab === 'overview' ? (
            <ScrollView style={styles.flex} contentContainerStyle={styles.overviewContainer}>
              <SummaryView sections={sections} />
              <EventsCard events={events} />
            </ScrollView>
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
                <View style={styles.actionRow}>
                  {typeKey === '/Pod' && namespace && (
                    <View style={styles.actionItem}>
                      <Button
                        title="Logs"
                        variant="secondary"
                        onPress={() =>
                          router.push({
                            pathname: '/cluster/[id]/logs',
                            params: {
                              id: params.id,
                              namespace,
                              name: params.name,
                              containers: (((manifest?.spec as any)?.containers ?? []) as any[])
                                .map((container) => container.name)
                                .join(','),
                            },
                          })
                        }
                      />
                    </View>
                  )}
                  {SCALABLE.has(typeKey) && canEdit && (
                    <View style={styles.actionItem}>
                      <Button title="Skalieren" variant="secondary" onPress={handleScale} busy={busy} />
                    </View>
                  )}
                  {RESTARTABLE.has(typeKey) && canEdit && (
                    <View style={styles.actionItem}>
                      <Button title="Rollout ↻" variant="secondary" onPress={handleRestart} busy={busy} />
                    </View>
                  )}
                  <View style={styles.actionItem}>
                    <Button title="Neu laden" variant="secondary" onPress={() => void load()} />
                  </View>
                </View>
                <View style={styles.actionRow}>
                  {canEdit && (
                    <View style={styles.actionItem}>
                      <Button
                        title="Bearbeiten"
                        onPress={() => {
                          setDraft(yamlText);
                          setEditing(true);
                        }}
                      />
                    </View>
                  )}
                  {canDelete && (
                    <View style={styles.actionItem}>
                      <Button title="Löschen" variant="danger" onPress={handleDelete} busy={busy} />
                    </View>
                  )}
                </View>
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
  tabs: {
    flexDirection: 'row',
    margin: spacing.md,
    backgroundColor: colors.surface,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.border,
    overflow: 'hidden',
  },
  tab: { flex: 1, paddingVertical: 8, alignItems: 'center' },
  tabActive: { backgroundColor: colors.accent },
  tabText: { color: colors.textDim, fontSize: 14, fontWeight: '600' },
  tabTextActive: { color: colors.accentText },
  errorWrap: { paddingHorizontal: spacing.lg },
  overviewContainer: { padding: spacing.md, paddingBottom: spacing.xl },
  card: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: 10,
    padding: spacing.md,
    marginBottom: spacing.md,
  },
  cardTitle: {
    color: colors.accent,
    fontSize: 13,
    fontWeight: '700',
    textTransform: 'uppercase',
    marginBottom: spacing.sm,
  },
  kvRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    paddingVertical: 5,
    borderTopColor: colors.border,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  kvLabelWrap: { flexDirection: 'row', alignItems: 'center', width: '38%', paddingRight: spacing.sm },
  dot: { width: 8, height: 8, borderRadius: 4, marginRight: 6 },
  kvLabel: { color: colors.textDim, fontSize: 13, flexShrink: 1 },
  kvValue: { color: colors.text, fontSize: 13, flex: 1 },
  kvValueMono: { fontFamily: 'Menlo', fontSize: 12, color: colors.mono },
  eventRow: {
    paddingVertical: 6,
    borderTopColor: colors.border,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  eventMessage: { color: colors.text, fontSize: 13, marginTop: 2, marginLeft: 14 },
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
  actions: { paddingHorizontal: spacing.lg, paddingBottom: spacing.lg, paddingTop: spacing.xs },
  actionRow: { flexDirection: 'row', gap: spacing.sm },
  actionItem: { flex: 1 },
});
