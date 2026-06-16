import { useLocalSearchParams } from 'expo-router';
import React from 'react';
import { IndexContent } from '../../../src/ui/cluster/IndexContent';

export default function ClusterDashboardScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  return <IndexContent clusterId={id} />;
}
