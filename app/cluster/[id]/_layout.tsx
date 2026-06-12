import { Stack } from 'expo-router';
import React from 'react';
import { ClusterScopeProvider } from '../../../src/state/ClusterScope';
import { colors } from '../../../src/ui/theme';

export default function ClusterLayout() {
  return (
    <ClusterScopeProvider>
      <Stack
        screenOptions={{
          headerShown: false,
          contentStyle: { backgroundColor: colors.background },
          animation: 'slide_from_right',
        }}
      >
        <Stack.Screen name="index" options={{ animation: 'fade' }} />
        <Stack.Screen name="browse" options={{ animation: 'fade' }} />
        <Stack.Screen name="events" options={{ animation: 'fade' }} />
      </Stack>
    </ClusterScopeProvider>
  );
}
