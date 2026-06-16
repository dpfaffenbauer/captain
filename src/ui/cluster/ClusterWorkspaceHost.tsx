import React, { useEffect, useMemo, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { ClusterSwitchProvider } from '../../state/ClusterSwitch';
import { ClusterIconRail } from '../ClusterIconRail';
import { colors } from '../theme';
import { ClusterWorkspace } from './ClusterWorkspace';

/**
 * Keep-alive host for the iPad/macOS layout: mounts every visited cluster and
 * just toggles which one is visible, so switching clusters is instant and each
 * cluster keeps its full state (view, scroll, detail pane, dock, watches).
 */
export function ClusterWorkspaceHost({ initialClusterId }: { initialClusterId: string }) {
  const [activeId, setActiveId] = useState(initialClusterId);
  const [visited, setVisited] = useState<string[]>([initialClusterId]);

  // Entering a cluster from outside (deep link, the cluster list) changes the
  // route param: pull that cluster in and make it active.
  useEffect(() => {
    setVisited((current) => (current.includes(initialClusterId) ? current : [...current, initialClusterId]));
    setActiveId(initialClusterId);
  }, [initialClusterId]);

  const switchValue = useMemo(
    () => ({
      activeId,
      switchTo: (id: string) => {
        setVisited((current) => (current.includes(id) ? current : [...current, id]));
        setActiveId(id);
      },
    }),
    [activeId]
  );

  return (
    <ClusterSwitchProvider value={switchValue}>
      <View style={styles.root}>
        <ClusterIconRail clusterId={activeId} />
        <View style={{ flex: 1 }}>
          {visited.map((id) => (
            <ClusterWorkspace key={id} clusterId={id} visible={id === activeId} />
          ))}
        </View>
      </View>
    </ClusterSwitchProvider>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, flexDirection: 'row', backgroundColor: colors.background },
});
