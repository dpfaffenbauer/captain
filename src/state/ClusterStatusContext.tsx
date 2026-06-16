import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';
import { pingCluster } from '../kube/health';
import { useClusters } from './ClustersContext';

/** Live connection state for a cluster, surfaced as a dot on its avatar/pill. */
export type ConnectionState = 'connected' | 'error' | 'checking' | 'unknown';

interface ClusterStatusValue {
  statusOf(clusterId: string): ConnectionState;
  /** Re-probe now (e.g. after a manual retry). */
  refresh(): void;
}

const ClusterStatusContext = createContext<ClusterStatusValue | null>(null);

/** How often to re-probe every known cluster. */
const POLL_MS = 30000;

/**
 * Periodically probes every stored cluster's API server so the UI can show
 * which clusters are currently reachable. Cheap (/version) and shared, so the
 * icon rail and sidebar read the same cached state.
 */
export function ClusterStatusProvider({ children }: { children: React.ReactNode }) {
  const { clusters } = useClusters();
  const [statuses, setStatuses] = useState<Record<string, ConnectionState>>({});

  const probeAll = useCallback(() => {
    for (const cluster of clusters) {
      // Keep the last known state visible while re-checking; only show
      // "checking" the very first time we see a cluster.
      setStatuses((current) =>
        current[cluster.id] ? current : { ...current, [cluster.id]: 'checking' }
      );
      void pingCluster(cluster).then((ok) => {
        setStatuses((current) => ({ ...current, [cluster.id]: ok ? 'connected' : 'error' }));
      });
    }
  }, [clusters]);

  useEffect(() => {
    probeAll();
    const timer = setInterval(probeAll, POLL_MS);
    return () => clearInterval(timer);
  }, [probeAll]);

  const value = useMemo<ClusterStatusValue>(
    () => ({
      statusOf: (clusterId: string) => statuses[clusterId] ?? 'unknown',
      refresh: probeAll,
    }),
    [statuses, probeAll]
  );

  return <ClusterStatusContext.Provider value={value}>{children}</ClusterStatusContext.Provider>;
}

export function useClusterStatus(): ClusterStatusValue {
  const context = useContext(ClusterStatusContext);
  if (!context) throw new Error('useClusterStatus must be used within a ClusterStatusProvider');
  return context;
}
