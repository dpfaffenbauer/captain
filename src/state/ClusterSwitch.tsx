import { useRouter } from 'expo-router';
import React, { createContext, useCallback, useContext, useMemo } from 'react';
import { useClusterSession } from './ClusterSession';

/**
 * Switching the active cluster. Two implementations: the wide keep-alive host
 * just flips which mounted workspace is visible; the phone layout navigates the
 * router to the cluster's last route. The cluster pill / icon rail use this so
 * they don't need to know which layout they're in.
 */
interface ClusterSwitchValue {
  activeId: string;
  switchTo(clusterId: string): void;
}

const ClusterSwitchContext = createContext<ClusterSwitchValue | null>(null);

export function ClusterSwitchProvider({
  value,
  children,
}: {
  value: ClusterSwitchValue;
  children: React.ReactNode;
}) {
  return <ClusterSwitchContext.Provider value={value}>{children}</ClusterSwitchContext.Provider>;
}

export function useClusterSwitch(): ClusterSwitchValue {
  const context = useContext(ClusterSwitchContext);
  if (!context) throw new Error('useClusterSwitch must be used within a ClusterSwitchProvider');
  return context;
}

/** Phone: switching clusters navigates to the cluster's remembered route. */
export function RouterClusterSwitchProvider({
  activeId,
  children,
}: {
  activeId: string;
  children: React.ReactNode;
}) {
  const router = useRouter();
  const session = useClusterSession();

  const switchTo = useCallback(
    (clusterId: string) => {
      if (clusterId === activeId) return;
      const target = session.get(clusterId)?.lastPath ?? `/cluster/${clusterId}`;
      router.replace(target as never);
    },
    [router, session, activeId]
  );

  const value = useMemo(() => ({ activeId, switchTo }), [activeId, switchTo]);
  return <ClusterSwitchProvider value={value}>{children}</ClusterSwitchProvider>;
}
