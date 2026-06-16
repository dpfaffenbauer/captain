import { useLocalSearchParams, useRouter } from 'expo-router';
import React from 'react';
import { useClusters } from '../../../src/state/ClustersContext';
import { EmptyState } from '../../../src/ui/components';
import { ExecView } from '../../../src/ui/ExecView';

export default function ExecScreen() {
  const params = useLocalSearchParams<{
    id: string;
    namespace: string;
    name: string;
    container: string;
  }>();
  const router = useRouter();
  const { getById } = useClusters();
  const cluster = getById(params.id);

  if (!cluster) return <EmptyState message="Cluster not found." />;

  return (
    <ExecView
      cluster={cluster}
      namespace={params.namespace}
      name={params.name}
      container={params.container || undefined}
      mode="screen"
      onClose={() => router.back()}
    />
  );
}
