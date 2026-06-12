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

interface KubeHttpNativeModule {
  request(options: NativeRequestOptions): Promise<NativeResponse>;
  exec(options: NativeExecOptions): Promise<NativeExecResult>;
  portForwardStart(options: NativePortForwardOptions): Promise<NativePortForwardHandle>;
  portForwardStop(id: string): void;
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

export async function nativePortForwardStart(
  options: NativePortForwardOptions
): Promise<NativePortForwardHandle> {
  return requireNative().portForwardStart(options);
}

export function nativePortForwardStop(id: string): void {
  requireNative().portForwardStop(id);
}
