import React from 'react';
import { MasterView } from '../../state/ClusterNav';
import { AlertsContent } from './AlertsContent';
import { BrowseContent } from './BrowseContent';
import { EventsContent } from './EventsContent';
import { ForwardsContent } from './ForwardsContent';
import { GitopsContent } from './GitopsContent';
import { HelmContent } from './HelmContent';
import { IndexContent } from './IndexContent';
import { KindsContent } from './KindsContent';
import { ListContent } from './ListContent';
import { SearchContent } from './SearchContent';

/** Renders the current master view for a cluster workspace (wide layout). */
export function MasterContent({ clusterId, view }: { clusterId: string; view: MasterView }) {
  switch (view.kind) {
    case 'dashboard':
      return <IndexContent clusterId={clusterId} />;
    case 'browse':
      return <BrowseContent clusterId={clusterId} />;
    case 'events':
      return <EventsContent clusterId={clusterId} />;
    case 'list':
      return <ListContent clusterId={clusterId} type={view.type} />;
    case 'helm':
      return <HelmContent clusterId={clusterId} />;
    case 'search':
      return <SearchContent clusterId={clusterId} />;
    case 'kinds':
      return <KindsContent clusterId={clusterId} category={view.category} title={view.title} />;
    case 'gitops':
      return <GitopsContent clusterId={clusterId} />;
    case 'forwards':
      return <ForwardsContent clusterId={clusterId} />;
    case 'alerts':
      return <AlertsContent clusterId={clusterId} />;
  }
}
