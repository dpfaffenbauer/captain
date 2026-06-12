import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import React, { useEffect } from 'react';
import { ClustersProvider } from '../src/state/ClustersContext';
import { colors } from '../src/ui/theme';
import { loadHapticsSetting } from '../src/util/haptics';

export default function RootLayout() {
  useEffect(() => {
    void loadHapticsSetting();
  }, []);
  return (
    <ClustersProvider>
      <StatusBar style="light" />
      <Stack
        screenOptions={{
          headerStyle: { backgroundColor: colors.background },
          headerTintColor: colors.text,
          headerTitleStyle: { color: colors.text },
          headerShadowVisible: false,
          contentStyle: { backgroundColor: colors.background },
        }}
      >
        <Stack.Screen name="index" options={{ headerShown: false }} />
        <Stack.Screen name="cluster-form" options={{ title: 'Cluster' }} />
        <Stack.Screen name="kubeconfig-import" options={{ title: 'Kubeconfig importieren' }} />
        <Stack.Screen name="qr-scan" options={{ title: 'QR-Code scannen' }} />
        <Stack.Screen name="cluster/[id]" options={{ headerShown: false }} />
      </Stack>
    </ClustersProvider>
  );
}
