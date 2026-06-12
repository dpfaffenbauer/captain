import { requireOptionalNativeModule } from 'expo-modules-core';

export interface NativeRequestOptions {
  url: string;
  method: string;
  headers: Record<string, string>;
  body?: string;
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
  timeoutMs?: number;
}

export interface NativeResponse {
  status: number;
  headers: Record<string, string>;
  body: string;
}

interface KubeHttpNativeModule {
  request(options: NativeRequestOptions): Promise<NativeResponse>;
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

export async function nativeRequest(options: NativeRequestOptions): Promise<NativeResponse> {
  if (!native) {
    throw new Error('KubeHttp native module is not available in this build');
  }
  return native.request(options);
}
