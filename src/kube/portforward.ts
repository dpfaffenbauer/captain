import {
  endPortForwardActivity,
  startPortForwardActivity,
} from '../../modules/captain-widget';
import {
  isNativeTransportAvailable,
  nativePortForwardStart,
  nativePortForwardStop,
} from '../../modules/kube-http';
import { getBearerToken } from '../auth/tokens';
import { ClusterConfig } from '../types';
import { tlsOptionsOf } from './transport';

export interface PortForward {
  id: string;
  clusterId: string;
  namespace: string;
  pod: string;
  localPort: number;
  remotePort: number;
  startedAt: number;
  /** Live Activity id ('' when unavailable). */
  activityId?: string;
}

let forwards: PortForward[] = [];
const listeners = new Set<() => void>();

function notify() {
  for (const listener of listeners) listener();
}

/** useSyncExternalStore-compatible subscription for active forwards. */
export function subscribeForwards(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getForwards(): PortForward[] {
  return forwards;
}

export async function startPortForward(
  cluster: ClusterConfig,
  namespace: string,
  pod: string,
  remotePort: number,
  localPort = 0
): Promise<PortForward> {
  if (!isNativeTransportAvailable()) {
    throw new Error('Port forwarding requires the development build (native KubeHttp module).');
  }
  const headers: Record<string, string> = {};
  const token = await getBearerToken(cluster);
  if (token) headers.Authorization = `Bearer ${token}`;

  const server = cluster.server.replace(/\/+$/, '').replace(/^http/, 'ws');
  const handle = await nativePortForwardStart({
    url: `${server}/api/v1/namespaces/${encodeURIComponent(namespace)}/pods/${encodeURIComponent(pod)}/portforward?ports=${remotePort}`,
    headers,
    ...tlsOptionsOf(cluster),
    localPort,
  });

  const forward: PortForward = {
    id: handle.id,
    clusterId: cluster.id,
    namespace,
    pod,
    localPort: handle.localPort,
    remotePort,
    startedAt: Date.now(),
  };
  forwards = [...forwards, forward];
  notify();
  // Show the forward in the Dynamic Island / on the lock screen.
  void startPortForwardActivity(pod, handle.localPort, remotePort).then((activityId) => {
    const entry = forwards.find((candidate) => candidate.id === forward.id);
    if (entry) {
      entry.activityId = activityId;
    } else if (activityId) {
      // The forward was stopped before the activity came up.
      void endPortForwardActivity(activityId);
    }
  });
  return forward;
}

export function stopPortForward(id: string): void {
  const entry = forwards.find((forward) => forward.id === id);
  if (entry?.activityId) {
    void endPortForwardActivity(entry.activityId);
  }
  try {
    nativePortForwardStop(id);
  } finally {
    forwards = forwards.filter((forward) => forward.id !== id);
    notify();
  }
}
