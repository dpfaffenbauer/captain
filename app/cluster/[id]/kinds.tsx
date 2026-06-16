import { useLocalSearchParams } from 'expo-router';
import React from 'react';
import { KindsContent } from '../../../src/ui/cluster/KindsContent';

export default function KindsScreen() {
  const { id, category, title } = useLocalSearchParams<{
    id: string;
    category: string;
    title: string;
  }>();
  return <KindsContent clusterId={id} category={category} title={title} />;
}
