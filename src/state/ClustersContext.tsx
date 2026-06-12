import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { setAuthUpdateListener } from '../auth/tokens';
import { deleteCluster, loadClusters, saveCluster } from '../storage/clusters';
import { AuthConfig, ClusterConfig } from '../types';

interface ClustersContextValue {
  clusters: ClusterConfig[];
  loading: boolean;
  addOrUpdate(cluster: ClusterConfig): Promise<void>;
  remove(id: string): Promise<void>;
  getById(id: string): ClusterConfig | undefined;
}

const ClustersContext = createContext<ClustersContextValue | undefined>(undefined);

export function ClustersProvider({ children }: { children: React.ReactNode }) {
  const [clusters, setClusters] = useState<ClusterConfig[]>([]);
  const [loading, setLoading] = useState(true);
  const clustersRef = useRef<ClusterConfig[]>([]);
  clustersRef.current = clusters;

  useEffect(() => {
    loadClusters()
      .then(setClusters)
      .finally(() => setLoading(false));
  }, []);

  const addOrUpdate = useCallback(async (cluster: ClusterConfig) => {
    await saveCluster(cluster);
    setClusters((current) => {
      const index = current.findIndex((existing) => existing.id === cluster.id);
      if (index < 0) return [...current, cluster];
      const next = [...current];
      next[index] = cluster;
      return next;
    });
  }, []);

  const remove = useCallback(async (id: string) => {
    await deleteCluster(id);
    setClusters((current) => current.filter((cluster) => cluster.id !== id));
  }, []);

  const getById = useCallback(
    (id: string) => clustersRef.current.find((cluster) => cluster.id === id),
    []
  );

  // Persist refreshed OAuth tokens so re-login is rarely needed.
  useEffect(() => {
    setAuthUpdateListener((clusterId: string, auth: AuthConfig) => {
      const cluster = clustersRef.current.find((existing) => existing.id === clusterId);
      if (cluster) {
        void addOrUpdate({ ...cluster, auth });
      }
    });
    return () => setAuthUpdateListener(undefined);
  }, [addOrUpdate]);

  const value = useMemo(
    () => ({ clusters, loading, addOrUpdate, remove, getById }),
    [clusters, loading, addOrUpdate, remove, getById]
  );

  return <ClustersContext.Provider value={value}>{children}</ClustersContext.Provider>;
}

export function useClusters(): ClustersContextValue {
  const context = useContext(ClustersContext);
  if (!context) throw new Error('useClusters must be used within ClustersProvider');
  return context;
}
