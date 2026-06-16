import { useLocalSearchParams } from 'expo-router';
import React from 'react';
import { ForwardsContent } from '../../../src/ui/cluster/ForwardsContent';

export default function PortForwardsScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  return <ForwardsContent clusterId={id} />;
}
