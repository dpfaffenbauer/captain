import yaml from 'js-yaml';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Alert,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from './rn';
import {
  applyResource,
  deleteResource,
  getResource,
  listDeploymentRevisions,
  drainNode,
  listEventsFor,
  replaceResource,
  ResourceEvent,
  restartRollout,
  setNodeUnschedulable,
  rollbackDeployment,
  scaleResource,
  setContainerImage,
  setCronJobSuspended,
  setRolloutPaused,
  triggerCronJob,
} from '../kube/client';
import { startPortForward } from '../kube/portforward';
import { abbreviationFor } from '../kube/categories';
import {
  ChildGroup,
  describeChild,
  findRelatedResources,
  listOwnedResources,
  RelatedGroup,
  typeForOwnerRef,
} from '../kube/related';
import { KubeApiError } from '../kube/transport';
import { DiffLine, diffLines } from '../util/diff';
import { summarizeResource, SummarySection } from '../kube/summarize';
import { useAccess } from '../state/AccessContext';
import { useFavorites } from '../state/FavoritesContext';
import { favoriteKey } from '../storage/favorites';
import { hapticTap, hapticWarning } from '../util/haptics';
import { ApiResourceType, ClusterConfig } from '../types';
import { DetailTarget } from '../state/DetailSelection';
import { BackButton, Card, CloseButton, SquircleIcon, StatusDot } from './kit';
import { YamlEditor } from './YamlEditor';
import { YamlView } from './YamlView';
import { Button, EmptyState, ErrorBox, Loading } from './components';
import { colors, radius, spacing } from './theme';
import { ageOf } from '../util/format';

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

export interface ItemViewProps {
  cluster: ClusterConfig;
  type: ApiResourceType;
  name: string;
  namespace?: string;
  /** 'screen' is a full route (back button, status-bar padding, keyboard avoid);
   *  'pane' renders inside a split-view detail column. */
  mode: 'screen' | 'pane';
  /** Drill into a related resource / logs / exec. */
  onNavigate: (target: DetailTarget) => void;
  /** Close the view (back on screen, clear the pane on wide). */
  onClose: () => void;
  /** In pane mode with history: pop to the previous pane entry. */
  onBack?: () => void;
  /** Optional: open the port-forwards list (route push in both modes). */
  onShowForwards?: () => void;
}

export function ItemView({
  cluster,
  type,
  name,
  namespace,
  mode,
  onNavigate,
  onClose,
  onBack,
  onShowForwards,
}: ItemViewProps) {
  const { isFavorite, toggle: toggleFavorite } = useFavorites();
  const { can } = useAccess();

  const typeKey = `${type.group}/${type.kind}`;
  const isPod = typeKey === '/Pod';
  const isNode = typeKey === '/Node';

  const pinned = isFavorite(
    favoriteKey({ clusterId: cluster.id, group: type.group, kind: type.kind, namespace, name })
  );
  const handleToggleFavorite = () => {
    hapticTap();
    toggleFavorite({
      clusterId: cluster.id,
      group: type.group,
      version: type.version,
      plural: type.plural,
      kind: type.kind,
      namespaced: type.namespaced,
      verbs: type.verbs,
      name,
      namespace,
    });
  };

  const [manifest, setManifest] = useState<Record<string, unknown> | null>(null);
  const [events, setEvents] = useState<ResourceEvent[]>([]);
  const [related, setRelated] = useState<RelatedGroup[]>([]);
  const [children, setChildren] = useState<ChildGroup[]>([]);
  const [tab, setTab] = useState<'overview' | 'yaml'>('overview');
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const [diff, setDiff] = useState<DiffLine[] | null>(null);
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

  /** ownerReferences resolved to navigable types (Pod → ReplicaSet → Deployment …). */
  const owners = useMemo(() => {
    const refs = (((manifest as any)?.metadata?.ownerReferences ?? []) as any[]);
    return refs.map((ref) => ({ ref, ownerType: typeForOwnerRef(ref, type.namespaced) }));
  }, [manifest, type.namespaced]);
  const nodeName = isPod ? ((manifest?.spec as any)?.nodeName as string | undefined) : undefined;

  const load = useCallback(async () => {
    if (!cluster) return;
    setLoading(true);
    setError('');
    try {
      const fetched = await getResource(cluster, type, name, namespace);
      setManifest(fetched);
      listEventsFor(cluster, type.kind, name, namespace)
        .then(setEvents)
        .catch(() => setEvents([]));
      listOwnedResources(cluster, type, fetched)
        .then(setChildren)
        .catch(() => setChildren([]));
      findRelatedResources(cluster, type, fetched)
        .then(setRelated)
        .catch(() => setRelated([]));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setLoading(false);
    }
  }, [cluster, type, name, namespace]);

  useEffect(() => {
    void load();
  }, [load]);

  // Discovery says the kind supports the verb; RBAC says this user may use it.
  const canEdit = (type.verbs.length === 0 || type.verbs.includes('update')) && can('update', type);
  const canDelete = (type.verbs.length === 0 || type.verbs.includes('delete')) && can('delete', type);

  const phase = (manifest as any)?.status?.phase as string | undefined;
  const statusPill = isPod
    ? crash
      ? { label: 'CrashLoopBackOff', color: colors.danger }
      : phase === 'Running' || phase === 'Succeeded'
        ? { label: phase, color: colors.success }
        : phase
          ? { label: phase, color: colors.warning }
          : undefined
    : typeKey === 'apps/Deployment' && (manifest?.spec as any)?.paused === true
      ? { label: 'Paused', color: colors.warning }
      : isNode && (manifest?.spec as any)?.unschedulable === true
        ? { label: 'Cordoned', color: colors.warning }
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

  /** Save step 1: validate the draft and show what would change. */
  const handleReview = () => {
    setError('');
    try {
      const parsed = yaml.load(draft);
      if (!parsed || typeof parsed !== 'object') {
        throw new Error('The YAML document is empty or invalid.');
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
      return;
    }
    const changes = diffLines(yamlText, draft);
    if (!changes.some((line) => line.type !== 'same')) {
      setEditing(false);
      return;
    }
    setDiff(changes);
  };

  /** Save step 2: server-side apply — immune to the PUT 409 conflict race. */
  const handleApply = async () => {
    await runAction(async () => {
      const parsed = yaml.load(draft) as Record<string, unknown>;
      try {
        await applyResource(cluster, type, name, parsed, namespace);
      } catch (caught) {
        // Some aggregated APIs do not support server-side apply; fall back to PUT.
        if (caught instanceof KubeApiError && caught.status === 415) {
          await replaceResource(cluster, type, name, parsed, namespace);
        } else {
          throw caught;
        }
      }
      setDiff(null);
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
        void runAction(() => scaleResource(cluster, type, name, replicas, namespace));
      },
      'plain-text',
      String(current),
      'number-pad'
    );
  };

  const handleRestart = () => {
    Alert.alert('Restart rollout', `Roll out ${type.kind} "${name}" again?`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Restart',
        onPress: () => void runAction(() => restartRollout(cluster, type, name, namespace)),
      },
    ]);
  };

  const rolloutPaused = (manifest?.spec as any)?.paused === true;
  const cronSuspended = (manifest?.spec as any)?.suspend === true;

  const handlePauseResume = () => {
    hapticTap();
    void runAction(() => setRolloutPaused(cluster, type, name, !rolloutPaused, namespace));
  };

  const handleRollback = async () => {
    if (!cluster || !namespace) return;
    setBusy(true);
    setError('');
    try {
      const revisions = await listDeploymentRevisions(cluster, namespace, name);
      const previous = revisions.find((entry) => !entry.current);
      if (!previous) {
        setError('No previous revision to roll back to.');
        return;
      }
      Alert.alert(
        'Rollback',
        `Roll back to revision ${previous.revision}?\n\n${previous.images.join('\n')}${
          previous.changeCause ? `\n\n${previous.changeCause}` : ''
        }`,
        [
          { text: 'Cancel', style: 'cancel' },
          {
            text: 'Roll back',
            style: 'destructive',
            onPress: () =>
              void runAction(() => rollbackDeployment(cluster, namespace, name, previous)),
          },
        ]
      );
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setBusy(false);
    }
  };

  const handleSetImage = () => {
    const containers: any[] = (manifest?.spec as any)?.template?.spec?.containers ?? [];
    if (containers.length === 0) return;
    const promptFor = (container: any) => {
      Alert.prompt(
        'Set image',
        container.name,
        (value) => {
          const image = value?.trim();
          if (!image || image === container.image) return;
          void runAction(() =>
            setContainerImage(cluster, type, name, container.name, image, namespace)
          );
        },
        'plain-text',
        container.image ?? ''
      );
    };
    if (containers.length === 1) {
      promptFor(containers[0]);
      return;
    }
    Alert.alert('Set image', 'Choose a container', [
      ...containers.map((container) => ({
        text: container.name,
        onPress: () => promptFor(container),
      })),
      { text: 'Cancel', style: 'cancel' as const },
    ]);
  };

  const nodeCordoned = (manifest?.spec as any)?.unschedulable === true;

  const handleCordon = () => {
    hapticTap();
    void runAction(() => setNodeUnschedulable(cluster, name, !nodeCordoned));
  };

  const handleDrain = () => {
    hapticWarning();
    Alert.alert(
      'Drain node',
      `Cordon "${name}" and evict all regular pods? DaemonSet and mirror pods stay; PodDisruptionBudgets are honored.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Drain',
          style: 'destructive',
          onPress: () =>
            void runAction(async () => {
              const result = await drainNode(cluster, name);
              const summary = `${result.evicted} evicted · ${result.skipped} skipped${
                result.failures.length > 0 ? ` · ${result.failures.length} refused` : ''
              }`;
              Alert.alert(
                'Drain finished',
                result.failures.length > 0
                  ? `${summary}\n\n${result.failures.slice(0, 5).join('\n')}`
                  : summary
              );
            }),
        },
      ]
    );
  };

  const handleSuspendCron = () => {
    hapticTap();
    void runAction(() => setCronJobSuspended(cluster, type, name, !cronSuspended, namespace));
  };

  const handleTriggerCron = () => {
    if (!namespace) return;
    Alert.alert('Run now', `Create a one-off job from "${name}"?`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Run',
        onPress: () =>
          void runAction(async () => {
            const jobName = await triggerCronJob(cluster, type, name, namespace);
            Alert.alert('Job created', jobName);
          }),
      },
    ]);
  };

  const handleDelete = () => {
    hapticWarning();
    Alert.alert(
      `Delete ${type.kind}`,
      `Really delete "${name}"${namespace ? ` in ${namespace}` : ''}?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            if (!cluster) return;
            setBusy(true);
            try {
              await deleteResource(cluster, type, name, namespace);
              onClose();
            } catch (caught) {
              setError(caught instanceof Error ? caught.message : String(caught));
              setBusy(false);
            }
          },
        },
      ]
    );
  };

  const openRelated = (relType: ApiResourceType, relName: string, relNamespace?: string) => {
    hapticTap();
    onNavigate({
      kind: 'item',
      type: relType,
      name: relName,
      namespace: relType.namespaced ? relNamespace : undefined,
    });
  };

  const openLogs = (previous?: boolean) => {
    onNavigate({
      kind: 'logs',
      namespace: namespace ?? '',
      name,
      containers: (((manifest?.spec as any)?.containers ?? []) as any[]).map(
        (container) => container.name
      ),
      previous,
    });
  };

  if (!cluster) return <EmptyState message="Cluster not found." />;

  const firstContainer = ((manifest?.spec as any)?.containers ?? [])[0];

  const handleForward = () => {
    const defaultPort = firstContainer?.ports?.[0]?.containerPort ?? 80;
    Alert.prompt(
      'Port forward',
      'Remote container port',
      (value) => {
        const remotePort = parseInt(value, 10);
        if (Number.isNaN(remotePort) || remotePort <= 0 || !cluster || !namespace) return;
        hapticTap();
        startPortForward(cluster, namespace, name, remotePort)
          .then((forward) => {
            Alert.alert(
              'Port forward active',
              `localhost:${forward.localPort} → ${name}:${remotePort}`,
              [
                { text: 'OK' },
                ...(onShowForwards
                  ? [{ text: 'Show forwards', onPress: onShowForwards }]
                  : []),
              ]
            );
          })
          .catch((caught) => setError(caught instanceof Error ? caught.message : String(caught)));
      },
      'plain-text',
      String(defaultPort),
      'number-pad'
    );
  };

  const actions: Array<{ key: string; label: string; icon: string; primary?: boolean; onPress: () => void }> = [];
  if (isPod && namespace) {
    actions.push({ key: 'logs', label: 'Logs', icon: '≣', primary: true, onPress: () => openLogs() });
    actions.push({
      key: 'exec',
      label: 'Exec',
      icon: '>_',
      onPress: () =>
        onNavigate({
          kind: 'exec',
          namespace,
          name,
          container: firstContainer?.name ?? '',
        }),
    });
    actions.push({ key: 'forward', label: 'Forward', icon: '⇄', onPress: handleForward });
  }
  if (SCALABLE.has(typeKey) && canEdit) {
    actions.push({ key: 'scale', label: 'Scale', icon: '⇅', onPress: handleScale });
  }
  if (RESTARTABLE.has(typeKey) && canEdit) {
    actions.push({ key: 'restart', label: 'Restart', icon: '↺', onPress: handleRestart });
    actions.push({ key: 'image', label: 'Image', icon: '⬡', onPress: handleSetImage });
  }
  if (typeKey === 'apps/Deployment' && canEdit) {
    if (namespace) {
      actions.push({ key: 'rollback', label: 'Undo', icon: '↶', onPress: () => void handleRollback() });
    }
    actions.push({
      key: 'pause',
      label: rolloutPaused ? 'Resume' : 'Pause',
      icon: rolloutPaused ? '▶' : '❚❚',
      onPress: handlePauseResume,
    });
  }
  if (isNode && canEdit) {
    actions.push({
      key: 'cordon',
      label: nodeCordoned ? 'Uncordon' : 'Cordon',
      icon: nodeCordoned ? '▶' : '⊘',
      onPress: handleCordon,
    });
    actions.push({ key: 'drain', label: 'Drain', icon: '⤓', onPress: handleDrain });
  }
  if (typeKey === 'batch/CronJob' && canEdit && namespace) {
    actions.push({ key: 'trigger', label: 'Run now', icon: '▶', onPress: handleTriggerCron });
    actions.push({
      key: 'suspend',
      label: cronSuspended ? 'Resume' : 'Suspend',
      icon: cronSuspended ? '▶' : '❚❚',
      onPress: handleSuspendCron,
    });
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

  const body = (
    <>
      {/* Header */}
      <View style={[styles.header, mode === 'pane' && styles.headerPane]}>
        {mode === 'screen' ? (
          <BackButton onPress={onClose} />
        ) : onBack ? (
          <BackButton onPress={onBack} />
        ) : (
          <CloseButton onPress={onClose} />
        )}
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={styles.headerName} numberOfLines={1}>
            {name}
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
        <TouchableOpacity
          style={styles.starButton}
          onPress={handleToggleFavorite}
          accessibilityLabel={pinned ? 'Unpin' : 'Pin'}
          hitSlop={8}
        >
          <Text style={[styles.starGlyph, pinned && styles.starGlyphActive]}>
            {pinned ? '★' : '☆'}
          </Text>
        </TouchableOpacity>
      </View>

      {loading ? (
        <Loading />
      ) : editing && diff ? (
        <>
          {error ? (
            <View style={styles.errorWrap}>
              <ErrorBox message={error} />
            </View>
          ) : null}
          <Text style={styles.diffSummary}>
            Review changes ·{' '}
            <Text style={{ color: colors.success }}>
              +{diff.filter((line) => line.type === 'add').length}
            </Text>{' '}
            <Text style={{ color: colors.danger }}>
              −{diff.filter((line) => line.type === 'del').length}
            </Text>
          </Text>
          <ScrollView style={styles.flex} contentContainerStyle={styles.diffScroll}>
            {diff.map((line, index) =>
              line.type === 'same' ? (
                <Text key={index} style={styles.diffLine}>
                  {`  ${line.text}` || ' '}
                </Text>
              ) : (
                <Text
                  key={index}
                  style={[
                    styles.diffLine,
                    line.type === 'add' ? styles.diffAdd : styles.diffDel,
                  ]}
                >
                  {`${line.type === 'add' ? '+' : '-'} ${line.text}`}
                </Text>
              )
            )}
          </ScrollView>
          <View style={styles.editActions}>
            <Button title="Apply changes" onPress={() => void handleApply()} busy={busy} />
            <Button title="Keep editing" variant="secondary" onPress={() => setDiff(null)} />
          </View>
        </>
      ) : editing ? (
        <>
          {error ? (
            <View style={styles.errorWrap}>
              <ErrorBox message={error} />
            </View>
          ) : null}
          <YamlEditor value={draft} onChangeText={setDraft} />
          <View style={styles.editActions}>
            <Button title="Review & save" onPress={handleReview} busy={busy} />
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
                Container "{crash.container}" is crash-looping ({crash.restarts} restarts).
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
              {/* Parent resources (ownerReferences, plus the node for pods) */}
              {owners.length > 0 || nodeName ? (
                <Card style={styles.summaryCard}>
                  <Text style={styles.cardTitle}>Owned by</Text>
                  {owners.map(({ ref, ownerType }, index) => (
                    <TouchableOpacity
                      key={`${ref.kind}-${ref.name}`}
                      style={[styles.relatedRow, index > 0 && styles.kvDivider]}
                      disabled={!ownerType}
                      onPress={() => ownerType && openRelated(ownerType, ref.name, namespace)}
                    >
                      <View style={styles.relatedText}>
                        <Text style={styles.relatedName} numberOfLines={1}>
                          {ref.name}
                        </Text>
                        <Text style={styles.relatedDetail}>{ref.kind}</Text>
                      </View>
                      {ownerType ? <Text style={styles.relatedChevron}>›</Text> : null}
                    </TouchableOpacity>
                  ))}
                  {nodeName ? (
                    <TouchableOpacity
                      style={[styles.relatedRow, owners.length > 0 && styles.kvDivider]}
                      onPress={() =>
                        openRelated(typeForOwnerRef({ apiVersion: 'v1', kind: 'Node' }, false)!, nodeName)
                      }
                    >
                      <View style={styles.relatedText}>
                        <Text style={styles.relatedName} numberOfLines={1}>
                          {nodeName}
                        </Text>
                        <Text style={styles.relatedDetail}>Node</Text>
                      </View>
                      <Text style={styles.relatedChevron}>›</Text>
                    </TouchableOpacity>
                  ) : null}
                </Card>
              ) : null}

              <SummaryCards sections={sections} />
              {/* Child resources owned by this one (ReplicaSets, Pods, Jobs …) */}
              {children
                .filter((group) => group.items.length > 0)
                .map((group) => (
                  <Card key={group.type.kind} style={styles.summaryCard}>
                    <Text style={styles.cardTitle}>
                      {group.type.kind}s ({group.items.length})
                    </Text>
                    {group.items.slice(0, 25).map((item, index) => {
                      const info = describeChild(group.type, item.raw);
                      return (
                        <TouchableOpacity
                          key={item.name}
                          style={[styles.relatedRow, index > 0 && styles.kvDivider]}
                          onPress={() => openRelated(group.type, item.name, item.namespace)}
                        >
                          {info.health ? (
                            <StatusDot color={STATUS_COLORS[info.health]} size={8} />
                          ) : null}
                          <View style={styles.relatedText}>
                            <Text style={styles.relatedName} numberOfLines={1}>
                              {item.name}
                            </Text>
                            {info.detail ? (
                              <Text style={styles.relatedDetail}>{info.detail}</Text>
                            ) : null}
                          </View>
                          <Text style={styles.relatedAge}>{ageOf(item.creationTimestamp)}</Text>
                          <Text style={styles.relatedChevron}>›</Text>
                        </TouchableOpacity>
                      );
                    })}
                    {group.items.length > 25 ? (
                      <Text style={styles.relatedMore}>+{group.items.length - 25} more</Text>
                    ) : null}
                  </Card>
                ))}

              {/* Cross-references beyond ownership (Service → Pods, PVC ↔ Pods …) */}
              {related.length > 0 ? (
                <Card style={styles.summaryCard}>
                  <Text style={styles.cardTitle}>Related</Text>
                  {related.map((group) => (
                    <View key={group.title}>
                      <Text style={styles.relatedGroupTitle}>{group.title}</Text>
                      {group.items.map((entry, index) => (
                        <TouchableOpacity
                          key={`${entry.type.kind}/${entry.namespace ?? ''}/${entry.name}`}
                          style={[styles.relatedRow, index > 0 && styles.kvDivider]}
                          onPress={() => openRelated(entry.type, entry.name, entry.namespace)}
                        >
                          <SquircleIcon
                            abbr={abbreviationFor(entry.type)}
                            color={colors.accent}
                            size={24}
                          />
                          <View style={styles.relatedText}>
                            <Text style={styles.relatedName} numberOfLines={1}>
                              {entry.name}
                            </Text>
                          </View>
                          {entry.note ? <Text style={styles.relatedDetail}>{entry.note}</Text> : null}
                          <Text style={styles.relatedChevron}>›</Text>
                        </TouchableOpacity>
                      ))}
                    </View>
                  ))}
                </Card>
              ) : null}

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
    </>
  );

  if (mode === 'pane') {
    return <View style={styles.flex}>{body}</View>;
  }
  return (
    <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      {body}
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
  headerPane: { paddingTop: 16 },
  headerName: { color: colors.text, fontSize: 14, fontWeight: '700' },
  headerSub: { color: 'rgba(242,245,250,0.4)', fontSize: 11.5 },
  statusPill: { borderRadius: radius.pill, paddingHorizontal: 11, paddingVertical: 5 },
  statusPillText: { fontSize: 11, fontWeight: '700' },
  starButton: { paddingHorizontal: 4, paddingVertical: 2 },
  starGlyph: { color: colors.textDim, fontSize: 22, fontWeight: '600' },
  starGlyphActive: { color: colors.warning },
  errorWrap: { paddingHorizontal: spacing.lg, paddingTop: spacing.md },
  scroll: { padding: spacing.lg, paddingTop: 8, paddingBottom: 60, gap: 12 },
  actionGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  actionCell: {
    flexGrow: 1,
    flexBasis: '18%',
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
  relatedGroupTitle: {
    color: colors.textDim,
    fontSize: 11,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.4,
    paddingTop: 8,
    paddingBottom: 4,
  },
  relatedRow: { flexDirection: 'row', alignItems: 'center', gap: 9, paddingVertical: 9 },
  relatedText: { flex: 1, minWidth: 0, gap: 2 },
  relatedName: { color: colors.text, fontSize: 13, fontWeight: '600' },
  relatedDetail: { color: colors.textDim, fontSize: 11.5 },
  relatedAge: { color: colors.textFaint, fontSize: 10.5 },
  relatedChevron: { color: 'rgba(242,245,250,0.22)', fontSize: 18, fontWeight: '600' },
  relatedMore: { color: colors.textFaint, fontSize: 11.5, paddingTop: 8 },
  eventRow: { paddingVertical: 7 },
  eventMessage: { color: colors.text, fontSize: 12.5, marginTop: 2, marginLeft: 14, lineHeight: 18 },
  yamlCard: { borderRadius: radius.card, backgroundColor: colors.backgroundDeep },
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
  diffSummary: {
    color: colors.textMid,
    fontSize: 12.5,
    fontWeight: '600',
    paddingHorizontal: spacing.lg,
    paddingVertical: 8,
  },
  diffScroll: { padding: spacing.lg, paddingTop: 4, paddingBottom: 24 },
  diffLine: { color: colors.mono, fontFamily: 'Menlo', fontSize: 10.5, lineHeight: 17 },
  diffAdd: { color: colors.success, backgroundColor: 'rgba(52,211,153,0.1)' },
  diffDel: { color: colors.danger, backgroundColor: 'rgba(251,113,133,0.1)' },
  editActions: { padding: spacing.lg },
});
