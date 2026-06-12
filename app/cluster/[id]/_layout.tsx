import { Stack, useLocalSearchParams, useSegments } from 'expo-router';
import React, { useRef } from 'react';
import { View } from 'react-native';
import { ClusterScopeProvider } from '../../../src/state/ClusterScope';
import { FloatingTabBar, TabKey } from '../../../src/ui/FloatingTabBar';
import { colors } from '../../../src/ui/theme';

const TAB_BY_SEGMENT: Record<string, TabKey> = {
  '[id]': 'home',
  browse: 'browse',
  events: 'events',
};

export default function ClusterLayout() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const segments = useSegments();
  const tab: TabKey | undefined = TAB_BY_SEGMENT[segments[segments.length - 1] ?? ''];
  // Remember the last tab so the bar keeps its state while sliding out on
  // detail screens (item, logs, exec, ...).
  const lastTab = useRef<TabKey>('home');
  if (tab) lastTab.current = tab;

  return (
    <ClusterScopeProvider>
      <View style={{ flex: 1 }}>
        <Stack
          screenOptions={{
            headerShown: false,
            contentStyle: { backgroundColor: colors.background },
            animation: 'slide_from_right',
          }}
        >
          <Stack.Screen name="index" options={{ animation: 'none' }} />
          <Stack.Screen name="browse" options={{ animation: 'none' }} />
          <Stack.Screen name="events" options={{ animation: 'none' }} />
        </Stack>
        <FloatingTabBar clusterId={id} active={tab ?? lastTab.current} visible={tab !== undefined} />
      </View>
    </ClusterScopeProvider>
  );
}
