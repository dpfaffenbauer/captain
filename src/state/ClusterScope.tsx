import { useLocalSearchParams } from 'expo-router';
import React, { createContext, useCallback, useContext, useMemo, useState } from 'react';
import { useClusterSession } from './ClusterSession';

/** Empty string = all namespaces. */
interface ClusterScopeValue {
  namespace: string;
  setNamespace(namespace: string): void;
}

const ClusterScopeContext = createContext<ClusterScopeValue | undefined>(undefined);

export function ClusterScopeProvider({
  clusterId,
  children,
}: {
  clusterId?: string;
  children: React.ReactNode;
}) {
  // Explicit clusterId wins (wide layout mounts several at once); fall back to
  // the route param for the single-cluster phone layout.
  const params = useLocalSearchParams<{ id: string }>();
  const id = clusterId ?? params.id;
  const session = useClusterSession();
  // Restore the namespace this cluster was last scoped to. The provider
  // remounts per cluster (the id route param changes), so this initialiser
  // runs fresh for each cluster.
  const [namespace, setNamespaceState] = useState(() => session.get(id)?.namespace ?? '');

  const setNamespace = useCallback(
    (next: string) => {
      setNamespaceState(next);
      session.rememberNamespace(id, next);
    },
    [id, session]
  );

  const value = useMemo(() => ({ namespace, setNamespace }), [namespace, setNamespace]);
  return <ClusterScopeContext.Provider value={value}>{children}</ClusterScopeContext.Provider>;
}

export function useClusterScope(): ClusterScopeValue {
  const context = useContext(ClusterScopeContext);
  if (!context) throw new Error('useClusterScope must be used within ClusterScopeProvider');
  return context;
}

export function namespaceLabel(namespace: string): string {
  return namespace === '' ? 'All namespaces' : namespace;
}
