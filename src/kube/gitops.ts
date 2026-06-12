import { ApiResourceType, ClusterConfig } from '../types';
import { discoverResourceTypesCached } from './client';
import { kubeRequest, kubeRequestJson } from './transport';

/**
 * Curated view over the GitOps controllers' CRDs: Argo CD Applications and
 * Flux Kustomizations/HelmReleases. Both are read and reconciled purely
 * through the API server — Argo picks up the `.operation` field, Flux the
 * reconcile.fluxcd.io/requestedAt annotation.
 */

export type GitOpsSource = 'argocd' | 'flux';

export interface GitOpsApp {
  source: GitOpsSource;
  type: ApiResourceType;
  name: string;
  namespace: string;
  /** Argo: Synced/OutOfSync · Flux: Ready/NotReady/Reconciling. */
  syncStatus: string;
  /** Argo health: Healthy/Progressing/Degraded/Missing … */
  healthStatus?: string;
  revision?: string;
  message?: string;
  suspended?: boolean;
}

const GITOPS_KINDS: Array<{ group: string; kind: string; source: GitOpsSource }> = [
  { group: 'argoproj.io', kind: 'Application', source: 'argocd' },
  { group: 'kustomize.toolkit.fluxcd.io', kind: 'Kustomization', source: 'flux' },
  { group: 'helm.toolkit.fluxcd.io', kind: 'HelmRelease', source: 'flux' },
];

export async function findGitOpsTypes(
  cluster: ClusterConfig
): Promise<Array<{ type: ApiResourceType; source: GitOpsSource }>> {
  const types = await discoverResourceTypesCached(cluster);
  const found: Array<{ type: ApiResourceType; source: GitOpsSource }> = [];
  for (const def of GITOPS_KINDS) {
    const type = types.find((entry) => entry.group === def.group && entry.kind === def.kind);
    if (type) found.push({ type, source: def.source });
  }
  return found;
}

function parseArgoApp(type: ApiResourceType, raw: any): GitOpsApp {
  return {
    source: 'argocd',
    type,
    name: raw.metadata?.name ?? '',
    namespace: raw.metadata?.namespace ?? '',
    syncStatus: raw.status?.sync?.status ?? 'Unknown',
    healthStatus: raw.status?.health?.status,
    revision: (raw.status?.sync?.revision as string | undefined)?.slice(0, 10),
    message: raw.status?.conditions?.find((c: any) => c.type?.includes('Error'))?.message,
  };
}

function parseFluxResource(type: ApiResourceType, raw: any): GitOpsApp {
  const ready = (raw.status?.conditions ?? []).find((c: any) => c.type === 'Ready');
  const reconciling = (raw.status?.conditions ?? []).some(
    (c: any) => c.type === 'Reconciling' && c.status === 'True'
  );
  return {
    source: 'flux',
    type,
    name: raw.metadata?.name ?? '',
    namespace: raw.metadata?.namespace ?? '',
    syncStatus:
      ready?.status === 'True' ? 'Ready' : reconciling ? 'Reconciling' : 'NotReady',
    revision: (raw.status?.lastAppliedRevision as string | undefined)
      ?.split(':')
      .pop()
      ?.slice(0, 10),
    message: ready?.status === 'True' ? undefined : ready?.message,
    suspended: raw.spec?.suspend === true,
  };
}

export async function listGitOpsApps(cluster: ClusterConfig): Promise<GitOpsApp[]> {
  const found = await findGitOpsTypes(cluster);
  const apps: GitOpsApp[] = [];
  await Promise.all(
    found.map(async ({ type, source }) => {
      const prefix = `/apis/${type.group}/${type.version}`;
      const body = await kubeRequestJson<{ items?: any[] }>(
        cluster,
        `${prefix}/${type.plural}?limit=500`
      );
      for (const raw of body.items ?? []) {
        apps.push(source === 'argocd' ? parseArgoApp(type, raw) : parseFluxResource(type, raw));
      }
    })
  );
  apps.sort((a, b) => a.name.localeCompare(b.name) || a.namespace.localeCompare(b.namespace));
  return apps;
}

function resourcePath(app: GitOpsApp): string {
  return `/apis/${app.type.group}/${app.type.version}/namespaces/${encodeURIComponent(
    app.namespace
  )}/${app.type.plural}/${encodeURIComponent(app.name)}`;
}

/**
 * Triggers a reconciliation: Argo CD via the `.operation.sync` field the
 * application controller watches, Flux via the requestedAt annotation.
 */
export async function triggerSync(cluster: ClusterConfig, app: GitOpsApp): Promise<void> {
  if (app.source === 'argocd') {
    await kubeRequest(cluster, resourcePath(app), {
      method: 'PATCH',
      body: JSON.stringify({
        operation: {
          initiatedBy: { username: 'captain' },
          sync: { prune: false },
        },
      }),
      contentType: 'application/merge-patch+json',
    });
    return;
  }
  await kubeRequest(cluster, resourcePath(app), {
    method: 'PATCH',
    body: JSON.stringify({
      metadata: {
        annotations: { 'reconcile.fluxcd.io/requestedAt': new Date().toISOString() },
      },
    }),
    contentType: 'application/merge-patch+json',
  });
}
