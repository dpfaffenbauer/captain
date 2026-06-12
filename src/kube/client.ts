import { ApiResourceType, ClusterConfig, KubeList, KubeListItem } from '../types';
import { kubeRequest, kubeRequestJson } from './transport';

interface ApiGroupList {
  groups: Array<{
    name: string;
    preferredVersion?: { groupVersion: string; version: string };
    versions: Array<{ groupVersion: string; version: string }>;
  }>;
}

interface ApiResourceList {
  groupVersion: string;
  resources: Array<{
    name: string;
    kind: string;
    namespaced: boolean;
    verbs: string[];
  }>;
}

function parseResourceList(group: string, version: string, list: ApiResourceList): ApiResourceType[] {
  return (list.resources ?? [])
    .filter((resource) => !resource.name.includes('/'))
    .map((resource) => ({
      group,
      version,
      plural: resource.name,
      kind: resource.kind,
      namespaced: resource.namespaced,
      verbs: resource.verbs ?? [],
    }));
}

/**
 * Discovers every resource type the API server exposes (core, named groups
 * and CRDs) via the discovery endpoints.
 */
export async function discoverResourceTypes(cluster: ClusterConfig): Promise<ApiResourceType[]> {
  const [core, groups] = await Promise.all([
    kubeRequestJson<ApiResourceList>(cluster, '/api/v1'),
    kubeRequestJson<ApiGroupList>(cluster, '/apis'),
  ]);

  const result: ApiResourceType[] = parseResourceList('', 'v1', core);

  const groupFetches = (groups.groups ?? []).map(async (group) => {
    const version = group.preferredVersion?.version ?? group.versions[0]?.version;
    if (!version) return [];
    const list = await kubeRequestJson<ApiResourceList>(
      cluster,
      `/apis/${group.name}/${version}`
    );
    return parseResourceList(group.name, version, list);
  });

  const settled = await Promise.allSettled(groupFetches);
  for (const entry of settled) {
    if (entry.status === 'fulfilled') result.push(...entry.value);
  }

  result.sort((a, b) => a.kind.localeCompare(b.kind) || a.group.localeCompare(b.group));
  return result;
}

export function resourceBasePath(type: ApiResourceType, namespace?: string): string {
  const prefix = type.group === '' ? '/api/v1' : `/apis/${type.group}/${type.version}`;
  if (type.namespaced && namespace) {
    return `${prefix}/namespaces/${encodeURIComponent(namespace)}/${type.plural}`;
  }
  return `${prefix}/${type.plural}`;
}

export async function listResources(
  cluster: ClusterConfig,
  type: ApiResourceType,
  options: { namespace?: string; limit?: number; continueToken?: string } = {}
): Promise<KubeList> {
  const params = new URLSearchParams();
  params.set('limit', String(options.limit ?? 200));
  if (options.continueToken) params.set('continue', options.continueToken);

  const body = await kubeRequestJson<{
    items?: Array<{ metadata?: { name?: string; namespace?: string; creationTimestamp?: string } }>;
    metadata?: { continue?: string };
  }>(cluster, `${resourceBasePath(type, options.namespace)}?${params.toString()}`);

  const items: KubeListItem[] = (body.items ?? []).map((item) => ({
    name: item.metadata?.name ?? '',
    namespace: item.metadata?.namespace,
    creationTimestamp: item.metadata?.creationTimestamp,
    raw: item as Record<string, unknown>,
  }));
  return { items, continueToken: body.metadata?.continue || undefined };
}

export async function getResource(
  cluster: ClusterConfig,
  type: ApiResourceType,
  name: string,
  namespace?: string
): Promise<Record<string, unknown>> {
  return kubeRequestJson<Record<string, unknown>>(
    cluster,
    `${resourceBasePath(type, namespace)}/${encodeURIComponent(name)}`
  );
}

export async function replaceResource(
  cluster: ClusterConfig,
  type: ApiResourceType,
  name: string,
  manifest: Record<string, unknown>,
  namespace?: string
): Promise<Record<string, unknown>> {
  return kubeRequestJson<Record<string, unknown>>(
    cluster,
    `${resourceBasePath(type, namespace)}/${encodeURIComponent(name)}`,
    { method: 'PUT', body: JSON.stringify(manifest) }
  );
}

export async function deleteResource(
  cluster: ClusterConfig,
  type: ApiResourceType,
  name: string,
  namespace?: string
): Promise<void> {
  await kubeRequest(cluster, `${resourceBasePath(type, namespace)}/${encodeURIComponent(name)}`, {
    method: 'DELETE',
  });
}

/** Scales a workload via the /scale subresource (Deployment, STS, RS, RC). */
export async function scaleResource(
  cluster: ClusterConfig,
  type: ApiResourceType,
  name: string,
  replicas: number,
  namespace?: string
): Promise<void> {
  await kubeRequest(
    cluster,
    `${resourceBasePath(type, namespace)}/${encodeURIComponent(name)}/scale`,
    {
      method: 'PATCH',
      body: JSON.stringify({ spec: { replicas } }),
      contentType: 'application/merge-patch+json',
    }
  );
}

/** Pauses or resumes a Deployment rollout like `kubectl rollout pause/resume`. */
export async function setRolloutPaused(
  cluster: ClusterConfig,
  type: ApiResourceType,
  name: string,
  paused: boolean,
  namespace?: string
): Promise<void> {
  await kubeRequest(cluster, `${resourceBasePath(type, namespace)}/${encodeURIComponent(name)}`, {
    method: 'PATCH',
    body: JSON.stringify({ spec: { paused: paused ? true : null } }),
    contentType: 'application/merge-patch+json',
  });
}

/** Updates a single container image like `kubectl set image`. */
export async function setContainerImage(
  cluster: ClusterConfig,
  type: ApiResourceType,
  name: string,
  container: string,
  image: string,
  namespace?: string
): Promise<void> {
  const patch = {
    spec: { template: { spec: { containers: [{ name: container, image }] } } },
  };
  await kubeRequest(cluster, `${resourceBasePath(type, namespace)}/${encodeURIComponent(name)}`, {
    method: 'PATCH',
    body: JSON.stringify(patch),
    contentType: 'application/strategic-merge-patch+json',
  });
}

export interface DeploymentRevision {
  revision: number;
  replicaSet: string;
  images: string[];
  changeCause?: string;
  current: boolean;
  template: Record<string, any>;
}

const REVISION_ANNOTATION = 'deployment.kubernetes.io/revision';

/** Rollout history of a Deployment, newest first (kubectl rollout history). */
export async function listDeploymentRevisions(
  cluster: ClusterConfig,
  namespace: string,
  name: string
): Promise<DeploymentRevision[]> {
  const prefix = `/apis/apps/v1/namespaces/${encodeURIComponent(namespace)}`;
  const deployment = await kubeRequestJson<any>(
    cluster,
    `${prefix}/deployments/${encodeURIComponent(name)}`
  );
  const matchLabels: Record<string, string> = deployment.spec?.selector?.matchLabels ?? {};
  const selector = Object.entries(matchLabels)
    .map(([key, value]) => `${key}=${value}`)
    .join(',');
  const list = await kubeRequestJson<{ items?: any[] }>(
    cluster,
    `${prefix}/replicasets?labelSelector=${encodeURIComponent(selector)}&limit=500`
  );
  const uid = deployment.metadata?.uid;
  const currentRevision = Number(deployment.metadata?.annotations?.[REVISION_ANNOTATION] ?? NaN);
  const revisions = (list.items ?? [])
    .filter((rs) => (rs.metadata?.ownerReferences ?? []).some((ref: any) => ref.uid === uid))
    .map((rs): DeploymentRevision => {
      const revision = Number(rs.metadata?.annotations?.[REVISION_ANNOTATION] ?? 0);
      return {
        revision,
        replicaSet: rs.metadata?.name ?? '',
        images: (rs.spec?.template?.spec?.containers ?? []).map((c: any) => String(c.image ?? '')),
        changeCause: rs.metadata?.annotations?.['kubernetes.io/change-cause'],
        current: revision === currentRevision,
        template: rs.spec?.template ?? {},
      };
    });
  revisions.sort((a, b) => b.revision - a.revision);
  return revisions;
}

/** Rolls a Deployment back to the given revision like `kubectl rollout undo`. */
export async function rollbackDeployment(
  cluster: ClusterConfig,
  namespace: string,
  name: string,
  revision: DeploymentRevision
): Promise<void> {
  const template = JSON.parse(JSON.stringify(revision.template));
  // kubectl strips the RS-managed hash label before re-applying the template.
  delete template?.metadata?.labels?.['pod-template-hash'];
  const patch = [{ op: 'replace', path: '/spec/template', value: template }];
  await kubeRequest(
    cluster,
    `/apis/apps/v1/namespaces/${encodeURIComponent(namespace)}/deployments/${encodeURIComponent(name)}`,
    { method: 'PATCH', body: JSON.stringify(patch), contentType: 'application/json-patch+json' }
  );
}

/** Suspends or resumes a CronJob's schedule. */
export async function setCronJobSuspended(
  cluster: ClusterConfig,
  type: ApiResourceType,
  name: string,
  suspend: boolean,
  namespace?: string
): Promise<void> {
  await kubeRequest(cluster, `${resourceBasePath(type, namespace)}/${encodeURIComponent(name)}`, {
    method: 'PATCH',
    body: JSON.stringify({ spec: { suspend } }),
    contentType: 'application/merge-patch+json',
  });
}

/** Creates a one-off Job from a CronJob like `kubectl create job --from=cronjob/<name>`. */
export async function triggerCronJob(
  cluster: ClusterConfig,
  type: ApiResourceType,
  name: string,
  namespace: string
): Promise<string> {
  const cron = await kubeRequestJson<any>(
    cluster,
    `${resourceBasePath(type, namespace)}/${encodeURIComponent(name)}`
  );
  const jobName = `${name.slice(0, 40)}-manual-${Date.now().toString(36)}`;
  const job = {
    apiVersion: 'batch/v1',
    kind: 'Job',
    metadata: {
      name: jobName,
      namespace,
      annotations: { 'cronjob.kubernetes.io/instantiate': 'manual' },
      labels: cron.spec?.jobTemplate?.metadata?.labels,
    },
    spec: cron.spec?.jobTemplate?.spec,
  };
  await kubeRequest(cluster, `/apis/batch/v1/namespaces/${encodeURIComponent(namespace)}/jobs`, {
    method: 'POST',
    body: JSON.stringify(job),
  });
  return jobName;
}

/** Triggers a rolling restart like `kubectl rollout restart`. */
export async function restartRollout(
  cluster: ClusterConfig,
  type: ApiResourceType,
  name: string,
  namespace?: string
): Promise<void> {
  const patch = {
    spec: {
      template: {
        metadata: {
          annotations: { 'kubectl.kubernetes.io/restartedAt': new Date().toISOString() },
        },
      },
    },
  };
  await kubeRequest(cluster, `${resourceBasePath(type, namespace)}/${encodeURIComponent(name)}`, {
    method: 'PATCH',
    body: JSON.stringify(patch),
    contentType: 'application/strategic-merge-patch+json',
  });
}

export interface ResourceEvent {
  type: string;
  reason: string;
  message: string;
  count?: number;
  lastTimestamp?: string;
}

/** Events that reference the given object (kubectl describe style). */
export async function listEventsFor(
  cluster: ClusterConfig,
  kind: string,
  name: string,
  namespace?: string
): Promise<ResourceEvent[]> {
  const fieldSelector = encodeURIComponent(
    `involvedObject.name=${name},involvedObject.kind=${kind}`
  );
  const path = namespace
    ? `/api/v1/namespaces/${encodeURIComponent(namespace)}/events?fieldSelector=${fieldSelector}&limit=50`
    : `/api/v1/events?fieldSelector=${fieldSelector}&limit=50`;
  const body = await kubeRequestJson<{ items?: any[] }>(cluster, path);
  return (body.items ?? []).map((item) => ({
    type: item.type ?? '',
    reason: item.reason ?? '',
    message: item.message ?? '',
    count: item.count,
    lastTimestamp: item.lastTimestamp ?? item.eventTime,
  }));
}

export interface ClusterEvent extends ResourceEvent {
  /** "kind/name" of the involved object. */
  object: string;
  namespace?: string;
}

/** Recent events, cluster-wide or per namespace, newest first. */
export async function listClusterEvents(
  cluster: ClusterConfig,
  namespace?: string,
  limit = 100
): Promise<ClusterEvent[]> {
  const path = namespace
    ? `/api/v1/namespaces/${encodeURIComponent(namespace)}/events?limit=${limit}`
    : `/api/v1/events?limit=${limit}`;
  const body = await kubeRequestJson<{ items?: any[] }>(cluster, path);
  const events = (body.items ?? []).map((item) => ({
    type: item.type ?? '',
    reason: item.reason ?? '',
    message: item.message ?? '',
    count: item.count,
    lastTimestamp: item.lastTimestamp ?? item.eventTime ?? item.metadata?.creationTimestamp,
    namespace: item.involvedObject?.namespace ?? item.metadata?.namespace,
    object: item.involvedObject
      ? `${String(item.involvedObject.kind ?? '').toLowerCase()}/${item.involvedObject.name ?? ''}`
      : '',
  }));
  events.sort((a, b) => Date.parse(b.lastTimestamp ?? '') - Date.parse(a.lastTimestamp ?? ''));
  return events;
}

export async function getPodLogs(
  cluster: ClusterConfig,
  namespace: string,
  name: string,
  options: { container?: string; tailLines?: number; previous?: boolean } = {}
): Promise<string> {
  const params = new URLSearchParams();
  params.set('tailLines', String(options.tailLines ?? 500));
  if (options.container) params.set('container', options.container);
  if (options.previous) params.set('previous', 'true');
  return kubeRequest(
    cluster,
    `/api/v1/namespaces/${encodeURIComponent(namespace)}/pods/${encodeURIComponent(name)}/log?${params.toString()}`
  );
}

export async function listNamespaces(cluster: ClusterConfig): Promise<string[]> {
  const body = await kubeRequestJson<{ items?: Array<{ metadata?: { name?: string } }> }>(
    cluster,
    '/api/v1/namespaces?limit=500'
  );
  return (body.items ?? [])
    .map((item) => item.metadata?.name ?? '')
    .filter((name) => name.length > 0);
}

export async function getServerVersion(cluster: ClusterConfig): Promise<string> {
  const body = await kubeRequestJson<{ gitVersion?: string }>(cluster, '/version');
  return body.gitVersion ?? 'unbekannt';
}
