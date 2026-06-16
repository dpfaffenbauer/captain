import { useLocalSearchParams } from 'expo-router';
import React from 'react';
import { AlertsContent } from '../../../src/ui/cluster/AlertsContent';

/** Phone route wrapper: reads cluster id and renders the shared AlertsContent. */
export default function AlertsScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  return <AlertsContent clusterId={id} />;
}
