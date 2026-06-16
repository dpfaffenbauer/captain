import { useLocalSearchParams } from 'expo-router';
import React from 'react';
import { SearchContent } from '../../../src/ui/cluster/SearchContent';

/** Phone route wrapper: reads the cluster id and renders the shared SearchContent. */
export default function SearchScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  return <SearchContent clusterId={id} />;
}
