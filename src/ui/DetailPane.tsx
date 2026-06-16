import React from 'react';
import { DetailTarget } from '../state/DetailSelection';
import { ClusterConfig } from '../types';
import { ExecView } from './ExecView';
import { HelmReleaseView } from './HelmReleaseView';
import { ItemView } from './ItemView';
import { LogsView } from './LogsView';

export interface DetailPaneProps {
  cluster: ClusterConfig;
  target: DetailTarget;
  /** Push a new target onto the pane stack (drilldown). */
  onNavigate: (target: DetailTarget) => void;
  /** Pop to the previous pane entry; absent when this is the root. */
  onBack?: () => void;
  /** Dismiss the pane entirely. */
  onClose: () => void;
  /** Open the port-forwards list. */
  onShowForwards?: () => void;
}

/**
 * Renders a detail target inside a split-view pane, switching on its kind. The
 * owning screen keeps a stack of targets so drilldown and back work in place.
 */
export function DetailPane({
  cluster,
  target,
  onNavigate,
  onBack,
  onClose,
  onShowForwards,
}: DetailPaneProps) {
  switch (target.kind) {
    case 'item':
      return (
        <ItemView
          cluster={cluster}
          type={target.type}
          name={target.name}
          namespace={target.namespace}
          mode="pane"
          onNavigate={onNavigate}
          onClose={onClose}
          onBack={onBack}
          onShowForwards={onShowForwards}
        />
      );
    case 'helm-release':
      return (
        <HelmReleaseView
          cluster={cluster}
          namespace={target.namespace}
          name={target.name}
          revision={target.revision}
          secretName={target.secretName}
          mode="pane"
          onClose={onClose}
          onBack={onBack}
        />
      );
    case 'logs':
      return (
        <LogsView
          cluster={cluster}
          namespace={target.namespace}
          name={target.name}
          containers={target.containers}
          previous={target.previous}
          mode="pane"
          onClose={onClose}
          onBack={onBack}
        />
      );
    case 'exec':
      return (
        <ExecView
          cluster={cluster}
          namespace={target.namespace}
          name={target.name}
          container={target.container}
          mode="pane"
          onClose={onClose}
          onBack={onBack}
        />
      );
  }
}
