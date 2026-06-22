import { Stack, useGlobalSearchParams, usePathname, useSegments } from 'expo-router';
import React, { useEffect, useRef } from 'react';
import { View } from 'react-native';
import { RouterClusterNavProvider } from '../../../src/state/ClusterNav';
import { ClusterScopeProvider } from '../../../src/state/ClusterScope';
import { AccessProvider } from '../../../src/state/AccessContext';
import { useClusterSession } from '../../../src/state/ClusterSession';
import { RouterClusterSwitchProvider } from '../../../src/state/ClusterSwitch';
import { DetailSelectionProvider } from '../../../src/state/DetailSelection';
import { DockProvider } from '../../../src/state/DockContext';
import { SidePaneProvider } from '../../../src/state/SidePaneContext';
import { ClusterWorkspaceHost } from '../../../src/ui/cluster/ClusterWorkspaceHost';
import { FloatingTabBar, TabKey } from '../../../src/ui/FloatingTabBar';
import { useResponsiveLayout } from '../../../src/ui/useResponsiveLayout';
import { colors } from '../../../src/ui/theme';

const TAB_BY_SEGMENT: Record<string, TabKey> = {
  '[id]': 'home',
  browse: 'browse',
  events: 'events',
};

export default function ClusterLayout() {
  const segments = useSegments();
  const pathname = usePathname();
  // The cluster/[id] layout stays mounted across cluster switches, so
  // useLocalSearchParams would go stale. useGlobalSearchParams tracks the
  // focused route's params and updates the active id on every switch.
  const params = useGlobalSearchParams<{ id: string }>();
  const id = params.id ?? '';
  const session = useClusterSession();
  const { isWide } = useResponsiveLayout();
  const tab: TabKey | undefined = TAB_BY_SEGMENT[segments[segments.length - 1] ?? ''];
  // Remember the last tab so the bar keeps its state while sliding out on
  // detail screens (item, logs, exec, ...).
  const lastTab = useRef<TabKey>('home');
  if (tab) lastTab.current = tab;

  // Track where the user is inside this cluster so switching back (phone) can
  // restore the route they last had open.
  useEffect(() => {
    const query = Object.entries(params)
      .filter(([key, value]) => key !== 'id' && value != null && value !== '')
      .map(([key, value]) => `${key}=${encodeURIComponent(String(value))}`)
      .join('&');
    session.rememberPath(id, query ? `${pathname}?${query}` : pathname);
  }, [id, pathname, params, session]);

  // Guard the first frame before the route param resolves.
  if (!id) return <View style={{ flex: 1, backgroundColor: colors.background }} />;

  // iPad / macOS: a keep-alive host mounts every visited cluster and toggles
  // visibility, so switching is instant and each cluster keeps its state.
  if (isWide) {
    return <ClusterWorkspaceHost initialClusterId={id} />;
  }

  // Phone: one cluster at a time, driven by the router.
  return (
    <ClusterScopeProvider clusterId={id}>
      <AccessProvider clusterId={id}>
        <SidePaneProvider>
          <DetailSelectionProvider>
            <DockProvider>
              <RouterClusterSwitchProvider activeId={id}>
              <RouterClusterNavProvider clusterId={id}>
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
                  <FloatingTabBar
                    clusterId={id}
                    active={tab ?? lastTab.current}
                    visible={tab !== undefined}
                  />
                </View>
              </RouterClusterNavProvider>
            </RouterClusterSwitchProvider>
          </DockProvider>
        </DetailSelectionProvider>
        </SidePaneProvider>
      </AccessProvider>
    </ClusterScopeProvider>
  );
}
