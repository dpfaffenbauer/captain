import { useRouter } from 'expo-router';
import React, { useEffect, useState } from 'react';
import { ScrollView, StyleSheet, Switch, Text, TouchableOpacity, View } from 'react-native';
import { listNamespaces } from '../kube/client';
import { namespaceLabel, useClusterScope } from '../state/ClusterScope';
import { useClusters } from '../state/ClustersContext';
import { ClusterConfig } from '../types';
import {
  authenticate,
  isBiometricAvailable,
  loadAppLockSetting,
  setAppLockEnabled,
} from '../util/applock';
import { hapticWarning, loadHapticsSetting, setHapticsEnabled } from '../util/haptics';
import { BottomSheet, StatusDot } from './kit';
import { colors, radius } from './theme';

function SheetRow({
  title,
  subtitle,
  active,
  onPress,
  dotColor,
}: {
  title: string;
  subtitle?: string;
  active?: boolean;
  onPress: () => void;
  dotColor?: string;
}) {
  return (
    <TouchableOpacity
      style={[styles.row, active && styles.rowActive]}
      onPress={onPress}
    >
      {dotColor ? <StatusDot color={dotColor} /> : null}
      <View style={styles.rowText}>
        <Text style={styles.rowTitle}>{title}</Text>
        {subtitle ? <Text style={styles.rowSub}>{subtitle}</Text> : null}
      </View>
      {active ? <Text style={styles.check}>✓</Text> : null}
    </TouchableOpacity>
  );
}

export function ClusterSwitcherSheet({
  visible,
  onClose,
  activeCluster,
}: {
  visible: boolean;
  onClose: () => void;
  activeCluster: ClusterConfig;
}) {
  const router = useRouter();
  const { clusters } = useClusters();
  return (
    <BottomSheet visible={visible} onClose={onClose} title="Clusters">
      <ScrollView style={{ flexGrow: 0 }} contentContainerStyle={{ gap: 10 }}>
        {clusters.map((cluster) => (
          <SheetRow
            key={cluster.id}
            title={cluster.name}
            subtitle={cluster.server.replace(/^https?:\/\//, '')}
            dotColor={cluster.id === activeCluster.id ? colors.success : colors.textFaint}
            active={cluster.id === activeCluster.id}
            onPress={() => {
              onClose();
              if (cluster.id !== activeCluster.id) {
                router.replace(`/cluster/${cluster.id}` as never);
              }
            }}
          />
        ))}
      </ScrollView>
      <TouchableOpacity
        style={styles.addRow}
        onPress={() => {
          onClose();
          router.push('/cluster-form');
        }}
      >
        <Text style={styles.addText}>+ Add cluster</Text>
      </TouchableOpacity>
      <TouchableOpacity
        style={styles.homeRow}
        onPress={() => {
          onClose();
          router.dismissTo('/');
        }}
      >
        <Text style={styles.homeText}>⌂ All clusters</Text>
      </TouchableOpacity>
    </BottomSheet>
  );
}

export function NamespaceSheet({
  visible,
  onClose,
  cluster,
}: {
  visible: boolean;
  onClose: () => void;
  cluster: ClusterConfig;
}) {
  const { namespace, setNamespace } = useClusterScope();
  const [names, setNames] = useState<string[]>([]);

  useEffect(() => {
    if (!visible) return;
    listNamespaces(cluster)
      .then(setNames)
      .catch(() => setNames([]));
  }, [visible, cluster]);

  return (
    <BottomSheet visible={visible} onClose={onClose} title="Namespaces">
      <ScrollView style={{ flexGrow: 0 }} contentContainerStyle={{ gap: 10 }}>
        {['', ...names].map((name) => (
          <SheetRow
            key={name || '*'}
            title={namespaceLabel(name)}
            active={namespace === name}
            onPress={() => {
              setNamespace(name);
              onClose();
            }}
          />
        ))}
      </ScrollView>
    </BottomSheet>
  );
}

export function SettingsSheet({
  visible,
  onClose,
  cluster,
  onOpenNamespaces,
}: {
  visible: boolean;
  onClose: () => void;
  cluster: ClusterConfig;
  onOpenNamespaces: () => void;
}) {
  const router = useRouter();
  const { clusters, remove } = useClusters();
  const { namespace } = useClusterScope();
  const [haptics, setHaptics] = useState(true);
  const [appLock, setAppLock] = useState(false);
  const [biometrics, setBiometrics] = useState(false);

  useEffect(() => {
    if (visible) {
      void loadHapticsSetting().then(setHaptics);
      void loadAppLockSetting().then(setAppLock);
      void isBiometricAvailable().then(setBiometrics);
    }
  }, [visible]);

  const toggleAppLock = (value: boolean) => {
    if (!value) {
      // Turning the lock off requires passing it one last time.
      void authenticate().then((success) => {
        if (success) {
          setAppLock(false);
          void setAppLockEnabled(false);
        }
      });
      return;
    }
    setAppLock(true);
    void setAppLockEnabled(true);
  };

  const signOutAll = () => {
    hapticWarning();
    onClose();
    void (async () => {
      for (const entry of clusters) {
        await remove(entry.id);
      }
      router.replace('/');
    })();
  };

  return (
    <BottomSheet visible={visible} onClose={onClose} title="Settings">
      <View style={styles.profileRow}>
        <View style={styles.profileBadge}>
          <Text style={styles.profileBadgeText}>
            {cluster.name.slice(0, 2).toUpperCase()}
          </Text>
        </View>
        <View style={{ flex: 1, gap: 2 }}>
          <Text style={styles.rowTitle}>{cluster.name}</Text>
          <Text style={styles.rowSub} numberOfLines={1}>
            {cluster.server.replace(/^https?:\/\//, '')}
          </Text>
        </View>
      </View>

      <View style={styles.settingsCard}>
        <View style={styles.settingRow}>
          <View style={{ flex: 1, gap: 2 }}>
            <Text style={styles.settingTitle}>Haptics</Text>
            <Text style={styles.rowSub}>Tap feedback on destructive actions</Text>
          </View>
          <Switch
            value={haptics}
            onValueChange={(value) => {
              setHaptics(value);
              void setHapticsEnabled(value);
            }}
            trackColor={{ true: colors.accent, false: 'rgba(255,255,255,0.14)' }}
          />
        </View>
        {biometrics ? (
          <View style={[styles.settingRow, styles.settingDivider]}>
            <View style={{ flex: 1, gap: 2 }}>
              <Text style={styles.settingTitle}>Face ID lock</Text>
              <Text style={styles.rowSub}>Require Face ID when opening the app</Text>
            </View>
            <Switch
              value={appLock}
              onValueChange={toggleAppLock}
              trackColor={{ true: colors.accent, false: 'rgba(255,255,255,0.14)' }}
            />
          </View>
        ) : null}
        <TouchableOpacity
          style={[styles.settingRow, styles.settingDivider]}
          onPress={() => {
            onClose();
            onOpenNamespaces();
          }}
        >
          <Text style={styles.settingTitle}>Default namespace</Text>
          <Text style={styles.settingValue}>{namespaceLabel(namespace)} ›</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.settingRow, styles.settingDivider]}
          onPress={() => {
            onClose();
            router.push({ pathname: '/cluster-form', params: { id: cluster.id } });
          }}
        >
          <Text style={styles.settingTitle}>Edit cluster</Text>
          <Text style={styles.settingValue}>›</Text>
        </TouchableOpacity>
      </View>

      <TouchableOpacity style={styles.signOut} onPress={signOutAll}>
        <Text style={styles.signOutText}>Sign out of all clusters</Text>
      </TouchableOpacity>
      <Text style={styles.version}>Captain 1.0.0</Text>
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: colors.surfaceAlt,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.07)',
    borderRadius: radius.card,
    paddingHorizontal: 15,
    paddingVertical: 14,
  },
  rowActive: {
    backgroundColor: 'rgba(91,124,255,0.1)',
    borderColor: 'rgba(91,124,255,0.35)',
  },
  rowText: { flex: 1, gap: 2 },
  rowTitle: { color: colors.text, fontSize: 14, fontWeight: '600' },
  rowSub: { color: colors.textDim, fontSize: 11.5 },
  check: { color: colors.link, fontSize: 13, fontWeight: '700' },
  addRow: {
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: 'rgba(143,165,255,0.4)',
    borderRadius: radius.card,
    paddingVertical: 13,
    alignItems: 'center',
  },
  addText: { color: colors.link, fontSize: 14, fontWeight: '600' },
  homeRow: {
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)',
    borderRadius: radius.card,
    paddingVertical: 13,
    alignItems: 'center',
  },
  homeText: { color: colors.textDim, fontSize: 14, fontWeight: '600' },
  profileRow: { flexDirection: 'row', alignItems: 'center', gap: 13, paddingHorizontal: 2 },
  profileBadge: {
    width: 46,
    height: 46,
    borderRadius: radius.pill,
    backgroundColor: colors.accent,
    alignItems: 'center',
    justifyContent: 'center',
  },
  profileBadgeText: { color: '#fff', fontSize: 15, fontWeight: '700' },
  settingsCard: {
    backgroundColor: colors.surfaceAlt,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.07)',
    borderRadius: radius.card,
    paddingHorizontal: 15,
  },
  settingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    paddingVertical: 12,
  },
  settingDivider: { borderTopColor: colors.borderFaint, borderTopWidth: StyleSheet.hairlineWidth },
  settingTitle: { color: colors.text, fontSize: 14, fontWeight: '600' },
  settingValue: { color: 'rgba(242,245,250,0.5)', fontSize: 13 },
  signOut: {
    backgroundColor: 'rgba(251,113,133,0.08)',
    borderWidth: 1,
    borderColor: 'rgba(251,113,133,0.2)',
    borderRadius: radius.card,
    paddingVertical: 13,
    alignItems: 'center',
  },
  signOutText: { color: colors.dangerLight, fontSize: 14, fontWeight: '600' },
  version: { color: 'rgba(242,245,250,0.3)', fontSize: 11, textAlign: 'center' },
});
