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
