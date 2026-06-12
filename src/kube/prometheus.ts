import { ClusterConfig, PrometheusConfig } from '../types';
import { kubeRequestJson } from './transport';

/**
 * Prometheus access via the Kubernetes API-server service proxy. This reuses
 * the cluster's existing transport (CA trust, bearer/EKS/GKE/AKS tokens, mTLS),
 * so querying Prometheus needs no extra network exposure or credentials.
 *
 * Proxy path shape:
 *   /api/v1/namespaces/<ns>/services/[<scheme>:]<svc>:<port>/proxy/api/v1/<sub>
 */

/** Service names commonly used by the popular Prometheus distributions. */
const WELL_KNOWN_NAMES = [
  'prometheus-k8s', // kube-prometheus / Operator
  'prometheus-operated',
  'prometheus-server', // prometheus-community Helm chart
  'kube-prometheus-stack-prometheus',
  'prometheus',
];

function isPrometheusLabel(labels: Record<string, string>): boolean {
  return (
    labels['app.kubernetes.io/name'] === 'prometheus' ||
    labels['app.kubernetes.io/part-of'] === 'kube-prometheus' ||
    labels['app'] === 'prometheus'
  );
}

function proxyPath(cfg: PrometheusConfig, sub: string, params?: URLSearchParams): string {
  const scheme = cfg.scheme === 'https' ? 'https:' : '';
  const ref = `${scheme}${cfg.service}:${cfg.port}`;
  const query = params && [...params].length > 0 ? `?${params.toString()}` : '';
  return `/api/v1/namespaces/${encodeURIComponent(cfg.namespace)}/services/${ref}/proxy/api/v1/${sub}${query}`;
}

interface ServiceItem {
  metadata?: { name?: string; namespace?: string; labels?: Record<string, string> };
  spec?: { ports?: Array<{ name?: string; port?: number }> };
}

/**
 * Looks for Prometheus services across all namespaces, best match first.
 * Returns an empty list when none look like Prometheus.
 */
export async function discoverPrometheus(cluster: ClusterConfig): Promise<PrometheusConfig[]> {
  const body = await kubeRequestJson<{ items?: ServiceItem[] }>(
    cluster,
    '/api/v1/services?limit=500'
  );

  const scored: Array<{ cfg: PrometheusConfig; score: number }> = [];
  for (const svc of body.items ?? []) {
    const service = svc.metadata?.name;
    const namespace = svc.metadata?.namespace;
    if (!service || !namespace) continue;

    const labels = svc.metadata?.labels ?? {};
    const byLabel = isPrometheusLabel(labels);
    const nameIdx = WELL_KNOWN_NAMES.indexOf(service);
    if (!byLabel && nameIdx < 0) continue;

    const ports = svc.spec?.ports ?? [];
    const port =
      ports.find((p) => p.name === 'web' || p.name === 'http' || p.port === 9090) ?? ports[0];
    if (!port?.port) continue;

    let score = 0;
    if (byLabel) score += 4;
    if (nameIdx >= 0) score += WELL_KNOWN_NAMES.length - nameIdx;
    if (namespace === 'monitoring' || namespace === 'kube-prometheus-stack') score += 1;

    scored.push({ cfg: { namespace, service, port: port.port, scheme: 'http' }, score });
  }

  scored.sort((a, b) => b.score - a.score);
  return scored.map((s) => s.cfg);
}

/**
 * Returns the Prometheus config to use: the explicit one if set, otherwise the
 * best auto-discovered candidate. Null when disabled or none found.
 */
export async function resolvePrometheus(
  cluster: ClusterConfig
): Promise<PrometheusConfig | null> {
  if (cluster.prometheus?.disabled) return null;
  if (cluster.prometheus) return cluster.prometheus;
  try {
    const found = await discoverPrometheus(cluster);
    return found[0] ?? null;
  } catch {
    return null;
  }
}

interface PromResponse {
  status: string;
  data?: {
    resultType?: string;
    result?: Array<{
      metric?: Record<string, string>;
      value?: [number, string];
      values?: Array<[number, string]>;
    }>;
  };
}

export interface RangePoint {
  /** Unix seconds. */
  t: number;
  v: number;
}

export interface RangeSeries {
  metric: Record<string, string>;
  points: RangePoint[];
}

/** Instant query — returns the scalar value of the first vector sample. */
export async function promQueryScalar(
  cluster: ClusterConfig,
  cfg: PrometheusConfig,
  query: string
): Promise<number | null> {
  const params = new URLSearchParams({ query });
  const body = await kubeRequestJson<PromResponse>(cluster, proxyPath(cfg, 'query', params));
  if (body.status !== 'success') return null;
  const sample = body.data?.result?.[0]?.value;
  if (!sample) return null;
  const value = parseFloat(sample[1]);
  return Number.isFinite(value) ? value : null;
}

/** Range query over [now - windowSec, now] with `points` samples. */
export async function promQueryRange(
  cluster: ClusterConfig,
  cfg: PrometheusConfig,
  query: string,
  windowSec = 3600,
  points = 60
): Promise<RangeSeries[]> {
  const end = Math.floor(Date.now() / 1000);
  const start = end - windowSec;
  const step = Math.max(15, Math.floor(windowSec / points));
  const params = new URLSearchParams({
    query,
    start: String(start),
    end: String(end),
    step: String(step),
  });
  const body = await kubeRequestJson<PromResponse>(
    cluster,
    proxyPath(cfg, 'query_range', params)
  );
  if (body.status !== 'success') return [];
  return (body.data?.result ?? []).map((r) => ({
    metric: r.metric ?? {},
    points: (r.values ?? [])
      .map(([t, v]) => ({ t, v: parseFloat(v) }))
      .filter((p) => Number.isFinite(p.v)),
  }));
}

/** Range query that collapses to a single series' values (e.g. a cluster sum). */
export async function promRangeValues(
  cluster: ClusterConfig,
  cfg: PrometheusConfig,
  query: string,
  windowSec = 3600,
  points = 60
): Promise<number[]> {
  const series = await promQueryRange(cluster, cfg, query, windowSec, points);
  return series[0]?.points.map((p) => p.v) ?? [];
}

interface RawAlert {
  labels?: Record<string, string>;
  annotations?: Record<string, string>;
  state?: string;
  activeAt?: string;
  value?: string;
}

export interface PromAlert {
  name: string;
  severity: string;
  state: string;
  summary?: string;
  description?: string;
  runbookUrl?: string;
  /** The series value that tripped the rule, as a string. */
  value?: string;
  activeAt?: string;
  namespace?: string;
  pod?: string;
  labels: Record<string, string>;
}

const SEVERITY_RANK: Record<string, number> = {
  critical: 0,
  error: 1,
  warning: 2,
  info: 3,
  none: 4,
};

/** Active (firing) alerts known to Prometheus, most severe first. */
export async function getFiringAlerts(
  cluster: ClusterConfig,
  cfg: PrometheusConfig
): Promise<PromAlert[]> {
  const body = await kubeRequestJson<{ status: string; data?: { alerts?: RawAlert[] } }>(
    cluster,
    proxyPath(cfg, 'alerts')
  );
  if (body.status !== 'success') return [];

  const alerts = (body.data?.alerts ?? [])
    .filter((a) => a.state === 'firing')
    .map<PromAlert>((a) => {
      const labels = a.labels ?? {};
      const annotations = a.annotations ?? {};
      return {
        name: labels.alertname ?? 'Alert',
        severity: labels.severity ?? 'warning',
        state: a.state ?? 'firing',
        summary: annotations.summary ?? annotations.message,
        description: annotations.description,
        runbookUrl: annotations.runbook_url,
        value: a.value,
        activeAt: a.activeAt,
        namespace: labels.namespace,
        pod: labels.pod,
        labels,
      };
    });

  alerts.sort(
    (a, b) =>
      (SEVERITY_RANK[a.severity] ?? 9) - (SEVERITY_RANK[b.severity] ?? 9) ||
      a.name.localeCompare(b.name)
  );
  return alerts;
}

/** Default PromQL for cluster-wide resource trends (cAdvisor metrics). */
export const CLUSTER_CPU_QUERY =
  'sum(rate(container_cpu_usage_seconds_total{container!="",pod!=""}[5m]))';
export const CLUSTER_MEM_QUERY =
  'sum(container_memory_working_set_bytes{container!="",pod!=""})';
