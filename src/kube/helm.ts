import pako from 'pako';
import { ClusterConfig } from '../types';
import { base64Decode } from '../util/base64';
import { kubeRequestJson } from './transport';

/**
 * Helm v3 stores each release revision as a Secret of type
 * helm.sh/release.v1 named "sh.helm.release.v1.<name>.v<revision>", labelled
 * with name/owner/status/version and carrying the release payload as
 * base64(gzip(JSON)) in data.release. Everything here works through the
 * existing API-server connection — no Helm CLI or tiller-style backend.
 */

export interface HelmRelease {
  name: string;
  namespace: string;
  revision: number;
  /** deployed, superseded, failed, pending-install, uninstalling … */
  status: string;
  secretName: string;
}

export interface HelmRevision {
  revision: number;
  status: string;
  secretName: string;
  /** Modification timestamp of the revision secret. */
  updated?: string;
}

export interface HelmReleaseDetail {
  chart: string;
  chartVersion: string;
  appVersion?: string;
  description?: string;
  status: string;
  firstDeployed?: string;
  lastDeployed?: string;
  notes?: string;
  /** User-supplied values (helm get values). */
  values?: Record<string, unknown>;
  /** Rendered manifest (helm get manifest). */
  manifest?: string;
}

interface SecretListItem {
  metadata?: {
    name?: string;
    namespace?: string;
    creationTimestamp?: string;
    labels?: Record<string, string>;
  };
  data?: Record<string, string>;
}

function secretsPath(namespace?: string): string {
  return namespace
    ? `/api/v1/namespaces/${encodeURIComponent(namespace)}/secrets`
    : '/api/v1/secrets';
}

function parseRevisionMeta(item: SecretListItem): HelmRelease | null {
  const labels = item.metadata?.labels ?? {};
  const name = labels.name;
  const namespace = item.metadata?.namespace;
  const revision = parseInt(labels.version ?? '', 10);
  if (!name || !namespace || Number.isNaN(revision)) return null;
  return {
    name,
    namespace,
    revision,
    status: labels.status ?? 'unknown',
    secretName: item.metadata?.name ?? '',
  };
}

/**
 * Latest revision of every Helm release, cluster-wide or per namespace.
 * Only labels are inspected; the heavy payload stays untouched until a
 * release is opened.
 */
export async function listHelmReleases(
  cluster: ClusterConfig,
  namespace?: string
): Promise<HelmRelease[]> {
  const params = new URLSearchParams();
  params.set('labelSelector', 'owner=helm');
  params.set('limit', '1000');
  const body = await kubeRequestJson<{ items?: SecretListItem[] }>(
    cluster,
    `${secretsPath(namespace)}?${params.toString()}`
  );
  const latest = new Map<string, HelmRelease>();
  for (const item of body.items ?? []) {
    const release = parseRevisionMeta(item);
    if (!release) continue;
    const key = `${release.namespace}/${release.name}`;
    const existing = latest.get(key);
    if (!existing || release.revision > existing.revision) latest.set(key, release);
  }
  return [...latest.values()].sort(
    (a, b) => a.name.localeCompare(b.name) || a.namespace.localeCompare(b.namespace)
  );
}

/** All revisions of one release, newest first (helm history). */
export async function listHelmHistory(
  cluster: ClusterConfig,
  namespace: string,
  name: string
): Promise<HelmRevision[]> {
  const params = new URLSearchParams();
  params.set('labelSelector', `owner=helm,name=${name}`);
  params.set('limit', '100');
  const body = await kubeRequestJson<{ items?: SecretListItem[] }>(
    cluster,
    `${secretsPath(namespace)}?${params.toString()}`
  );
  const revisions: HelmRevision[] = [];
  for (const item of body.items ?? []) {
    const release = parseRevisionMeta(item);
    if (!release) continue;
    revisions.push({
      revision: release.revision,
      status: release.status,
      secretName: release.secretName,
      updated: item.metadata?.creationTimestamp,
    });
  }
  revisions.sort((a, b) => b.revision - a.revision);
  return revisions;
}

function binaryStringToBytes(binary: string): Uint8Array {
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i) & 0xff;
  return bytes;
}

/** Decodes data.release: base64 (Secret) → base64 (Helm) → gzip → JSON. */
function decodeReleasePayload(data: string): any {
  const inner = base64Decode(base64Decode(data));
  let json: string;
  if (inner.charCodeAt(0) === 0x1f && inner.charCodeAt(1) === 0x8b) {
    json = pako.ungzip(binaryStringToBytes(inner), { to: 'string' });
  } else {
    json = inner;
  }
  return JSON.parse(json);
}

/** Loads and decodes one revision secret (helm get all). */
export async function getHelmReleaseDetail(
  cluster: ClusterConfig,
  namespace: string,
  secretName: string
): Promise<HelmReleaseDetail> {
  const secret = await kubeRequestJson<SecretListItem>(
    cluster,
    `/api/v1/namespaces/${encodeURIComponent(namespace)}/secrets/${encodeURIComponent(secretName)}`
  );
  const payload = secret.data?.release;
  if (!payload) throw new Error('The release secret has no payload.');
  const release = decodeReleasePayload(payload);
  const chartMeta = release.chart?.metadata ?? {};
  return {
    chart: chartMeta.name ?? 'unknown',
    chartVersion: chartMeta.version ?? '',
    appVersion: chartMeta.appVersion,
    description: release.info?.description,
    status: release.info?.status ?? 'unknown',
    firstDeployed: release.info?.first_deployed,
    lastDeployed: release.info?.last_deployed,
    notes: release.info?.notes,
    values: release.config ?? undefined,
    manifest: release.manifest,
  };
}
