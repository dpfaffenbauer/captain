import React, { createContext, useCallback, useContext, useMemo, useRef } from 'react';

/**
 * Remembers, per cluster, where the user last was — the in-cluster route and
 * the selected namespace — so switching back to a cluster lands on the same
 * screen instead of resetting to the dashboard. Lives at the root, above the
 * `cluster/[id]` layout, so the memory survives a cluster switch (which
 * unmounts and remounts that whole subtree).
 *
 * Note: this restores *navigational* state. Live resource data is re-fetched on
 * remount, which is the right behaviour for a Kubernetes client.
 */
interface ClusterSessionEntry {
  /** Last in-cluster href, e.g. `/cluster/abc/list?type=pods`. */
  lastPath?: string;
  /** Last namespace scope ('' = all namespaces). */
  namespace?: string;
}

interface ClusterSessionValue {
  rememberPath(id: string, lastPath: string): void;
  rememberNamespace(id: string, namespace: string): void;
  get(id: string): ClusterSessionEntry | undefined;
}

const ClusterSessionContext = createContext<ClusterSessionValue | undefined>(undefined);

export function ClusterSessionProvider({ children }: { children: React.ReactNode }) {
  const sessions = useRef(new Map<string, ClusterSessionEntry>());

  const rememberPath = useCallback((id: string, lastPath: string) => {
    const entry = sessions.current.get(id) ?? {};
    sessions.current.set(id, { ...entry, lastPath });
  }, []);

  const rememberNamespace = useCallback((id: string, namespace: string) => {
    const entry = sessions.current.get(id) ?? {};
    sessions.current.set(id, { ...entry, namespace });
  }, []);

  const get = useCallback((id: string) => sessions.current.get(id), []);

  const value = useMemo(
    () => ({ rememberPath, rememberNamespace, get }),
    [rememberPath, rememberNamespace, get]
  );

  return <ClusterSessionContext.Provider value={value}>{children}</ClusterSessionContext.Provider>;
}

export function useClusterSession(): ClusterSessionValue {
  const context = useContext(ClusterSessionContext);
  if (!context) throw new Error('useClusterSession must be used within ClusterSessionProvider');
  return context;
}
