import { useLocalSearchParams, useRouter } from 'expo-router';
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
import { BackButton, Card, StatusDot } from '../../../src/ui/kit';
import { Button, EmptyState, ErrorBox, Loading } from '../../../src/ui/components';
import { colors, radius, spacing } from '../../../src/ui/theme';
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

/** Simple line-based YAML syntax coloring like the design's viewer. */
function YamlView({ text }: { text: string }) {
  const lines = useMemo(() => text.split('\n'), [text]);
  return (
    <View>
      {lines.map((line, index) => {
        const match = /^(\s*-?\s*[^:]+:)(.*)$/.exec(line);
        if (!match) {
          return (
            <Text key={index} style={styles.yamlValue}>
              {line || ' '}
            </Text>
          );
        }
        const value = match[2];
        const valueColor = /^\s*-?[0-9.]+\s*$/.test(value)
          ? colors.monoNumber
          : value.trim()
            ? colors.monoString
            : colors.textFaint;
        return (
          <Text key={index} style={styles.yamlLine}>
            <Text style={styles.yamlKey}>{match[1]}</Text>
            <Text style={[styles.yamlValue, { color: valueColor }]}>{value}</Text>
          </Text>
        );
      })}
    </View>
  );
}

function SummaryCards({ sections }: { sections: SummarySection[] }) {
  return (
    <>
      {sections.map((section) => (
        <Card key={section.title} style={styles.summaryCard}>
          <Text style={styles.cardTitle}>{section.title}</Text>
          {section.rows.map((entry, index) => (
            <View
              key={`${entry.label}-${index}`}
              style={[styles.kvRow, index > 0 && styles.kvDivider]}
            >
              <View style={styles.kvLabelWrap}>
                {entry.status ? <StatusDot color={STATUS_COLORS[entry.status]} size={8} /> : null}
                <Text style={styles.kvLabel}>{entry.label}</Text>
              </View>
              <Text style={[styles.kvValue, entry.mono && styles.kvValueMono]} selectable>
                {entry.value}
              </Text>
            </View>
          ))}
        </Card>
      ))}
    </>
  );
}

interface CrashInfo {
  container: string;
  restarts: number;
  message: string;
}

function detectCrash(manifest: Record<string, unknown> | null): CrashInfo | null {
  if (!manifest) return null;
  const statuses: any[] = (manifest as any).status?.containerStatuses ?? [];
  const crashing = statuses.find((s) => s.state?.waiting?.reason === 'CrashLoopBackOff');
  if (!crashing) return null;
  const terminated = crashing.lastState?.terminated;
  const detail = terminated
    ? `Last exit: code ${terminated.exitCode}${terminated.finishedAt ? `, ${ageOf(terminated.finishedAt)} ago` : ''}`
    : 'Container keeps restarting.';
  return {
    container: crashing.name,
    restarts: crashing.restartCount ?? 0,
    message: detail,
  };
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
  const isPod = typeKey === '/Pod';

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
  const crash = useMemo(() => (isPod ? detectCrash(manifest) : null), [isPod, manifest]);

  const load = useCallback(async () => {
    if (!cluster) return;
    setLoading(true);
    setError('');
    try {
      setManifest(await getResource(cluster, type, params.name, namespace));
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

  const phase = (manifest as any)?.status?.phase as string | undefined;
  const statusPill = isPod
    ? crash
      ? { label: 'CrashLoopBackOff', color: colors.danger }
      : phase === 'Running' || phase === 'Succeeded'
        ? { label: phase, color: colors.success }
        : phase
          ? { label: phase, color: colors.warning }
          : undefined
    : undefined;

  const runAction = async (action: () => Promise<void>) => {
    if (!cluster) return;
    setBusy(true);
    setError('');
    try {
      await action();
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
        throw new Error('The YAML document is empty or invalid.');
      }
      await replaceResource(cluster!, type, params.name, parsed as Record<string, unknown>, namespace);
      setEditing(false);
    });
  };

  const handleScale = () => {
    const current = (manifest?.spec as any)?.replicas ?? 0;
    Alert.prompt(
      'Scale',
      `Currently ${current} replicas`,
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
    Alert.alert('Restart rollout', `Roll out ${type.kind} "${params.name}" again?`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Restart',
        onPress: () => void runAction(() => restartRollout(cluster!, type, params.name, namespace)),
      },
    ]);
  };

  const handleDelete = () => {
    Alert.alert(
      `Delete ${type.kind}`,
      `Really delete "${params.name}"${namespace ? ` in ${namespace}` : ''}?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
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

  const openLogs = (previous?: boolean) => {
    router.push({
      pathname: '/cluster/[id]/logs',
      params: {
        id: params.id,
        namespace: namespace ?? '',
        name: params.name,
        containers: (((manifest?.spec as any)?.containers ?? []) as any[])
          .map((container) => container.name)
          .join(','),
        previous: previous ? '1' : '0',
      },
    });
  };

  if (!cluster) return <EmptyState message="Cluster not found." />;

  const actions: Array<{ key: string; label: string; icon: string; primary?: boolean; onPress: () => void }> = [];
  if (isPod && namespace) {
    actions.push({ key: 'logs', label: 'Logs', icon: '≣', primary: true, onPress: () => openLogs() });
  }
  if (SCALABLE.has(typeKey) && canEdit) {
    actions.push({ key: 'scale', label: 'Scale', icon: '⇅', onPress: handleScale });
  }
  if (RESTARTABLE.has(typeKey) && canEdit) {
    actions.push({ key: 'restart', label: 'Restart', icon: '↺', onPress: handleRestart });
  }
  if (canEdit) {
    actions.push({
      key: 'edit',
      label: 'Edit',
      icon: '✎',
      onPress: () => {
        setDraft(yamlText);
        setEditing(true);
      },
    });
  }
  actions.push({
    key: 'yaml',
    label: tab === 'yaml' ? 'Overview' : 'YAML',
    icon: '{ }',
    onPress: () => setTab(tab === 'yaml' ? 'overview' : 'yaml'),
  });

  return (
    <KeyboardAvoidingView
      style={styles.flex}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      {/* Header */}
      <View style={styles.header}>
        <BackButton onPress={() => router.back()} />
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={styles.headerName} numberOfLines={1}>
            {params.name}
          </Text>
          <Text style={styles.headerSub} numberOfLines={1}>
            {type.kind}
            {namespace ? ` · ${namespace}` : ''}
          </Text>
        </View>
        {statusPill ? (
          <View style={[styles.statusPill, { backgroundColor: `${statusPill.color}26` }]}>
            <Text style={[styles.statusPillText, { color: statusPill.color }]}>
              {statusPill.label}
            </Text>
          </View>
        ) : null}
      </View>

      {loading ? (
        <Loading />
      ) : editing ? (
        <>
          {error ? (
            <View style={styles.errorWrap}>
              <ErrorBox message={error} />
            </View>
          ) : null}
          <TextInput
            style={styles.editor}
            value={draft}
            onChangeText={setDraft}
            multiline
            autoCapitalize="none"
            autoCorrect={false}
            spellCheck={false}
          />
          <View style={styles.editActions}>
            <Button title="Save" onPress={() => void handleSave()} busy={busy} />
            <Button
              title="Cancel"
              variant="secondary"
              onPress={() => {
                setEditing(false);
                setError('');
              }}
            />
          </View>
        </>
      ) : (
        <ScrollView style={styles.flex} contentContainerStyle={styles.scroll}>
          {error ? <ErrorBox message={error} /> : null}

          {/* Action grid */}
          <View style={styles.actionGrid}>
            {actions.map((action) => (
              <TouchableOpacity
                key={action.key}
                style={[styles.actionCell, action.primary && styles.actionCellPrimary]}
                onPress={action.onPress}
                disabled={busy}
              >
                <Text style={[styles.actionIcon, action.primary && styles.actionTextPrimary]}>
                  {action.icon}
                </Text>
                <Text style={[styles.actionLabel, action.primary && styles.actionTextPrimary]}>
                  {action.label}
                </Text>
              </TouchableOpacity>
            ))}
          </View>

          {/* Crash diagnosis */}
          {crash ? (
            <View style={styles.crashCard}>
              <Text style={styles.crashTitle}>Why is this crashing?</Text>
              <Text style={styles.crashBody}>
                Container „{crash.container}" is crash-looping ({crash.restarts} restarts).
              </Text>
              <Text style={styles.crashMono}>{crash.message}</Text>
              <TouchableOpacity onPress={() => openLogs(true)}>
                <Text style={styles.crashLink}>View crash logs →</Text>
              </TouchableOpacity>
            </View>
          ) : null}

          {tab === 'yaml' ? (
            <Card style={styles.yamlCard}>
              <YamlView text={yamlText} />
            </Card>
          ) : (
            <>
              <SummaryCards sections={sections} />
              {events.length > 0 ? (
                <Card style={styles.summaryCard}>
                  <Text style={styles.cardTitle}>Events</Text>
                  {events.map((event, index) => (
                    <View key={index} style={[styles.eventRow, index > 0 && styles.kvDivider]}>
                      <View style={styles.kvLabelWrap}>
                        <StatusDot
                          color={event.type === 'Normal' ? colors.success : colors.warning}
                          size={8}
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
                </Card>
              ) : null}
            </>
          )}

          {canDelete ? (
            <TouchableOpacity style={styles.deleteButton} onPress={handleDelete} disabled={busy}>
              <Text style={styles.deleteText}>Delete {type.kind.toLowerCase()}</Text>
            </TouchableOpacity>
          ) : null}
        </ScrollView>
      )}
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: colors.background },
  header: {
    paddingTop: 60,
    paddingHorizontal: spacing.lg,
    paddingBottom: 8,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  headerName: { color: colors.text, fontSize: 14, fontWeight: '700' },
  headerSub: { color: 'rgba(242,245,250,0.4)', fontSize: 11.5 },
  statusPill: { borderRadius: radius.pill, paddingHorizontal: 11, paddingVertical: 5 },
  statusPillText: { fontSize: 11, fontWeight: '700' },
  errorWrap: { paddingHorizontal: spacing.lg, paddingTop: spacing.md },
  scroll: { padding: spacing.lg, paddingTop: 8, paddingBottom: 60, gap: 12 },
  actionGrid: { flexDirection: 'row', gap: 8 },
  actionCell: {
    flex: 1,
    alignItems: 'center',
    gap: 6,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 16,
    paddingVertical: 13,
  },
  actionCellPrimary: { backgroundColor: colors.accentSoft, borderColor: 'rgba(91,124,255,0.5)' },
  actionIcon: { color: colors.textMid, fontSize: 15, fontWeight: '700' },
  actionLabel: { color: colors.textMid, fontSize: 11, fontWeight: '600' },
  actionTextPrimary: { color: '#fff' },
  crashCard: {
    backgroundColor: 'rgba(251,113,133,0.08)',
    borderWidth: 1,
    borderColor: 'rgba(251,113,133,0.25)',
    borderRadius: radius.card,
    padding: 14,
    gap: 6,
  },
  crashTitle: { color: colors.dangerLight, fontSize: 13, fontWeight: '700' },
  crashBody: { color: 'rgba(242,245,250,0.65)', fontSize: 12.5, lineHeight: 18 },
  crashMono: {
    color: colors.dangerLight,
    fontFamily: 'Menlo',
    fontSize: 10,
    lineHeight: 16,
    backgroundColor: 'rgba(0,0,0,0.25)',
    borderRadius: 10,
    paddingHorizontal: 11,
    paddingVertical: 9,
  },
  crashLink: { color: colors.dangerLight, fontSize: 12.5, fontWeight: '600', paddingTop: 2 },
  summaryCard: { gap: 0, borderRadius: radius.card + 2 },
  cardTitle: {
    color: colors.link,
    fontSize: 12,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: spacing.sm,
  },
  kvRow: { flexDirection: 'row', alignItems: 'flex-start', paddingVertical: 6 },
  kvDivider: { borderTopColor: colors.borderFaint, borderTopWidth: StyleSheet.hairlineWidth },
  kvLabelWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    width: '38%',
    paddingRight: spacing.sm,
  },
  kvLabel: { color: colors.textDim, fontSize: 12.5, flexShrink: 1 },
  kvValue: { color: colors.text, fontSize: 12.5, flex: 1 },
  kvValueMono: { fontFamily: 'Menlo', fontSize: 11.5, color: colors.mono },
  eventRow: { paddingVertical: 7 },
  eventMessage: { color: colors.text, fontSize: 12.5, marginTop: 2, marginLeft: 14, lineHeight: 18 },
  yamlCard: { borderRadius: radius.card, backgroundColor: colors.backgroundDeep },
  yamlLine: { fontFamily: 'Menlo', fontSize: 10.5, lineHeight: 18 },
  yamlKey: { color: colors.monoKey, fontFamily: 'Menlo', fontSize: 10.5 },
  yamlValue: { color: colors.mono, fontFamily: 'Menlo', fontSize: 10.5, lineHeight: 18 },
  deleteButton: {
    backgroundColor: 'rgba(251,113,133,0.1)',
    borderWidth: 1,
    borderColor: 'rgba(251,113,133,0.22)',
    borderRadius: radius.card,
    paddingVertical: 14,
    alignItems: 'center',
    marginTop: 6,
  },
  deleteText: { color: colors.dangerLight, fontSize: 14, fontWeight: '600' },
  editor: {
    flex: 1,
    backgroundColor: colors.backgroundDeep,
    color: colors.text,
    fontFamily: 'Menlo',
    fontSize: 12,
    lineHeight: 18,
    padding: spacing.lg,
    textAlignVertical: 'top',
  },
  editActions: { padding: spacing.lg },
});
