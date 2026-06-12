import {
  isNativeTransportAvailable,
  nativeStreamStart,
  NativeStreamHandle,
} from '../../modules/kube-http';
import { getBearerToken } from '../auth/tokens';
import { ClusterConfig } from '../types';
import { tlsOptionsOf } from './transport';

export interface KubeStreamHandlers {
  onChunk: (data: string) => void;
  /** Called once when the stream ends; `error` is undefined on a clean close. */
  onEnd: (error?: string) => void;
}

export interface KubeStreamHandle {
  stop(): void;
}

/** True when streaming requests (log follow, watch) are supported in this build. */
export function isStreamingAvailable(): boolean {
  return isNativeTransportAvailable();
}

/**
 * Opens an authenticated streaming GET against the cluster's API server
 * (log follow, watch API). Requires the native KubeHttp module.
 */
export async function kubeStream(
  cluster: ClusterConfig,
  path: string,
  handlers: KubeStreamHandlers
): Promise<KubeStreamHandle> {
  if (!isNativeTransportAvailable()) {
    throw new Error('Streaming requires the development build (native KubeHttp module).');
  }
  const server = cluster.server.replace(/\/+$/, '');
  const headers: Record<string, string> = { Accept: 'application/json' };
  const token = await getBearerToken(cluster);
  if (token) headers.Authorization = `Bearer ${token}`;

  const handle: NativeStreamHandle = await nativeStreamStart(
    {
      url: `${server}${path}`,
      method: 'GET',
      headers,
      ...tlsOptionsOf(cluster),
    },
    handlers
  );
  return handle;
}

/**
 * Splits a chunked stream into complete lines (newline-delimited JSON for the
 * watch API, log lines for follow). Carries partial lines across chunks.
 */
export function lineSplitter(onLine: (line: string) => void): (chunk: string) => void {
  let buffer = '';
  return (chunk: string) => {
    buffer += chunk;
    let index = buffer.indexOf('\n');
    while (index >= 0) {
      onLine(buffer.slice(0, index));
      buffer = buffer.slice(index + 1);
      index = buffer.indexOf('\n');
    }
  };
}
