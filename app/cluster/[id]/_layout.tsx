import { Stack, useLocalSearchParams, useSegments } from 'expo-router';
import React, { useRef } from 'react';
import { View } from 'react-native';
import { ClusterScopeProvider } from '../../../src/state/ClusterScope';
import { DetailSelectionProvider } from '../../../src/state/DetailSelection';
import { DockProvider } from '../../../src/state/DockContext';
import { SidePaneProvider } from '../../../src/state/SidePaneContext';
import { BottomDock } from '../../../src/ui/BottomDock';
import { DetailSidebar } from '../../../src/ui/DetailSidebar';
import { FloatingTabBar, TabKey } from '../../../src/ui/FloatingTabBar';
import { Sidebar } from '../../../src/ui/Sidebar';
import { useResponsiveLayout } from '../../../src/ui/useResponsiveLayout';
import { colors } from '../../../src/ui/theme';

const TAB_BY_SEGMENT: Record<string, TabKey> = {
  '[id]': 'home',
  browse: 'browse',
  events: 'events',
};

export default function ClusterLayout() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const segments = useSegments();
  const { isWide } = useResponsiveLayout();
  const tab: TabKey | undefined = TAB_BY_SEGMENT[segments[segments.length - 1] ?? ''];
  // Remember the last tab so the bar keeps its state while sliding out on
  // detail screens (item, logs, exec, ...).
  const lastTab = useRef<TabKey>('home');
  if (tab) lastTab.current = tab;

  const stack = (
    <Stack
      screenOptions={{
        headerShown: false,
        contentStyle: { backgroundColor: colors.background },
        animation: isWide ? 'none' : 'slide_from_right',
      }}
    >
      <Stack.Screen name="index" options={{ animation: 'none' }} />
      <Stack.Screen name="browse" options={{ animation: 'none' }} />
      <Stack.Screen name="events" options={{ animation: 'none' }} />
    </Stack>
  );

  return (
    <ClusterScopeProvider>
      <SidePaneProvider>
      <DetailSelectionProvider>
      <DockProvider>
        {isWide ? (
          <View style={{ flex: 1, flexDirection: 'row', backgroundColor: colors.background }}>
            <Sidebar clusterId={id} />
            <View style={{ flex: 1 }}>
              <View style={{ flex: 1, flexDirection: 'row' }}>
                <View style={{ flex: 1 }}>{stack}</View>
                <DetailSidebar clusterId={id} />
              </View>
              <BottomDock clusterId={id} />
            </View>
          </View>
        ) : (
          <View style={{ flex: 1 }}>
            {stack}
            <FloatingTabBar
              clusterId={id}
              active={tab ?? lastTab.current}
              visible={tab !== undefined}
            />
          </View>
        )}
      </DockProvider>
      </DetailSelectionProvider>
      </SidePaneProvider>
    </ClusterScopeProvider>
  );
}
