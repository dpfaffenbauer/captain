import { useLocalSearchParams } from 'expo-router';
import React from 'react';
import { HelmContent } from '../../../src/ui/cluster/HelmContent';

/** Phone route wrapper: reads the cluster id and renders the shared HelmContent. */
export default function HelmReleasesScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  return <HelmContent clusterId={id} />;
}
