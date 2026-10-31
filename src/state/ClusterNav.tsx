import { useRouter } from 'expo-router';
import React, { createContext, useCallback, useContext, useMemo } from 'react';
import { ApiResourceType } from '../types';
import { DetailTarget, routeFor } from './DetailSelection';

/**
 * The master view shown in a cluster's content column. On wide screens this is
 * in-memory state (so switching clusters keeps each one's view mounted); on
 * narrow screens it maps to an Expo Router route.
 */
export type MasterView =
  | { kind: 'dashboard' }
  | { kind: 'browse' }
  | { kind: 'events' }
  | { kind: 'list'; type: ApiResourceType }
  | { kind: 'helm' }
  | { kind: 'search' }
  | { kind: 'kinds'; category: string; title: string }
  | { kind: 'gitops' }
  | { kind: 'forwards' }
  | { kind: 'alerts' };

/**
 * Unified navigation for everything inside a cluster. The two implementations
 * (router-backed for phone, in-memory for the keep-alive wide layout) expose the
 * same surface so the screen components don't care which they run under.
 */
export interface ClusterNav {
  clusterId: string;
  /** Whether the content is embedded in the wide split layout (hide back buttons). */
  embedded: boolean;
  /** The current master view (only meaningful/observed on wide). */
  current: MasterView;
  /** Swap the master content. */
  show(view: MasterView): void;
  /** Go back one master step (wide) or pop the route (phone). */
  back(): void;
  /** Open a resource detail (wide: detail pane; phone: pushed route). */
  openItem(type: ApiResourceType, name: string, namespace?: string): void;
  openHelmRelease(target: {
    namespace: string;
    name: string;
    revision: string;
    secretName: string;
  }): void;
  /** Open logs (wide: bottom dock; phone: pushed route). */
  openLogs(target: {
    namespace: string;
    name: string;
    containers: string[];
    previous?: boolean;
  }): void;
  /** Open an exec shell (wide: bottom dock; phone: pushed route). */
  openExec(target: { namespace: string; name: string; container: string }): void;
}

const ClusterNavContext = createContext<ClusterNav | null>(null);

export function ClusterNavProvider({
  value,
  children,
}: {
  value: ClusterNav;
  children: React.ReactNode;
}) {
  return <ClusterNavContext.Provider value={value}>{children}</ClusterNavContext.Provider>;
}

export function useClusterNav(): ClusterNav {
  const context = useContext(ClusterNavContext);
  if (!context) throw new Error('useClusterNav must be used within a ClusterNavProvider');
  return context;
}

/**
 * Maps a phone route back to its master view, so widening the window (e.g.
 * unfolding iPhone Duo) stays on the same screen. Screens without a master view
 * of their own fall back to the closest one that has.
 */
export function masterViewFromRoute(
  segment: string,
  params: Record<string, string | string[] | undefined>
): MasterView {
  const param = (key: string) => {
    const value = params[key];
    return typeof value === 'string' ? value : '';
  };
  switch (segment) {
    case 'browse':
    case 'events':
    case 'search':
    case 'gitops':
    case 'forwards':
    case 'alerts':
      return { kind: segment };
    case 'helm':
    case 'helm-release':
      return { kind: 'helm' };
    case 'kinds':
      return { kind: 'kinds', category: param('category'), title: param('title') };
    case 'list':
    case 'item':
      return {
        kind: 'list',
        type: {
          group: param('group'),
          version: param('version') || 'v1',
          plural: param('plural'),
          kind: param('kind'),
          namespaced: param('namespaced') === '1',
          verbs: param('verbs').split(',').filter(Boolean),
        },
      };
    default:
      return { kind: 'dashboard' };
  }
}

/** Maps a master view to its Expo Router route (used by the phone layout). */
function masterRoute(clusterId: string, view: MasterView): { pathname: string; params: Record<string, string> } {
  const id = clusterId;
  switch (view.kind) {
    case 'dashboard':
      return { pathname: '/cluster/[id]', params: { id } };
    case 'browse':
      return { pathname: '/cluster/[id]/browse', params: { id } };
    case 'events':
      return { pathname: '/cluster/[id]/events', params: { id } };
    case 'list':
      return {
        pathname: '/cluster/[id]/list',
        params: {
          id,
          group: view.type.group,
          version: view.type.version,
          plural: view.type.plural,
          kind: view.type.kind,
          namespaced: view.type.namespaced ? '1' : '0',
          verbs: view.type.verbs.join(','),
        },
      };
    case 'helm':
      return { pathname: '/cluster/[id]/helm', params: { id } };
    case 'search':
      return { pathname: '/cluster/[id]/search', params: { id } };
    case 'kinds':
      return {
        pathname: '/cluster/[id]/kinds',
        params: { id, category: view.category, title: view.title },
      };
    case 'gitops':
      return { pathname: '/cluster/[id]/gitops', params: { id } };
    case 'forwards':
      return { pathname: '/cluster/[id]/forwards', params: { id } };
    case 'alerts':
      return { pathname: '/cluster/[id]/alerts', params: { id } };
  }
}

/** The three primary tabs replace; deeper views push (so back returns to them). */
const REPLACE_KINDS = new Set<MasterView['kind']>(['dashboard', 'browse', 'events']);

/**
 * Opens a view coming from the wide layout, which has no routes of its own.
 * Deeper views go on top of the dashboard so that back stays inside the cluster.
 */
export function restoreMasterRoute(
  router: ReturnType<typeof useRouter>,
  clusterId: string,
  view: MasterView
) {
  if (REPLACE_KINDS.has(view.kind)) {
    router.replace(masterRoute(clusterId, view) as never);
    return;
  }
  router.replace(masterRoute(clusterId, { kind: 'dashboard' }) as never);
  router.push(masterRoute(clusterId, view) as never);
}

/**
 * Phone navigation: every action is an Expo Router transition. Detail targets
 * reuse routeFor so they stay in sync with the route param contracts.
 */
export function RouterClusterNavProvider({
  clusterId,
  children,
}: {
  clusterId: string;
  children: React.ReactNode;
}) {
  const router = useRouter();

  const pushDetail = useCallback(
    (target: DetailTarget) => {
      router.push(routeFor(clusterId, target) as never);
    },
    [router, clusterId]
  );

  const value = useMemo<ClusterNav>(
    () => ({
      clusterId,
      embedded: false,
      current: { kind: 'dashboard' },
      show: (view) => {
        const route = masterRoute(clusterId, view) as never;
        if (REPLACE_KINDS.has(view.kind)) router.replace(route);
        else router.push(route);
      },
      back: () => router.back(),
      openItem: (type, name, namespace) =>
        pushDetail({ kind: 'item', type, name, namespace }),
      openHelmRelease: (target) => pushDetail({ kind: 'helm-release', ...target }),
      openLogs: (target) => pushDetail({ kind: 'logs', ...target }),
      openExec: (target) => pushDetail({ kind: 'exec', ...target }),
    }),
    [clusterId, router, pushDetail]
  );

  return <ClusterNavProvider value={value}>{children}</ClusterNavProvider>;
}
