import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import React from 'react';
import { ClustersProvider } from '../src/state/ClustersContext';
import { colors } from '../src/ui/theme';

export default function RootLayout() {
  return (
    <ClustersProvider>
      <StatusBar style="light" />
      <Stack
        screenOptions={{
          headerStyle: { backgroundColor: colors.surface },
          headerTintColor: colors.text,
          headerTitleStyle: { color: colors.text },
          contentStyle: { backgroundColor: colors.background },
        }}
      >
        <Stack.Screen name="index" options={{ title: 'Captain' }} />
        <Stack.Screen name="cluster-form" options={{ title: 'Cluster' }} />
        <Stack.Screen name="kubeconfig-import" options={{ title: 'Kubeconfig importieren' }} />
        <Stack.Screen name="cluster/[id]/index" options={{ title: 'Ressourcen' }} />
        <Stack.Screen name="cluster/[id]/list" options={{ title: 'Liste' }} />
        <Stack.Screen name="cluster/[id]/item" options={{ title: 'Details' }} />
      </Stack>
    </ClustersProvider>
  );
}
