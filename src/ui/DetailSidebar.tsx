import React from 'react';
import { useClusterNav } from '../state/ClusterNav';
import { useClusters } from '../state/ClustersContext';
import { detailKey, useDetailSelection } from '../state/DetailSelection';
import { useDock } from '../state/DockContext';
import { DetailPane } from './DetailPane';
import { SidePane } from './SidePane';

/**
 * Persistent right detail rail (wide screens). Mirrors the left nav sidebar:
 * it lives at the layout level, is resizable, and any list can populate it via
 * useDetailSelection. Logs/exec route to the bottom dock instead.
 */
export function DetailSidebar({ clusterId }: { clusterId: string }) {
  const nav = useClusterNav();
  const { getById } = useClusters();
  const cluster = getById(clusterId);
  const { stack, push, back, close } = useDetailSelection();
  const dock = useDock();

  if (!cluster || stack.length === 0) return null;
  const top = stack[stack.length - 1];

  return (
    <SidePane>
      <DetailPane
        key={detailKey(top)}
        cluster={cluster}
        target={top}
        onNavigate={(target) => {
          if (target.kind === 'logs') dock.openLogs(target);
          else if (target.kind === 'exec') dock.openExec(target);
          else push(target);
        }}
        onBack={stack.length > 1 ? back : undefined}
        onClose={close}
        onShowForwards={() => nav.show({ kind: 'forwards' })}
      />
    </SidePane>
  );
}
