import { Redirect, useLocalSearchParams } from 'expo-router';
import React from 'react';
import { useClusters } from '../src/state/ClustersContext';
import { Loading } from '../src/ui/components';

/**
 * Deep-link target for the Siri "Open Cluster" intent:
 * captain://open?cluster=<name> resolves the cluster by name (case-insensitive)
 * and jumps straight into it; unknown names land on the cluster overview.
 */
export default function OpenDeepLink() {
  const { cluster: name } = useLocalSearchParams<{ cluster?: string }>();
  const { clusters, loading } = useClusters();

  if (loading) return <Loading />;

  const query = (name ?? '').trim().toLowerCase();
  const match = query
    ? clusters.find((cluster) => cluster.name.toLowerCase() === query) ??
      clusters.find((cluster) => cluster.name.toLowerCase().includes(query))
    : undefined;

  return <Redirect href={match ? (`/cluster/${match.id}` as never) : ('/' as never)} />;
}
