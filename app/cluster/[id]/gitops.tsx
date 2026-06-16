import { useLocalSearchParams } from 'expo-router';
import React from 'react';
import { GitopsContent } from '../../../src/ui/cluster/GitopsContent';

/** Phone route wrapper: reads cluster id and renders the shared GitopsContent. */
export default function GitOpsScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  return <GitopsContent clusterId={id} />;
}
