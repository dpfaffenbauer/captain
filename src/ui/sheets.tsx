import { useRouter } from 'expo-router';
import * as WebBrowser from 'expo-web-browser';
import React, { useEffect, useState } from 'react';
import {
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TouchableOpacity,
  useWindowDimensions,
  View,
} from 'react-native';
import { listNamespaces } from '../kube/client';
import { PromAlert } from '../kube/prometheus';
import { namespaceLabel, useClusterScope } from '../state/ClusterScope';
import { ConnectionState, useClusterStatus } from '../state/ClusterStatusContext';
import { useClusterSwitch } from '../state/ClusterSwitch';
import { useClusters } from '../state/ClustersContext';
import { UI_SCALE_OPTIONS, useUiScale } from '../state/UiScaleContext';
import { ClusterConfig } from '../types';
import {
  loadBackgroundAlertsSetting,
  setBackgroundAlertsEnabled,
} from '../background/alerts';
import {
  authenticate,
  isBiometricAvailable,
  loadAppLockSetting,
  setAppLockEnabled,
} from '../util/applock';
import { ageOf } from '../util/format';
import { hapticWarning, loadHapticsSetting, setHapticsEnabled } from '../util/haptics';
import { BottomSheet, StatusDot } from './kit';
import { colors, radius } from './theme';

function connectionColor(state: ConnectionState): string {
  switch (state) {
    case 'connected':
      return colors.success;
    case 'error':
      return colors.danger;
    case 'checking':
      return colors.warning;
    default:
      return colors.textFaint;
  }
}

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

/**
 * Tappable pill showing the active cluster; opens the cluster switcher sheet.
 * Drop it into a screen header to switch clusters from anywhere.
 */
export function ClusterSwitcherButton({
  cluster,
  online = true,
}: {
  cluster: ClusterConfig;
  online?: boolean;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <TouchableOpacity style={styles.switcherPill} onPress={() => setOpen(true)}>
        <StatusDot color={online ? colors.success : colors.danger} size={8} />
        <Text style={styles.switcherPillText} numberOfLines={1}>
          {cluster.name}
        </Text>
        <Text style={styles.switcherPillChevron}>⌄</Text>
      </TouchableOpacity>
      <ClusterSwitcherSheet
        visible={open}
        onClose={() => setOpen(false)}
        activeCluster={cluster}
      />
    </>
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
  const { switchTo } = useClusterSwitch();
  const { statusOf } = useClusterStatus();
  return (
    <BottomSheet visible={visible} onClose={onClose} title="Clusters">
      <ScrollView style={{ flexGrow: 0 }} contentContainerStyle={{ gap: 10 }}>
        {clusters.map((cluster) => (
          <SheetRow
            key={cluster.id}
            title={cluster.name}
            subtitle={cluster.server.replace(/^https?:\/\//, '')}
            dotColor={connectionColor(statusOf(cluster.id))}
            active={cluster.id === activeCluster.id}
            onPress={() => {
              onClose();
              switchTo(cluster.id);
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

export interface FlyoutAnchor {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * Cluster switcher as a flyout panel anchored to its trigger — used in the
 * iPad/macOS sidebar, where it drops out next to the cluster pill instead of
 * sliding up as a full-width sheet. Pass the measured trigger rect as `anchor`.
 */
export function ClusterSwitcherFlyout({
  visible,
  onClose,
  activeCluster,
  anchor,
}: {
  visible: boolean;
  onClose: () => void;
  activeCluster: ClusterConfig;
  anchor: FlyoutAnchor | null;
}) {
  const router = useRouter();
  const { clusters } = useClusters();
  const { switchTo: switchCluster } = useClusterSwitch();
  const { statusOf } = useClusterStatus();
  const { height } = useWindowDimensions();
  if (!anchor) return null;
  const top = anchor.y + anchor.height + 6;

  const switchTo = (id: string) => {
    onClose();
    switchCluster(id);
  };

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={StyleSheet.absoluteFill} onPress={onClose} />
      <View style={[styles.flyout, { top, left: anchor.x, maxHeight: height - top - 24 }]}>
        <ScrollView
          style={{ flexGrow: 0 }}
          contentContainerStyle={{ gap: 8 }}
          showsVerticalScrollIndicator={false}
        >
          {clusters.map((cluster) => (
            <SheetRow
              key={cluster.id}
              title={cluster.name}
              subtitle={cluster.server.replace(/^https?:\/\//, '')}
              dotColor={connectionColor(statusOf(cluster.id))}
              active={cluster.id === activeCluster.id}
              onPress={() => switchTo(cluster.id)}
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
      </View>
    </Modal>
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
  const { scale, setScale } = useUiScale();
  const [haptics, setHaptics] = useState(true);
  const [appLock, setAppLock] = useState(false);
  const [biometrics, setBiometrics] = useState(false);
  const [bgAlerts, setBgAlerts] = useState(false);

  useEffect(() => {
    if (visible) {
      void loadHapticsSetting().then(setHaptics);
      void loadAppLockSetting().then(setAppLock);
      void isBiometricAvailable().then(setBiometrics);
      void loadBackgroundAlertsSetting().then(setBgAlerts);
    }
  }, [visible]);

  const toggleBgAlerts = (value: boolean) => {
    setBgAlerts(value);
    void setBackgroundAlertsEnabled(value).then((granted) => {
      // Roll the switch back when notification permission was denied.
      if (value && !granted) setBgAlerts(false);
    });
  };

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
        <View style={[styles.settingRow, styles.settingDivider]}>
          <View style={{ flex: 1, gap: 2 }}>
            <Text style={styles.settingTitle}>Interface size</Text>
            <Text style={styles.rowSub}>Scale text and controls (bigger on macOS)</Text>
          </View>
          <View style={styles.segment}>
            {UI_SCALE_OPTIONS.map((option) => {
              const active = Math.abs(scale - option.value) < 0.001;
              return (
                <TouchableOpacity
                  key={option.label}
                  style={[styles.segmentItem, active && styles.segmentItemActive]}
                  onPress={() => setScale(option.value)}
                >
                  <Text style={[styles.segmentText, active && styles.segmentTextActive]}>
                    {option.label}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>
        </View>
        <View style={[styles.settingRow, styles.settingDivider]}>
          <View style={{ flex: 1, gap: 2 }}>
            <Text style={styles.settingTitle}>Background alerts</Text>
            <Text style={styles.rowSub}>Notify when a cluster degrades (best effort)</Text>
          </View>
          <Switch
            value={bgAlerts}
            onValueChange={toggleBgAlerts}
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

function severityColor(severity: string): string {
  if (severity === 'critical' || severity === 'error') return colors.danger;
  if (severity === 'warning') return colors.warning;
  return colors.link;
}

/** Hide labels already shown as structured fields / not useful on their own. */
const HIDDEN_ALERT_LABELS = new Set(['alertname', 'severity']);

/** Full detail view for a single firing Prometheus alert. */
export function AlertSheet({
  visible,
  onClose,
  alert,
  onOpenPod,
}: {
  visible: boolean;
  onClose: () => void;
  alert: PromAlert | null;
  onOpenPod?: (namespace: string, pod: string) => void;
}) {
  if (!alert) return null;
  const tone = severityColor(alert.severity);
  const since = ageOf(alert.activeAt);
  const labelEntries = Object.entries(alert.labels)
    .filter(([key]) => !HIDDEN_ALERT_LABELS.has(key))
    .sort(([a], [b]) => a.localeCompare(b));
  const canOpenPod = Boolean(alert.namespace && alert.pod && onOpenPod);

  return (
    <BottomSheet visible={visible} onClose={onClose} title={alert.name}>
      <ScrollView style={{ flexGrow: 0 }} contentContainerStyle={{ gap: 14 }}>
        <View style={styles.alertMetaRow}>
          <View style={[styles.severityPill, { backgroundColor: `${tone}26`, borderColor: `${tone}55` }]}>
            <StatusDot color={tone} size={7} />
            <Text style={[styles.severityText, { color: tone }]}>{alert.severity}</Text>
          </View>
          {since ? <Text style={styles.alertSince}>firing since {since}</Text> : null}
        </View>

        {alert.summary ? <Text style={styles.alertSummary}>{alert.summary}</Text> : null}
        {alert.description ? <Text style={styles.alertDescription}>{alert.description}</Text> : null}
        {alert.value ? (
          <Text style={styles.alertDescription}>
            <Text style={styles.alertValueLabel}>Value: </Text>
            {alert.value}
          </Text>
        ) : null}

        {labelEntries.length > 0 ? (
          <View style={styles.settingsCard}>
            {labelEntries.map(([key, value], index) => (
              <View key={key} style={[styles.labelRow, index > 0 && styles.settingDivider]}>
                <Text style={styles.labelKey}>{key}</Text>
                <Text style={styles.labelValue} numberOfLines={1}>
                  {value}
                </Text>
              </View>
            ))}
          </View>
        ) : null}

        {canOpenPod ? (
          <TouchableOpacity
            style={styles.alertAction}
            onPress={() => {
              onClose();
              onOpenPod?.(alert.namespace ?? '', alert.pod ?? '');
            }}
          >
            <Text style={styles.alertActionText}>Open pod {alert.pod}</Text>
          </TouchableOpacity>
        ) : null}
        {alert.runbookUrl ? (
          <TouchableOpacity
            style={styles.alertActionGhost}
            onPress={() => void WebBrowser.openBrowserAsync(alert.runbookUrl ?? '')}
          >
            <Text style={styles.alertActionGhostText}>Open runbook ↗</Text>
          </TouchableOpacity>
        ) : null}
      </ScrollView>
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  switcherPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    alignSelf: 'flex-start',
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.pill,
    paddingVertical: 8,
    paddingLeft: 12,
    paddingRight: 14,
  },
  switcherPillText: { color: colors.text, fontSize: 13.5, fontWeight: '600', flexShrink: 1 },
  switcherPillChevron: { color: colors.textDim, fontSize: 12, marginTop: -4 },
  flyout: {
    position: 'absolute',
    width: 300,
    backgroundColor: colors.sheet,
    borderRadius: radius.card,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 12,
    gap: 8,
    shadowColor: '#000',
    shadowOpacity: 0.45,
    shadowRadius: 24,
    shadowOffset: { width: 0, height: 12 },
    elevation: 16,
  },
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
  segment: {
    flexDirection: 'row',
    backgroundColor: 'rgba(255,255,255,0.06)',
    borderRadius: radius.pill,
    padding: 3,
    gap: 2,
  },
  segmentItem: { paddingHorizontal: 11, paddingVertical: 6, borderRadius: radius.pill },
  segmentItemActive: { backgroundColor: colors.accent },
  segmentText: { color: colors.textDim, fontSize: 12, fontWeight: '600' },
  segmentTextActive: { color: '#fff' },
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
  alertMetaRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  severityPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    borderWidth: 1,
    borderRadius: radius.pill,
    paddingHorizontal: 10,
    paddingVertical: 5,
  },
  severityText: { fontSize: 12, fontWeight: '700', textTransform: 'capitalize' },
  alertSince: { color: colors.textDim, fontSize: 12.5 },
  alertSummary: { color: colors.text, fontSize: 15, fontWeight: '600', lineHeight: 21 },
  alertDescription: { color: colors.textMid, fontSize: 13, lineHeight: 19 },
  alertValueLabel: { color: colors.textDim, fontWeight: '600' },
  labelRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 14,
    paddingVertical: 11,
    paddingHorizontal: 15,
  },
  labelKey: { color: colors.monoKey, fontSize: 12.5, fontWeight: '600' },
  labelValue: { color: colors.text, fontSize: 12.5, flexShrink: 1, textAlign: 'right' },
  alertAction: {
    backgroundColor: colors.accentSoft,
    borderRadius: radius.card,
    paddingVertical: 13,
    alignItems: 'center',
  },
  alertActionText: { color: '#fff', fontSize: 14, fontWeight: '600' },
  alertActionGhost: {
    borderWidth: 1,
    borderColor: 'rgba(143,165,255,0.4)',
    borderRadius: radius.card,
    paddingVertical: 13,
    alignItems: 'center',
  },
  alertActionGhostText: { color: colors.link, fontSize: 14, fontWeight: '600' },
});
