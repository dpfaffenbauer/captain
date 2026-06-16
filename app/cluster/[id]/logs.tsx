import { useLocalSearchParams, useRouter } from 'expo-router';
import React, { useMemo } from 'react';
import { useClusters } from '../../../src/state/ClustersContext';
import { EmptyState } from '../../../src/ui/components';
import { LogsView } from '../../../src/ui/LogsView';

export default function PodLogsScreen() {
  const params = useLocalSearchParams<{
    id: string;
    namespace: string;
    name: string;
    containers: string;
    previous?: string;
  }>();
  const router = useRouter();
  const { getById } = useClusters();
  const cluster = getById(params.id);

  const containers = useMemo(
    () => (params.containers ?? '').split(',').filter(Boolean),
    [params.containers]
  );

  if (!cluster) return <EmptyState message="Cluster not found." />;

  return (
    <LogsView
      cluster={cluster}
      namespace={params.namespace}
      name={params.name}
      containers={containers}
      previous={params.previous === '1'}
      mode="screen"
      onClose={() => router.back()}
    />
  );
}
