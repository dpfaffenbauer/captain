import { ApiResourceType, ClusterConfig, KubeListItem } from '../types';
import { resourceBasePath } from './client';
import { isStreamingAvailable, kubeStream, KubeStreamHandle, lineSplitter } from './stream';

export type WatchEventType = 'ADDED' | 'MODIFIED' | 'DELETED';

export interface WatchEvent {
  type: WatchEventType;
  item: KubeListItem;
}

export interface WatchHandlers {
  onEvent: (event: WatchEvent) => void;
  /**
   * The watch needs a fresh list: the resourceVersion expired (HTTP 410 /
   * ERROR event) or the connection dropped unexpectedly.
   */
  onStale: () => void;
  /** Clean end of the stream (also after stop()-less server closes). */
  onEnd?: () => void;
}

/** True when live list updates are supported in this build. */
export function isWatchAvailable(): boolean {
  return isStreamingAvailable();
}

/**
 * Watches a resource collection from the given resourceVersion and emits
 * ADDED/MODIFIED/DELETED events (`?watch=true`, newline-delimited JSON).
 */
export async function watchResources(
  cluster: ClusterConfig,
  type: ApiResourceType,
  options: { namespace?: string; resourceVersion: string },
  handlers: WatchHandlers
): Promise<KubeStreamHandle> {
  const params = new URLSearchParams();
  params.set('watch', 'true');
  params.set('resourceVersion', options.resourceVersion);
  params.set('allowWatchBookmarks', 'true');
  const path = `${resourceBasePath(type, options.namespace)}?${params.toString()}`;

  let stale = false;
  const onLine = lineSplitter((line) => {
    if (!line.trim() || stale) return;
    let event: { type?: string; object?: any };
    try {
      event = JSON.parse(line);
    } catch {
      return;
    }
    if (event.type === 'ERROR') {
      // Typically 410 Gone: the resourceVersion is too old, re-list needed.
      stale = true;
      handlers.onStale();
      return;
    }
    if (event.type !== 'ADDED' && event.type !== 'MODIFIED' && event.type !== 'DELETED') return;
    const metadata = event.object?.metadata;
    if (!metadata?.name) return;
    handlers.onEvent({
      type: event.type,
      item: {
        name: metadata.name,
        namespace: metadata.namespace,
        creationTimestamp: metadata.creationTimestamp,
        raw: event.object as Record<string, unknown>,
      },
    });
  });

  return kubeStream(cluster, path, {
    onChunk: onLine,
    onEnd: (error) => {
      if (stale) return;
      if (error) {
        handlers.onStale();
      } else {
        handlers.onEnd?.();
      }
    },
  });
}
