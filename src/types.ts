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

export interface ClusterConfig {
  id: string;
  name: string;
  /** API server URL, e.g. https://1.2.3.4:6443 */
  server: string;
  /** base64-encoded PEM CA bundle (kubeconfig certificate-authority-data format). */
  caData?: string;
  insecureSkipTlsVerify?: boolean;
  /** base64-encoded PKCS#12 bundle for client certificate auth. */
  clientP12?: string;
  clientP12Password?: string;
  auth: AuthConfig;
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
