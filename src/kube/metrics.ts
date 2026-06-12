import { ClusterConfig } from '../types';
import { parseCpu, parseMemory } from './quantity';
import { kubeRequestJson } from './transport';

export interface ResourceUsage {
  /** Cores. */
  cpu: number;
  /** Bytes. */
  memory: number;
}

/**
 * Node usage from the metrics-server API. Returns null when the metrics API
 * is not installed in the cluster.
 */
export async function getNodeMetrics(
  cluster: ClusterConfig
): Promise<Map<string, ResourceUsage> | null> {
  try {
    const body = await kubeRequestJson<{
      items?: Array<{ metadata?: { name?: string }; usage?: { cpu?: string; memory?: string } }>;
    }>(cluster, '/apis/metrics.k8s.io/v1beta1/nodes');
    const result = new Map<string, ResourceUsage>();
    for (const item of body.items ?? []) {
      if (!item.metadata?.name) continue;
      result.set(item.metadata.name, {
        cpu: parseCpu(item.usage?.cpu),
        memory: parseMemory(item.usage?.memory),
      });
    }
    return result;
  } catch {
    return null;
  }
}

/** Pod usage keyed by "namespace/name" (sum over containers). */
export async function getPodMetrics(
  cluster: ClusterConfig,
  namespace?: string
): Promise<Map<string, ResourceUsage> | null> {
  try {
    const path = namespace
      ? `/apis/metrics.k8s.io/v1beta1/namespaces/${encodeURIComponent(namespace)}/pods`
      : '/apis/metrics.k8s.io/v1beta1/pods';
    const body = await kubeRequestJson<{
      items?: Array<{
        metadata?: { name?: string; namespace?: string };
        containers?: Array<{ usage?: { cpu?: string; memory?: string } }>;
      }>;
    }>(cluster, path);
    const result = new Map<string, ResourceUsage>();
    for (const item of body.items ?? []) {
      if (!item.metadata?.name) continue;
      let cpu = 0;
      let memory = 0;
      for (const container of item.containers ?? []) {
        cpu += parseCpu(container.usage?.cpu);
        memory += parseMemory(container.usage?.memory);
      }
      result.set(`${item.metadata.namespace ?? ''}/${item.metadata.name}`, { cpu, memory });
    }
    return result;
  } catch {
    return null;
  }
}

export function formatCpuUsage(cores: number): string {
  if (cores >= 1) return `${cores.toFixed(1)}`;
  return `${Math.round(cores * 1000)}m`;
}

export function formatMemoryUsage(bytes: number): string {
  if (bytes >= 2 ** 30) return `${(bytes / 2 ** 30).toFixed(1)}Gi`;
  return `${Math.round(bytes / 2 ** 20)}Mi`;
}
