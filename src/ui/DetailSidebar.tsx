import React, { useEffect, useRef, useState } from 'react';
import { Animated, StyleSheet } from 'react-native';
import { useClusterNav } from '../state/ClusterNav';
import { useClusters } from '../state/ClustersContext';
import { DetailTarget, detailKey, useDetailSelection } from '../state/DetailSelection';
import { useDock } from '../state/DockContext';
import { useSidePane } from '../state/SidePaneContext';
import { DetailPane } from './DetailPane';
import { SidePane } from './SidePane';
import { colors } from './theme';

/**
 * Right detail rail (wide screens). It floats ON TOP of the master content as
 * an overlay sliding in from the right, so the list keeps its full width (no
 * truncated names) while the pane is open. Logs/exec route to the bottom dock.
 *
 * The slide-in also masks the brief fetch; the pane's own views show a loading
 * indicator if the API is slow.
 */
export function DetailSidebar({ clusterId }: { clusterId: string }) {
  const nav = useClusterNav();
  const { getById } = useClusters();
  const cluster = getById(clusterId);
  const { stack, push, back, close } = useDetailSelection();
  const dock = useDock();
  const { width } = useSidePane();

  const hasContent = stack.length > 0;
  const [mounted, setMounted] = useState(hasContent);
  // Offscreen to the right when closed; 0 when open.
  const tx = useRef(new Animated.Value(hasContent ? 0 : width)).current;
  const wasOpen = useRef(hasContent);
  // Keep the last target rendered while the close animation plays out.
  const lastTarget = useRef<DetailTarget | null>(stack[stack.length - 1] ?? null);
  if (hasContent) lastTarget.current = stack[stack.length - 1];

  useEffect(() => {
    if (hasContent) {
      setMounted(true);
      if (!wasOpen.current) {
        tx.setValue(width);
        Animated.spring(tx, {
          toValue: 0,
          useNativeDriver: true,
          friction: 11,
          tension: 90,
        }).start();
      }
      wasOpen.current = true;
    } else if (wasOpen.current) {
      wasOpen.current = false;
      Animated.timing(tx, { toValue: width, duration: 180, useNativeDriver: true }).start(
        ({ finished }) => {
          if (finished) setMounted(false);
        }
      );
    }
  }, [hasContent, width, tx]);

  const target = stack[stack.length - 1] ?? lastTarget.current;
  if (!cluster || !mounted || !target) return null;

  return (
    <Animated.View style={[styles.overlay, { width, transform: [{ translateX: tx }] }]}>
      <SidePane>
        <DetailPane
          key={detailKey(target)}
          cluster={cluster}
          target={target}
          onNavigate={(next) => {
            if (next.kind === 'logs') dock.openLogs(next);
            else if (next.kind === 'exec') dock.openExec(next);
            else push(next);
          }}
          onBack={stack.length > 1 ? back : undefined}
          onClose={close}
          onShowForwards={() => nav.show({ kind: 'forwards' })}
        />
      </SidePane>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  overlay: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    flexDirection: 'row',
    backgroundColor: colors.background,
    zIndex: 20,
    shadowColor: '#000',
    shadowOffset: { width: -6, height: 0 },
    shadowOpacity: 0.35,
    shadowRadius: 16,
    elevation: 16,
  },
});
