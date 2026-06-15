import yaml from 'js-yaml';
import { DEFAULT_GKE_CLIENT_ID } from '../auth/oauth';
import { AuthConfig, ClusterConfig } from '../types';
import { newId } from '../util/format';

const GKE_IMPORT_WARNING = DEFAULT_GKE_CLIENT_ID
  ? 'GKE: Please sign in with Google.'
  : 'GKE: Please enter an OAuth client ID and sign in with Google.';

export interface ImportedContext {
  contextName: string;
  cluster: ClusterConfig;
  /** Hints for the user about manual steps (e.g. missing credentials). */
  warnings: string[];
}

interface KubeconfigFile {
  clusters?: Array<{ name: string; cluster: Record<string, unknown> }>;
  users?: Array<{ name: string; user: Record<string, unknown> }>;
  contexts?: Array<{ name: string; context: { cluster: string; user: string } }>;
}

function execArg(args: string[], flag: string): string | undefined {
  const index = args.indexOf(flag);
  if (index >= 0 && index + 1 < args.length) return args[index + 1];
  const prefixed = args.find((arg) => arg.startsWith(`${flag}=`));
  return prefixed?.slice(flag.length + 1);
}

function authFromUser(user: Record<string, unknown>, warnings: string[]): AuthConfig {
  const token = user['token'];
  if (typeof token === 'string' && token.length > 0) {
    return { type: 'token', token };
  }

  const exec = user['exec'] as { command?: string; args?: string[] } | undefined;
  if (exec?.command) {
    const command = exec.command;
    const args = exec.args ?? [];
    if (command.includes('aws') || args.includes('eks')) {
      const region = execArg(args, '--region') ?? '';
      const clusterName = execArg(args, '--cluster-name') ?? execArg(args, '--cluster-id') ?? '';
      warnings.push('EKS: AWS access key and secret key still need to be entered.');
      return {
        type: 'eks',
        region,
        clusterName,
        accessKeyId: '',
        secretAccessKey: '',
      };
    }
    if (command.includes('gke') || command.includes('gcloud')) {
      warnings.push(GKE_IMPORT_WARNING);
      return { type: 'gke', clientId: DEFAULT_GKE_CLIENT_ID };
    }
    // int128/kubelogin (oidc-login) carries the issuer in its args.
    if (args.some((arg) => arg.startsWith('--oidc-issuer-url'))) {
      warnings.push('OIDC: Please sign in with the provider to obtain tokens.');
      return {
        type: 'oidc',
        issuer: execArg(args, '--oidc-issuer-url') ?? '',
        clientId: execArg(args, '--oidc-client-id') ?? '',
        clientSecret: execArg(args, '--oidc-client-secret') || undefined,
      };
    }
    if (command.includes('kubelogin') || args.some((arg) => arg.includes('azure'))) {
      warnings.push('AKS: Please enter the tenant ID and client ID and sign in with Microsoft.');
      return { type: 'aks', tenantId: execArg(args, '--tenant-id') ?? '', clientId: '' };
    }
    warnings.push(`Exec plugin "${command}" is not supported; please configure auth manually.`);
    return { type: 'token', token: '' };
  }

  const authProvider = user['auth-provider'] as { name?: string; config?: Record<string, string> } | undefined;
  if (authProvider?.name === 'gcp') {
    warnings.push(GKE_IMPORT_WARNING);
    return { type: 'gke', clientId: DEFAULT_GKE_CLIENT_ID };
  }
  if (authProvider?.name === 'azure') {
    warnings.push('AKS: Please enter the tenant ID and client ID and sign in with Microsoft.');
    return { type: 'aks', tenantId: authProvider.config?.['tenant-id'] ?? '', clientId: '' };
  }
  if (authProvider?.name === 'oidc') {
    warnings.push('OIDC: Please sign in with the provider to obtain tokens.');
    return {
      type: 'oidc',
      issuer: authProvider.config?.['idp-issuer-url'] ?? '',
      clientId: authProvider.config?.['client-id'] ?? '',
      clientSecret: authProvider.config?.['client-secret'] || undefined,
    };
  }

  if (typeof user['client-certificate-data'] === 'string') {
    if (typeof user['client-key-data'] !== 'string') {
      warnings.push('Client certificate found, but no key (client-key-data); please add it in the form.');
    }
    return { type: 'clientCert' };
  }
  if (typeof user['client-certificate'] === 'string') {
    warnings.push(
      'Client certificate is given as a file path; please paste the certificate and key contents (PEM) into the form.'
    );
    return { type: 'clientCert' };
  }

  warnings.push('No supported authentication found; please configure it manually.');
  return { type: 'token', token: '' };
}

/** Parses a kubeconfig YAML document into importable cluster configurations. */
export function parseKubeconfig(text: string): ImportedContext[] {
  const parsed = yaml.load(text) as KubeconfigFile | undefined;
  if (!parsed || typeof parsed !== 'object') {
    throw new Error('Could not read the kubeconfig');
  }
  const clusters = new Map((parsed.clusters ?? []).map((entry) => [entry.name, entry.cluster]));
  const users = new Map((parsed.users ?? []).map((entry) => [entry.name, entry.user]));

  const results: ImportedContext[] = [];
  for (const entry of parsed.contexts ?? []) {
    const clusterDef = clusters.get(entry.context.cluster);
    if (!clusterDef || typeof clusterDef['server'] !== 'string') continue;
    const userDef = users.get(entry.context.user) ?? {};

    const warnings: string[] = [];
    const auth = authFromUser(userDef, warnings);

    results.push({
      contextName: entry.name,
      warnings,
      cluster: {
        id: newId(),
        name: entry.name,
        server: clusterDef['server'],
        caData:
          typeof clusterDef['certificate-authority-data'] === 'string'
            ? clusterDef['certificate-authority-data']
            : undefined,
        insecureSkipTlsVerify: clusterDef['insecure-skip-tls-verify'] === true,
        clientCertData:
          typeof userDef['client-certificate-data'] === 'string'
            ? userDef['client-certificate-data']
            : undefined,
        clientKeyData:
          typeof userDef['client-key-data'] === 'string' ? userDef['client-key-data'] : undefined,
        auth,
      },
    });
  }
  if (results.length === 0) {
    throw new Error('The kubeconfig contains no usable contexts');
  }
  return results;
}
