import { useLocalSearchParams, useRouter } from 'expo-router';
import React, { useMemo } from 'react';
import { useClusters } from '../../../src/state/ClustersContext';
import { DetailTarget, routeFor } from '../../../src/state/DetailSelection';
import { useDock } from '../../../src/state/DockContext';
import { ApiResourceType } from '../../../src/types';
import { EmptyState } from '../../../src/ui/components';
import { ItemView } from '../../../src/ui/ItemView';
import { useResponsiveLayout } from '../../../src/ui/useResponsiveLayout';

export default function ResourceItemScreen() {
  const params = useLocalSearchParams<{
    id: string;
    group: string;
    version: string;
    plural: string;
    kind: string;
    namespaced: string;
    verbs: string;
    name: string;
    namespace: string;
  }>();
  const router = useRouter();
  const { getById } = useClusters();
  const cluster = getById(params.id);
  const dock = useDock();
  const { isWide } = useResponsiveLayout();

  const type = useMemo<ApiResourceType>(
    () => ({
      group: params.group ?? '',
      version: params.version ?? 'v1',
      plural: params.plural ?? '',
      kind: params.kind ?? '',
      namespaced: params.namespaced === '1',
      verbs: (params.verbs ?? '').split(',').filter(Boolean),
    }),
    [params.group, params.version, params.plural, params.kind, params.namespaced, params.verbs]
  );

  if (!cluster) return <EmptyState message="Cluster not found." />;

  // On wide screens logs/exec dock at the bottom; on phone they push full-screen.
  const navigate = (target: DetailTarget) => {
    if (isWide && target.kind === 'logs') return dock.openLogs(target);
    if (isWide && target.kind === 'exec') return dock.openExec(target);
    router.push(routeFor(params.id, target) as never);
  };

  return (
    <ItemView
      cluster={cluster}
      type={type}
      name={params.name}
      namespace={params.namespace || undefined}
      mode="screen"
      onNavigate={navigate}
      onClose={() => router.back()}
      onShowForwards={() =>
        router.push({ pathname: '/cluster/[id]/forwards', params: { id: params.id } })
      }
    />
  );
}
