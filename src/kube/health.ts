import { ClusterConfig } from '../types';
import { kubeRequestJson } from './transport';

/** Aggregated cluster state for the multi-cluster home dashboard. */
export interface ClusterHealth {
  reachable: boolean;
  error?: string;
  nodesReady: number;
  nodesTotal: number;
  podsTotal: number;
  /** Pods that are failed, pending, or crash-looping. */
  podsProblem: number;
}

export type HealthTone = 'ok' | 'warn' | 'bad' | 'unknown';

export function healthTone(health: ClusterHealth | null | undefined): HealthTone {
  if (!health) return 'unknown';
  if (!health.reachable) return 'bad';
  if (health.nodesTotal > 0 && health.nodesReady < health.nodesTotal) return 'bad';
  if (health.podsProblem > 0) return 'warn';
  return 'ok';
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error('Cluster did not respond in time')), ms)
    ),
  ]);
}

function isProblemPod(pod: any): boolean {
  const phase = pod.status?.phase;
  if (phase === 'Failed' || phase === 'Pending') return true;
  if (phase === 'Succeeded') return false;
  return (pod.status?.containerStatuses ?? []).some(
    (status: any) => status.state?.waiting?.reason === 'CrashLoopBackOff'
  );
}

/**
 * One-shot health probe: node readiness plus problem-pod count. Capped lists
 * keep the payload reasonable on big clusters — the numbers are a dashboard
 * signal, not an inventory.
 */
export async function getClusterHealth(cluster: ClusterConfig): Promise<ClusterHealth> {
  try {
    const [nodes, pods] = await withTimeout(
      Promise.all([
        kubeRequestJson<{ items?: any[] }>(cluster, '/api/v1/nodes?limit=500'),
        kubeRequestJson<{ items?: any[] }>(cluster, '/api/v1/pods?limit=1000'),
      ]),
      12000
    );
    const nodeItems = nodes.items ?? [];
    const podItems = pods.items ?? [];
    return {
      reachable: true,
      nodesTotal: nodeItems.length,
      nodesReady: nodeItems.filter((node) =>
        (node.status?.conditions ?? []).some(
          (condition: any) => condition.type === 'Ready' && condition.status === 'True'
        )
      ).length,
      podsTotal: podItems.length,
      podsProblem: podItems.filter(isProblemPod).length,
    };
  } catch (caught) {
    return {
      reachable: false,
      error: caught instanceof Error ? caught.message : String(caught),
      nodesReady: 0,
      nodesTotal: 0,
      podsTotal: 0,
      podsProblem: 0,
    };
  }
}
