import { useLocalSearchParams } from 'expo-router';
import React, { useMemo } from 'react';
import { ApiResourceType } from '../../../src/types';
import { ListContent } from '../../../src/ui/cluster/ListContent';

/** Phone route wrapper: reads list params and renders the shared ListContent. */
export default function ResourceListScreen() {
  const params = useLocalSearchParams<{
    id: string;
    group: string;
    version: string;
    plural: string;
    kind: string;
    namespaced: string;
    verbs: string;
  }>();

  const type = useMemo<ApiResourceType>(
    () => ({
      group: params.group ?? '',
      version: params.version ?? 'v1',
      plural: params.plural ?? '',
      kind: params.kind ?? '',
      namespaced: params.namespaced === '1',
      verbs: (params.verbs ?? '').split(',').filter(Boolean),
    }),
    [params.group, params.version, params.plural, params.kind, params.namespaced, params.verbs]
  );

  return <ListContent clusterId={params.id} type={type} />;
}
