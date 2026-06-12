import { ApiResourceType, ClusterConfig, KubeListItem } from '../types';
import { resourceBasePath } from './client';
import { kubeRequestJson } from './transport';

/**
 * Well-known types we can navigate to without running API discovery again.
 * Keyed by "group/Kind"; verbs stay empty which the item screen treats as
 * "allow everything" (the API server still enforces RBAC).
 */
const KNOWN_TYPES: Record<string, ApiResourceType> = {
  '/Pod': { group: '', version: 'v1', plural: 'pods', kind: 'Pod', namespaced: true, verbs: [] },
  '/Node': { group: '', version: 'v1', plural: 'nodes', kind: 'Node', namespaced: false, verbs: [] },
  '/Service': { group: '', version: 'v1', plural: 'services', kind: 'Service', namespaced: true, verbs: [] },
  '/ReplicationController': {
    group: '',
    version: 'v1',
    plural: 'replicationcontrollers',
    kind: 'ReplicationController',
    namespaced: true,
    verbs: [],
  },
  'apps/Deployment': { group: 'apps', version: 'v1', plural: 'deployments', kind: 'Deployment', namespaced: true, verbs: [] },
  'apps/ReplicaSet': { group: 'apps', version: 'v1', plural: 'replicasets', kind: 'ReplicaSet', namespaced: true, verbs: [] },
  'apps/StatefulSet': { group: 'apps', version: 'v1', plural: 'statefulsets', kind: 'StatefulSet', namespaced: true, verbs: [] },
  'apps/DaemonSet': { group: 'apps', version: 'v1', plural: 'daemonsets', kind: 'DaemonSet', namespaced: true, verbs: [] },
  'batch/Job': { group: 'batch', version: 'v1', plural: 'jobs', kind: 'Job', namespaced: true, verbs: [] },
  'batch/CronJob': { group: 'batch', version: 'v1', plural: 'cronjobs', kind: 'CronJob', namespaced: true, verbs: [] },
};

/** Best-effort English pluralization for kinds outside KNOWN_TYPES (CRD owners etc.). */
function pluralize(kind: string): string {
  const lower = kind.toLowerCase();
  if (/(s|x|z|ch|sh)$/.test(lower)) return `${lower}es`;
  if (/[^aeiou]y$/.test(lower)) return `${lower.slice(0, -1)}ies`;
  return `${lower}s`;
}

/**
 * Resolves an ownerReference to a navigable resource type. Falls back to a
 * pluralization heuristic for unknown (custom) kinds.
 */
export function typeForOwnerRef(
  ref: { apiVersion?: string; kind?: string },
  childNamespaced: boolean
): ApiResourceType | undefined {
  if (!ref.kind || !ref.apiVersion) return undefined;
  const slash = ref.apiVersion.indexOf('/');
  const group = slash === -1 ? '' : ref.apiVersion.slice(0, slash);
  const version = slash === -1 ? ref.apiVersion : ref.apiVersion.slice(slash + 1);
  const known = KNOWN_TYPES[`${group}/${ref.kind}`];
  if (known) return { ...known, version: version || known.version };
  return {
    group,
    version: version || 'v1',
    plural: pluralize(ref.kind),
    kind: ref.kind,
    // Owners live in the same namespace as the child (or are cluster-scoped,
    // which we cannot tell here — same namespace is the common case).
    namespaced: childNamespaced,
    verbs: [],
  };
}

/**
 * Child kinds per parent, as a chain: each level is owned by the previous one
 * (Deployment → ReplicaSets → Pods).
 */
const CHILD_CHAIN: Record<string, string[]> = {
  'apps/Deployment': ['apps/ReplicaSet', '/Pod'],
  'apps/ReplicaSet': ['/Pod'],
  'apps/StatefulSet': ['/Pod'],
  'apps/DaemonSet': ['/Pod'],
  '/ReplicationController': ['/Pod'],
  'batch/Job': ['/Pod'],
  'batch/CronJob': ['batch/Job'],
};

export interface ChildGroup {
  type: ApiResourceType;
  items: KubeListItem[];
}

/**
 * Lists the resources owned (via ownerReferences) by the given manifest,
 * grouped by kind. Uses the parent's label selector to keep list calls small
 * where one exists, then filters by owner UID for exactness.
 */
export async function listOwnedResources(
  cluster: ClusterConfig,
  type: ApiResourceType,
  manifest: Record<string, unknown>
): Promise<ChildGroup[]> {
  const chain = CHILD_CHAIN[`${type.group}/${type.kind}`];
  const metadata = (manifest as any).metadata ?? {};
  const namespace: string | undefined = metadata.namespace;
  const uid: string | undefined = metadata.uid;
  if (!chain || !uid || !namespace) return [];

  const matchLabels: Record<string, string> = (manifest as any).spec?.selector?.matchLabels ?? {};
  const labelSelector = Object.entries(matchLabels)
    .map(([key, value]) => `${key}=${value}`)
    .join(',');

  const groups: ChildGroup[] = [];
  let parentUids = new Set<string>([uid]);
  for (const key of chain) {
    const childType = KNOWN_TYPES[key];
    const params = new URLSearchParams();
    params.set('limit', '500');
    if (labelSelector) params.set('labelSelector', labelSelector);
    const body = await kubeRequestJson<{ items?: any[] }>(
      cluster,
      `${resourceBasePath(childType, namespace)}?${params.toString()}`
    );
    const owned = (body.items ?? []).filter((item) =>
      ((item.metadata?.ownerReferences ?? []) as any[]).some((ref) => parentUids.has(ref.uid))
    );
    owned.sort(
      (a, b) =>
        Date.parse(b.metadata?.creationTimestamp ?? '') -
        Date.parse(a.metadata?.creationTimestamp ?? '')
    );
    groups.push({
      type: childType,
      items: owned.map((item) => ({
        name: item.metadata?.name ?? '',
        namespace: item.metadata?.namespace,
        creationTimestamp: item.metadata?.creationTimestamp,
        raw: item as Record<string, unknown>,
      })),
    });
    parentUids = new Set(owned.map((item) => item.metadata?.uid).filter(Boolean));
    if (parentUids.size === 0) break;
  }
  return groups;
}

export type ChildHealth = 'ok' | 'warn' | 'bad';

export interface ChildInfo {
  detail: string;
  health?: ChildHealth;
}

/** One-line status for a child row in the related-resources cards. */
export function describeChild(type: ApiResourceType, raw: any): ChildInfo {
  const key = `${type.group}/${type.kind}`;
  if (key === '/Pod') {
    const phase = raw.status?.phase ?? 'Unknown';
    const statuses: any[] = raw.status?.containerStatuses ?? [];
    const waiting = statuses.find((s) => s.state?.waiting)?.state?.waiting?.reason;
    const ready = statuses.filter((s) => s.ready).length;
    const total = statuses.length || (raw.spec?.containers ?? []).length;
    const restarts = statuses.reduce((sum, s) => sum + (s.restartCount ?? 0), 0);
    const label = waiting && phase !== 'Succeeded' ? waiting : phase;
    const health: ChildHealth =
      waiting === 'CrashLoopBackOff' || phase === 'Failed'
        ? 'bad'
        : phase === 'Pending' || waiting
          ? 'warn'
          : phase === 'Running' || phase === 'Succeeded'
            ? 'ok'
            : 'warn';
    return {
      detail: `${label} · ${ready}/${total}${restarts > 0 ? ` · ${restarts} restarts` : ''}`,
      health,
    };
  }
  if (key === 'apps/ReplicaSet' || key === '/ReplicationController') {
    const desired = raw.spec?.replicas ?? 0;
    const ready = raw.status?.readyReplicas ?? 0;
    if (desired === 0) return { detail: 'auf 0 skaliert' };
    return { detail: `${ready}/${desired} bereit`, health: ready >= desired ? 'ok' : 'warn' };
  }
  if (key === 'batch/Job') {
    const completions = raw.spec?.completions ?? 1;
    const succeeded = raw.status?.succeeded ?? 0;
    const failed = raw.status?.failed ?? 0;
    const active = raw.status?.active ?? 0;
    if (active > 0) return { detail: `läuft · ${succeeded}/${completions}`, health: 'warn' };
    if (succeeded >= completions) return { detail: `${succeeded}/${completions} abgeschlossen`, health: 'ok' };
    if (failed > 0) return { detail: `fehlgeschlagen (${failed}×)`, health: 'bad' };
    return { detail: `${succeeded}/${completions} abgeschlossen`, health: 'warn' };
  }
  return { detail: '' };
}
