import { requireOptionalNativeModule } from 'expo-modules-core';

export interface TlsOptions {
  /** PEM-encoded CA bundle used to validate the server certificate. */
  caPem?: string;
  insecure?: boolean;
  /** PEM-encoded client certificate (may include intermediates) for client certificate auth. */
  clientCertPem?: string;
  /** PEM-encoded private key (PKCS#1, SEC1, or unencrypted PKCS#8) matching clientCertPem. */
  clientKeyPem?: string;
  /** base64-encoded PKCS#12 bundle for client certificate auth (alternative to PEM cert/key). */
  pkcs12?: string;
  pkcs12Password?: string;
}

export interface NativeRequestOptions extends TlsOptions {
  url: string;
  method: string;
  headers: Record<string, string>;
  body?: string;
  timeoutMs?: number;
}

export interface NativeResponse {
  status: number;
  headers: Record<string, string>;
  body: string;
}

export interface NativeExecOptions extends TlsOptions {
  /** wss:// exec URL including command/container query parameters. */
  url: string;
  headers: Record<string, string>;
  timeoutMs?: number;
}

export interface NativeExecResult {
  stdout: string;
  stderr: string;
  /** v1.Status JSON from the error channel ('' on success). */
  error: string;
  timedOut: boolean;
}

export interface NativePortForwardOptions extends TlsOptions {
  /** wss:// portforward URL including ?ports=<remotePort>. */
  url: string;
  headers: Record<string, string>;
  /** 0 = pick a free local port automatically. */
  localPort?: number;
}

export interface NativePortForwardHandle {
  id: string;
  localPort: number;
}

export interface NativeStreamOptions extends TlsOptions {
  url: string;
  method?: string;
  headers: Record<string, string>;
  body?: string;
  /** Max. idle time between two received chunks; 0 = one hour (log follow / watch). */
  idleTimeoutMs?: number;
}

export interface NativeStreamHandlers {
  onChunk: (data: string) => void;
  /** Called exactly once when the stream ends; `error` is undefined on a clean close. */
  onEnd: (error?: string) => void;
}

interface KubeStreamChunkEvent {
  id: string;
  data: string;
}

interface KubeStreamEndEvent {
  id: string;
  error: string;
  status: number;
}

interface KubeHttpNativeModule {
  request(options: NativeRequestOptions): Promise<NativeResponse>;
  exec(options: NativeExecOptions): Promise<NativeExecResult>;
  streamStart(options: NativeStreamOptions): Promise<string>;
  streamStop(id: string): void;
  portForwardStart(options: NativePortForwardOptions): Promise<NativePortForwardHandle>;
  portForwardStop(id: string): void;
  addListener<T>(eventName: string, listener: (event: T) => void): { remove(): void };
}

const native = requireOptionalNativeModule<KubeHttpNativeModule>('KubeHttp');

/**
 * True when the native TLS-aware transport is available (development build).
 * In Expo Go the module is missing and we fall back to fetch(), which only
 * works for API servers with publicly trusted certificates.
 */
export function isNativeTransportAvailable(): boolean {
  return native != null;
}

function requireNative(): KubeHttpNativeModule {
  if (!native) {
    throw new Error('KubeHttp native module is not available in this build');
  }
  return native;
}

export async function nativeRequest(options: NativeRequestOptions): Promise<NativeResponse> {
  return requireNative().request(options);
}

export async function nativeExec(options: NativeExecOptions): Promise<NativeExecResult> {
  return requireNative().exec(options);
}

export interface NativeStreamHandle {
  id: string;
  stop(): void;
}

const streamHandlers = new Map<string, NativeStreamHandlers>();
/** Events that arrived before streamStart() resolved and the handler was registered. */
const earlyStreamEvents = new Map<string, { chunks: string[]; end?: string | null }>();
let streamListenersAttached = false;

function attachStreamListeners(module: KubeHttpNativeModule) {
  if (streamListenersAttached) return;
  streamListenersAttached = true;
  module.addListener<KubeStreamChunkEvent>('kubeStreamChunk', (event) => {
    const handlers = streamHandlers.get(event.id);
    if (handlers) {
      handlers.onChunk(event.data);
      return;
    }
    const early = earlyStreamEvents.get(event.id) ?? { chunks: [] };
    early.chunks.push(event.data);
    earlyStreamEvents.set(event.id, early);
  });
  module.addListener<KubeStreamEndEvent>('kubeStreamEnd', (event) => {
    const handlers = streamHandlers.get(event.id);
    if (handlers) {
      streamHandlers.delete(event.id);
      handlers.onEnd(event.error || undefined);
      return;
    }
    const early = earlyStreamEvents.get(event.id) ?? { chunks: [] };
    early.end = event.error || null;
    earlyStreamEvents.set(event.id, early);
  });
}

/**
 * Opens a streaming HTTP request (log follow, watch API). Chunks are delivered
 * as they arrive; stopping the handle ends the stream without an error.
 */
export async function nativeStreamStart(
  options: NativeStreamOptions,
  handlers: NativeStreamHandlers
): Promise<NativeStreamHandle> {
  const module = requireNative();
  attachStreamListeners(module);
  const id = await module.streamStart(options);
  streamHandlers.set(id, handlers);
  const early = earlyStreamEvents.get(id);
  if (early) {
    earlyStreamEvents.delete(id);
    for (const chunk of early.chunks) handlers.onChunk(chunk);
    if (early.end !== undefined) {
      streamHandlers.delete(id);
      handlers.onEnd(early.end ?? undefined);
    }
  }
  return {
    id,
    stop() {
      // Detach first: the cancellation still fires kubeStreamEnd natively,
      // but a deliberate stop should not invoke onEnd.
      streamHandlers.delete(id);
      module.streamStop(id);
    },
  };
}

export async function nativePortForwardStart(
  options: NativePortForwardOptions
): Promise<NativePortForwardHandle> {
  return requireNative().portForwardStart(options);
}

export function nativePortForwardStop(id: string): void {
  requireNative().portForwardStop(id);
}
