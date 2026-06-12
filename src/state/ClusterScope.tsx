import React, { createContext, useContext, useMemo, useState } from 'react';

/** Empty string = all namespaces. */
interface ClusterScopeValue {
  namespace: string;
  setNamespace(namespace: string): void;
}

const ClusterScopeContext = createContext<ClusterScopeValue | undefined>(undefined);

export function ClusterScopeProvider({ children }: { children: React.ReactNode }) {
  const [namespace, setNamespace] = useState('');
  const value = useMemo(() => ({ namespace, setNamespace }), [namespace]);
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
