import { useLocalSearchParams } from 'expo-router';
import React from 'react';
import { BrowseContent } from '../../../src/ui/cluster/BrowseContent';

/** Phone route wrapper: reads cluster id and renders the shared BrowseContent. */
export default function BrowseScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  return <BrowseContent clusterId={id} />;
}
