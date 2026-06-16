import React, { createContext, useContext, useMemo, useState } from 'react';
import { ApiResourceType } from '../types';

/**
 * A resource the detail pane (or a pushed route) can show. The master screens
 * and the detail pane itself produce these; on wide screens they swap the pane,
 * on narrow screens they map to a pushed route via routeFor.
 */
export type DetailTarget =
  | { kind: 'item'; type: ApiResourceType; name: string; namespace?: string }
  | { kind: 'helm-release'; namespace: string; name: string; revision: string; secretName: string }
  | { kind: 'logs'; namespace: string; name: string; containers: string[]; previous?: boolean }
  | { kind: 'exec'; namespace: string; name: string; container: string };

export interface RouteSpec {
  pathname: string;
  params: Record<string, string>;
}

/** Maps a detail target back to an Expo Router push, mirroring the param contracts. */
export function routeFor(clusterId: string, target: DetailTarget): RouteSpec {
  switch (target.kind) {
    case 'item':
      return {
        pathname: '/cluster/[id]/item',
        params: {
          id: clusterId,
          group: target.type.group,
          version: target.type.version,
          plural: target.type.plural,
          kind: target.type.kind,
          namespaced: target.type.namespaced ? '1' : '0',
          verbs: target.type.verbs.join(','),
          name: target.name,
          namespace: target.type.namespaced ? target.namespace ?? '' : '',
        },
      };
    case 'helm-release':
      return {
        pathname: '/cluster/[id]/helm-release',
        params: {
          id: clusterId,
          namespace: target.namespace,
          name: target.name,
          revision: target.revision,
          secretName: target.secretName,
        },
      };
    case 'logs':
      return {
        pathname: '/cluster/[id]/logs',
        params: {
          id: clusterId,
          namespace: target.namespace,
          name: target.name,
          containers: target.containers.join(','),
          previous: target.previous ? '1' : '0',
        },
      };
    case 'exec':
      return {
        pathname: '/cluster/[id]/exec',
        params: {
          id: clusterId,
          namespace: target.namespace,
          name: target.name,
          container: target.container,
        },
      };
  }
}

interface DetailSelectionState {
  /** Drilldown stack; the last entry is shown, the first is the selected row. */
  stack: DetailTarget[];
  /** Select a resource (resets any drilldown). */
  open: (target: DetailTarget) => void;
  /** Drill into a related resource, keeping a back trail. */
  push: (target: DetailTarget) => void;
  /** Pop one level of drilldown. */
  back: () => void;
  /** Dismiss the detail sidebar. */
  close: () => void;
}

const DetailSelectionContext = createContext<DetailSelectionState | null>(null);

/**
 * Layout-level selection for the right detail sidebar. Lifting it out of the
 * list screen lets the detail rail live beside the content (and persist a
 * drilldown trail) instead of being owned by one screen.
 */
export function DetailSelectionProvider({ children }: { children: React.ReactNode }) {
  const [stack, setStack] = useState<DetailTarget[]>([]);
  const value = useMemo<DetailSelectionState>(
    () => ({
      stack,
      open: (target) => setStack([target]),
      push: (target) => setStack((current) => [...current, target]),
      back: () => setStack((current) => current.slice(0, -1)),
      close: () => setStack([]),
    }),
    [stack]
  );
  return (
    <DetailSelectionContext.Provider value={value}>{children}</DetailSelectionContext.Provider>
  );
}

export function useDetailSelection(): DetailSelectionState {
  const context = useContext(DetailSelectionContext);
  if (!context) throw new Error('useDetailSelection must be used within a DetailSelectionProvider');
  return context;
}

/** Stable identity for a target, used to key panes and compare selection. */
export function detailKey(target: DetailTarget): string {
  switch (target.kind) {
    case 'item':
      return `item/${target.type.group}/${target.type.plural}/${target.namespace ?? ''}/${target.name}`;
    case 'helm-release':
      return `helm/${target.namespace}/${target.name}/${target.revision}`;
    case 'logs':
      return `logs/${target.namespace}/${target.name}/${target.previous ? 'prev' : 'cur'}`;
    case 'exec':
      return `exec/${target.namespace}/${target.name}/${target.container}`;
  }
}
