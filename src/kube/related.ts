import { ApiResourceType, ClusterConfig, KubeListItem } from '../types';
import { discoverResourceTypesCached, listResources } from './client';

/**
 * "Related resources" for the detail view: owners via ownerReferences,
 * children via label selectors, plus kind-specific links (pod → node/PVCs,
 * ingress → services, PVC → volume/pods). Everything resolves against the
 * discovery cache so each entry can be navigated to.
 */

export interface RelatedItem {
  type: ApiResourceType;
  name: string;
  namespace?: string;
  /** Short annotation shown next to the name (e.g. pod phase). */
  note?: string;
}

export interface RelatedGroup {
  title: string;
  items: RelatedItem[];
}

function selectorOf(matchLabels: Record<string, string> | undefined): string {
  return Object.entries(matchLabels ?? {})
    .map(([key, value]) => `${key}=${value}`)
    .join(',');
}

function groupOfApiVersion(apiVersion: string | undefined): string {
  if (!apiVersion) return '';
  const slash = apiVersion.indexOf('/');
  return slash >= 0 ? apiVersion.slice(0, slash) : '';
}

export async function findRelatedResources(
  cluster: ClusterConfig,
  type: ApiResourceType,
  manifest: Record<string, unknown>
): Promise<RelatedGroup[]> {
  const types = await discoverResourceTypesCached(cluster);
  const typeFor = (group: string, kind: string): ApiResourceType | undefined =>
    types.find((entry) => entry.group === group && entry.kind === kind);

  const metadata = (manifest.metadata ?? {}) as any;
  const spec = (manifest.spec ?? {}) as any;
  const namespace: string | undefined = metadata.namespace;
  const typeKey = `${type.group}/${type.kind}`;
  const groups: RelatedGroup[] = [];

  // Owners (every kind).
  const owners: RelatedItem[] = [];
  for (const ref of (metadata.ownerReferences ?? []) as any[]) {
    const ownerType = typeFor(groupOfApiVersion(ref.apiVersion), ref.kind);
    if (ownerType) {
      owners.push({ type: ownerType, name: ref.name, namespace });
    }
  }
  if (owners.length > 0) groups.push({ title: 'Owned by', items: owners });

  const childList = async (
    title: string,
    childType: ApiResourceType | undefined,
    options: { labelSelector?: string; fieldSelector?: string; limit?: number },
    filter?: (item: KubeListItem) => boolean,
    note?: (item: KubeListItem) => string | undefined
  ) => {
    if (!childType) return;
    if (options.labelSelector === '') return;
    try {
      const result = await listResources(cluster, childType, {
        namespace: childType.namespaced ? namespace : undefined,
        limit: 50,
        ...options,
      });
      const items = result.items
        .filter((item) => (filter ? filter(item) : true))
        .map((item) => ({
          type: childType,
          name: item.name,
          namespace: item.namespace,
          note: note?.(item),
        }));
      if (items.length > 0) groups.push({ title, items });
    } catch {
      // Related lookups are best-effort; RBAC may forbid individual lists.
    }
  };

  const podNote = (item: KubeListItem) => (item.raw as any).status?.phase as string | undefined;
  const ownedBy = (uid: string) => (item: KubeListItem) =>
    ((item.raw as any).metadata?.ownerReferences ?? []).some((ref: any) => ref.uid === uid);

  if (typeKey === 'apps/Deployment') {
    const selector = selectorOf(spec.selector?.matchLabels);
    await childList('ReplicaSets', typeFor('apps', 'ReplicaSet'), { labelSelector: selector }, ownedBy(metadata.uid));
    await childList('Pods', typeFor('', 'Pod'), { labelSelector: selector }, undefined, podNote);
  } else if (
    typeKey === 'apps/ReplicaSet' ||
    typeKey === 'apps/StatefulSet' ||
    typeKey === 'apps/DaemonSet' ||
    typeKey === 'batch/Job'
  ) {
    const selector = selectorOf(spec.selector?.matchLabels);
    await childList('Pods', typeFor('', 'Pod'), { labelSelector: selector }, undefined, podNote);
  } else if (typeKey === 'batch/CronJob') {
    await childList('Jobs', typeFor('batch', 'Job'), {}, ownedBy(metadata.uid));
  } else if (typeKey === '/Service') {
    const selector = selectorOf(spec.selector);
    await childList('Pods', typeFor('', 'Pod'), { labelSelector: selector }, undefined, podNote);
  } else if (typeKey === 'networking.k8s.io/Ingress') {
    const serviceType = typeFor('', 'Service');
    if (serviceType) {
      const names = new Set<string>();
      const backendName = (backend: any) => backend?.service?.name as string | undefined;
      const fromDefault = backendName(spec.defaultBackend);
      if (fromDefault) names.add(fromDefault);
      for (const rule of (spec.rules ?? []) as any[]) {
        for (const path of rule.http?.paths ?? []) {
          const name = backendName(path.backend);
          if (name) names.add(name);
        }
      }
      if (names.size > 0) {
        groups.push({
          title: 'Services',
          items: [...names].map((name) => ({ type: serviceType, name, namespace })),
        });
      }
    }
  } else if (typeKey === '/PersistentVolumeClaim') {
    const volumeName = spec.volumeName as string | undefined;
    const pvType = typeFor('', 'PersistentVolume');
    if (volumeName && pvType) {
      groups.push({ title: 'Volume', items: [{ type: pvType, name: volumeName }] });
    }
    await childList(
      'Mounted by',
      typeFor('', 'Pod'),
      { limit: 200 },
      (item) =>
        (((item.raw as any).spec?.volumes ?? []) as any[]).some(
          (volume) => volume.persistentVolumeClaim?.claimName === metadata.name
        ),
      podNote
    );
  } else if (typeKey === '/Pod') {
    const nodeType = typeFor('', 'Node');
    if (spec.nodeName && nodeType) {
      groups.push({ title: 'Node', items: [{ type: nodeType, name: spec.nodeName }] });
    }
    const pvcType = typeFor('', 'PersistentVolumeClaim');
    if (pvcType) {
      const claims = ((spec.volumes ?? []) as any[])
        .map((volume) => volume.persistentVolumeClaim?.claimName as string | undefined)
        .filter((name): name is string => !!name);
      if (claims.length > 0) {
        groups.push({
          title: 'Volumes',
          items: claims.map((name) => ({ type: pvcType, name, namespace })),
        });
      }
    }
  }

  return groups;
}
