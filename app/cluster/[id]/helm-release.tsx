import { useLocalSearchParams, useRouter } from 'expo-router';
import React from 'react';
import { useClusters } from '../../../src/state/ClustersContext';
import { EmptyState } from '../../../src/ui/components';
import { HelmReleaseView } from '../../../src/ui/HelmReleaseView';

export default function HelmReleaseScreen() {
  const params = useLocalSearchParams<{
    id: string;
    namespace: string;
    name: string;
    revision: string;
    secretName: string;
  }>();
  const router = useRouter();
  const { getById } = useClusters();
  const cluster = getById(params.id);

  if (!cluster) return <EmptyState message="Cluster not found." />;

  return (
    <HelmReleaseView
      cluster={cluster}
      namespace={params.namespace}
      name={params.name}
      revision={params.revision}
      secretName={params.secretName}
      mode="screen"
      onClose={() => router.back()}
    />
  );
}
