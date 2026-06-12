export type AuthConfig =
  | { type: 'token'; token: string }
  | { type: 'clientCert' }
  | {
      type: 'eks';
      region: string;
      clusterName: string;
      accessKeyId: string;
      secretAccessKey: string;
      sessionToken?: string;
    }
  | {
      type: 'gke';
      clientId: string;
      accessToken?: string;
      refreshToken?: string;
      /** Unix epoch milliseconds at which accessToken expires. */
      expiresAt?: number;
    }
  | {
      type: 'aks';
      tenantId: string;
      clientId: string;
      accessToken?: string;
      refreshToken?: string;
      expiresAt?: number;
    };

export type AuthType = AuthConfig['type'];

/**
 * Where to reach a Prometheus instance inside the cluster. Captain queries it
 * through the API-server service proxy, so no extra network exposure or auth
 * is required beyond what the cluster connection already provides.
 */
export interface PrometheusConfig {
  namespace: string;
  /** Service name, e.g. "prometheus-k8s" or "prometheus-server". */
  service: string;
  port: number;
  /** Set to 'https' when the service itself speaks TLS; defaults to http. */
  scheme?: 'http' | 'https';
  /** When true, Captain neither auto-discovers nor queries Prometheus. */
  disabled?: boolean;
}

export interface ClusterConfig {
  id: string;
  name: string;
  /** API server URL, e.g. https://1.2.3.4:6443 */
  server: string;
  /** base64-encoded PEM CA bundle (kubeconfig certificate-authority-data format). */
  caData?: string;
  insecureSkipTlsVerify?: boolean;
  /** Client certificate, PEM or base64 (kubeconfig client-certificate-data format). */
  clientCertData?: string;
  /** Private key for the client certificate, PEM or base64 (kubeconfig client-key-data format). */
  clientKeyData?: string;
  /** base64-encoded PKCS#12 bundle for client certificate auth (alternative to PEM cert/key). */
  clientP12?: string;
  clientP12Password?: string;
  auth: AuthConfig;
  /** Resolved/auto-discovered Prometheus location for metrics and alerts. */
  prometheus?: PrometheusConfig;
}

/** A resource type discovered from the API server. */
export interface ApiResourceType {
  /** API group; empty string for the core group. */
  group: string;
  version: string;
  /** Plural resource name used in URLs, e.g. "deployments". */
  plural: string;
  kind: string;
  namespaced: boolean;
  verbs: string[];
}

export interface KubeListItem {
  name: string;
  namespace?: string;
  creationTimestamp?: string;
  raw: Record<string, unknown>;
}

export interface KubeList {
  items: KubeListItem[];
  continueToken?: string;
}
