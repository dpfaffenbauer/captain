import { isNativeTransportAvailable, nativeRequest } from '../../modules/kube-http';
import { getBearerToken, invalidateToken } from '../auth/tokens';
import { ClusterConfig } from '../types';
import { base64Decode, looksLikeBase64 } from '../util/base64';

export interface KubeResponse {
  status: number;
  body: string;
}

export class KubeApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly rawBody: string
  ) {
    super(message);
    this.name = 'KubeApiError';
  }
}

function pemOf(data: string | undefined): string | undefined {
  if (!data) return undefined;
  const trimmed = data.trim();
  // kubeconfig stores the PEM base64-encoded; accept raw PEM pastes too.
  if (trimmed.includes('-----BEGIN')) return trimmed;
  if (looksLikeBase64(trimmed)) return base64Decode(trimmed);
  return trimmed;
}

async function rawRequest(
  cluster: ClusterConfig,
  url: string,
  method: string,
  headers: Record<string, string>,
  body?: string
): Promise<KubeResponse> {
  if (isNativeTransportAvailable()) {
    const response = await nativeRequest({
      url,
      method,
      headers,
      body,
      caPem: pemOf(cluster.caData),
      insecure: cluster.insecureSkipTlsVerify === true,
      clientCertPem: pemOf(cluster.clientCertData),
      clientKeyPem: pemOf(cluster.clientKeyData),
      pkcs12: cluster.clientP12,
      pkcs12Password: cluster.clientP12Password,
      timeoutMs: 30000,
    });
    return { status: response.status, body: response.body };
  }

  // Fallback for Expo Go: plain fetch. Works only against API servers with a
  // publicly trusted certificate; custom CAs and client certs need the
  // development build with the KubeHttp native module.
  const response = await fetch(url, { method, headers, body });
  return { status: response.status, body: await response.text() };
}

function describeStatus(status: number, body: string): string {
  try {
    const parsed = JSON.parse(body);
    if (parsed && typeof parsed.message === 'string') return parsed.message;
  } catch {
    // not a Status object
  }
  return `HTTP ${status}`;
}

/**
 * Performs an authenticated request against the cluster's API server.
 * `path` must start with '/' (e.g. /api/v1/pods).
 */
export async function kubeRequest(
  cluster: ClusterConfig,
  path: string,
  options: { method?: string; body?: string } = {}
): Promise<string> {
  const method = options.method ?? 'GET';
  const server = cluster.server.replace(/\/+$/, '');
  const url = `${server}${path}`;

  const headers: Record<string, string> = { Accept: 'application/json' };
  if (options.body) headers['Content-Type'] = 'application/json';
  const token = await getBearerToken(cluster);
  if (token) headers.Authorization = `Bearer ${token}`;

  let response = await rawRequest(cluster, url, method, headers, options.body);

  // On 401 the cached token may have been revoked early; retry once fresh.
  if (response.status === 401) {
    invalidateToken(cluster.id);
    const freshToken = await getBearerToken(cluster);
    if (freshToken && freshToken !== token) {
      headers.Authorization = `Bearer ${freshToken}`;
      response = await rawRequest(cluster, url, method, headers, options.body);
    }
  }

  if (response.status >= 400) {
    throw new KubeApiError(describeStatus(response.status, response.body), response.status, response.body);
  }
  return response.body;
}

export async function kubeRequestJson<T = unknown>(
  cluster: ClusterConfig,
  path: string,
  options: { method?: string; body?: string } = {}
): Promise<T> {
  const body = await kubeRequest(cluster, path, options);
  return JSON.parse(body) as T;
}
