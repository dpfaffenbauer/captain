import { useLocalSearchParams } from 'expo-router';
import React from 'react';
import { EventsContent } from '../../../src/ui/cluster/EventsContent';

/** Phone route wrapper: reads the cluster id and renders the shared EventsContent. */
export default function EventsScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  return <EventsContent clusterId={id} />;
}
