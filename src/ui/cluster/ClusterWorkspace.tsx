import React, { useMemo, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import {
  ClusterNav,
  ClusterNavProvider,
  MasterView,
} from '../../state/ClusterNav';
import { ClusterScopeProvider } from '../../state/ClusterScope';
import { AccessProvider } from '../../state/AccessContext';
import { DetailSelectionProvider, useDetailSelection } from '../../state/DetailSelection';
import { DockProvider, useDock } from '../../state/DockContext';
import { SidePaneProvider } from '../../state/SidePaneContext';
import { BottomDock } from '../BottomDock';
import { DetailSidebar } from '../DetailSidebar';
import { Sidebar } from '../Sidebar';
import { colors } from '../theme';
import { MasterContent } from './MasterContent';

/** Primary tabs reset the back trail; deeper views push onto it. */
const REPLACE_KINDS = new Set<MasterView['kind']>(['dashboard', 'browse', 'events']);

/**
 * One fully-mounted cluster, kept alive while hidden so switching back is
 * instant and preserves the view, scroll, detail pane, dock, and namespace.
 * Owns its own per-cluster providers and in-memory master navigation.
 */
export function ClusterWorkspace({
  clusterId,
  visible,
}: {
  clusterId: string;
  visible: boolean;
}) {
  return (
    <View
      style={[styles.fill, !visible && styles.hidden]}
      pointerEvents={visible ? 'auto' : 'none'}
    >
      <ClusterScopeProvider clusterId={clusterId}>
        <AccessProvider clusterId={clusterId}>
          <SidePaneProvider>
            <DetailSelectionProvider>
              <DockProvider>
                <WorkspaceInner clusterId={clusterId} />
              </DockProvider>
            </DetailSelectionProvider>
          </SidePaneProvider>
        </AccessProvider>
      </ClusterScopeProvider>
    </View>
  );
}

function WorkspaceInner({ clusterId }: { clusterId: string }) {
  const [history, setHistory] = useState<MasterView[]>([{ kind: 'dashboard' }]);
  const current = history[history.length - 1];
  const detail = useDetailSelection();
  const dock = useDock();

  const nav = useMemo<ClusterNav>(
    () => ({
      clusterId,
      embedded: true,
      current,
      show: (view) =>
        setHistory((h) => (REPLACE_KINDS.has(view.kind) ? [view] : [...h, view])),
      back: () => setHistory((h) => (h.length > 1 ? h.slice(0, -1) : h)),
      openItem: (type, name, namespace) =>
        detail.open({ kind: 'item', type, name, namespace }),
      openHelmRelease: (target) => detail.open({ kind: 'helm-release', ...target }),
      openLogs: (target) => dock.openLogs({ kind: 'logs', ...target }),
      openExec: (target) => dock.openExec({ kind: 'exec', ...target }),
    }),
    [clusterId, current, detail, dock]
  );

  return (
    <ClusterNavProvider value={nav}>
      <View style={styles.row}>
        <Sidebar clusterId={clusterId} />
        <View style={{ flex: 1 }}>
          <View style={{ flex: 1, flexDirection: 'row' }}>
            <View style={{ flex: 1 }}>
              <MasterContent clusterId={clusterId} view={current} />
            </View>
            <DetailSidebar clusterId={clusterId} />
          </View>
          <BottomDock clusterId={clusterId} />
        </View>
      </View>
    </ClusterNavProvider>
  );
}

const styles = StyleSheet.create({
  fill: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: colors.background },
  hidden: { display: 'none' },
  row: { flex: 1, flexDirection: 'row' },
});
