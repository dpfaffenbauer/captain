import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { AppState, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { syncBackgroundAlerts } from '../src/background/alerts';
import { ClusterSessionProvider } from '../src/state/ClusterSession';
import { ClusterStatusProvider } from '../src/state/ClusterStatusContext';
import { ClustersProvider } from '../src/state/ClustersContext';
import { FavoritesProvider } from '../src/state/FavoritesContext';
import { UiScaleProvider } from '../src/state/UiScaleContext';
import { colors } from '../src/ui/theme';
import { authenticate, loadAppLockSetting } from '../src/util/applock';
import { loadHapticsSetting } from '../src/util/haptics';

/**
 * Optional Face ID gate: the app holds cluster-admin credentials, so when the
 * lock is enabled the content is hidden until biometrics (or the device
 * passcode) succeed — on every cold start and whenever the app returns from
 * the background.
 */
function AppLockGate({ children }: { children: React.ReactNode }) {
  const [locked, setLocked] = useState<boolean | null>(null);
  const prompting = useRef(false);

  const unlock = useCallback(async () => {
    if (prompting.current) return;
    prompting.current = true;
    const success = await authenticate();
    prompting.current = false;
    if (success) setLocked(false);
  }, []);

  useEffect(() => {
    void loadAppLockSetting().then((enabled) => {
      setLocked(enabled);
      if (enabled) void unlock();
    });
  }, [unlock]);

  useEffect(() => {
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'background') {
        void loadAppLockSetting().then((enabled) => {
          if (enabled) setLocked(true);
        });
      } else if (state === 'active') {
        setLocked((current) => {
          if (current) void unlock();
          return current;
        });
      }
    });
    return () => subscription.remove();
  }, [unlock]);

  if (locked === null) return <View style={styles.lockScreen} />;

  return (
    <View style={{ flex: 1 }}>
      {children}
      {locked ? (
        <View style={styles.lockScreen}>
          <View style={styles.lockLogo}>
            <Text style={styles.lockGlyph}>⎈</Text>
          </View>
          <Text style={styles.lockTitle}>Captain is locked</Text>
          <TouchableOpacity style={styles.lockButton} onPress={() => void unlock()}>
            <Text style={styles.lockButtonText}>Unlock with Face ID</Text>
          </TouchableOpacity>
        </View>
      ) : null}
    </View>
  );
}

export default function RootLayout() {
  useEffect(() => {
    void loadHapticsSetting();
    void syncBackgroundAlerts();
  }, []);
  return (
    <UiScaleProvider>
    <ClustersProvider>
      <FavoritesProvider>
      <ClusterSessionProvider>
      <ClusterStatusProvider>
      <StatusBar style="light" />
      <AppLockGate>
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
          <Stack.Screen name="open" options={{ headerShown: false }} />
          <Stack.Screen name="cluster-form" options={{ title: 'Cluster' }} />
          <Stack.Screen name="kubeconfig-import" options={{ title: 'Import kubeconfig' }} />
          <Stack.Screen name="qr-scan" options={{ title: 'Scan QR code' }} />
          {/* No swipe-to-exit: leaving a cluster happens via the switcher, not
              an accidental left-edge swipe. */}
          <Stack.Screen
            name="cluster/[id]"
            options={{ headerShown: false, gestureEnabled: false }}
          />
        </Stack>
      </AppLockGate>
      </ClusterStatusProvider>
      </ClusterSessionProvider>
      </FavoritesProvider>
    </ClustersProvider>
    </UiScaleProvider>
  );
}

const styles = StyleSheet.create({
  lockScreen: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: colors.background,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 18,
  },
  lockLogo: {
    width: 84,
    height: 84,
    borderRadius: 24,
    backgroundColor: '#5577F2',
    alignItems: 'center',
    justifyContent: 'center',
  },
  lockGlyph: { color: '#fff', fontSize: 46 },
  lockTitle: { color: colors.text, fontSize: 17, fontWeight: '700' },
  lockButton: {
    backgroundColor: colors.accent,
    borderRadius: 999,
    paddingHorizontal: 22,
    paddingVertical: 11,
  },
  lockButtonText: { color: '#fff', fontSize: 14, fontWeight: '600' },
});
