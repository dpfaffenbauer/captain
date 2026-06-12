import { AuthConfig, ClusterConfig } from '../types';
import { generateEksToken } from './eks';
import { azureRefresh, googleRefresh } from './oauth';

interface CachedToken {
  token: string;
  /** Unix epoch milliseconds after which the token must not be reused. */
  validUntil: number;
}

const cache = new Map<string, CachedToken>();

/** Called when a refresh produced new OAuth tokens that should be persisted. */
export type AuthUpdateListener = (clusterId: string, auth: AuthConfig) => void;

let authUpdateListener: AuthUpdateListener | undefined;

export function setAuthUpdateListener(listener: AuthUpdateListener | undefined): void {
  authUpdateListener = listener;
}

export function invalidateToken(clusterId: string): void {
  cache.delete(clusterId);
}

/**
 * Resolves the bearer token for a cluster, refreshing or regenerating it as
 * needed. Returns undefined for pure client-certificate auth.
 */
export async function getBearerToken(cluster: ClusterConfig): Promise<string | undefined> {
  const auth = cluster.auth;
  if (auth.type === 'clientCert') return undefined;
  if (auth.type === 'token') return auth.token;

  const cached = cache.get(cluster.id);
  if (cached && cached.validUntil > Date.now()) {
    return cached.token;
  }

  if (auth.type === 'eks') {
    const token = generateEksToken(auth);
    // Presigned URL expires after 60s of first use but is accepted for 14
    // minutes by EKS; regenerate well before that.
    cache.set(cluster.id, { token, validUntil: Date.now() + 10 * 60 * 1000 });
    return token;
  }

  // gke / aks: use the stored access token while valid, otherwise refresh.
  if (auth.accessToken && (auth.expiresAt ?? 0) > Date.now() + 60 * 1000) {
    return auth.accessToken;
  }
  if (!auth.refreshToken) {
    throw new Error(
      'Kein gültiges Zugriffstoken und kein Refresh-Token vorhanden. Bitte erneut anmelden.'
    );
  }

  const refreshed =
    auth.type === 'gke'
      ? await googleRefresh(auth.clientId, auth.refreshToken)
      : await azureRefresh(auth.tenantId, auth.clientId, auth.refreshToken);

  const updated: AuthConfig = {
    ...auth,
    accessToken: refreshed.accessToken,
    refreshToken: refreshed.refreshToken ?? auth.refreshToken,
    expiresAt: refreshed.expiresAt,
  };
  authUpdateListener?.(cluster.id, updated);
  cache.set(cluster.id, {
    token: refreshed.accessToken,
    validUntil: refreshed.expiresAt - 60 * 1000,
  });
  return refreshed.accessToken;
}
