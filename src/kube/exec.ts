import { isNativeTransportAvailable, nativeExec } from '../../modules/kube-http';
import { getBearerToken } from '../auth/tokens';
import { ClusterConfig } from '../types';
import { caPemOf } from './transport';

export interface ExecResult {
  output: string;
  /** Human-readable failure description, if the command failed. */
  failure?: string;
}

function wsUrl(cluster: ClusterConfig, path: string): string {
  const server = cluster.server.replace(/\/+$/, '').replace(/^http/, 'ws');
  return `${server}${path}`;
}

/**
 * Runs a one-shot command in a container via the Kubernetes exec endpoint
 * (WebSocket, v4.channel.k8s.io). Each call opens a fresh connection —
 * equivalent to `kubectl exec -- /bin/sh -c <command>`.
 */
export async function execCommand(
  cluster: ClusterConfig,
  namespace: string,
  pod: string,
  container: string | undefined,
  command: string
): Promise<ExecResult> {
  if (!isNativeTransportAvailable()) {
    throw new Error('Exec requires the development build (native KubeHttp module).');
  }
  const params = new URLSearchParams();
  for (const part of ['/bin/sh', '-c', command]) {
    params.append('command', part);
  }
  if (container) params.set('container', container);
  params.set('stdout', 'true');
  params.set('stderr', 'true');
  params.set('stdin', 'false');
  params.set('tty', 'false');

  const headers: Record<string, string> = {};
  const token = await getBearerToken(cluster);
  if (token) headers.Authorization = `Bearer ${token}`;

  const result = await nativeExec({
    url: wsUrl(
      cluster,
      `/api/v1/namespaces/${encodeURIComponent(namespace)}/pods/${encodeURIComponent(pod)}/exec?${params.toString()}`
    ),
    headers,
    caPem: caPemOf(cluster),
    insecure: cluster.insecureSkipTlsVerify === true,
    pkcs12: cluster.clientP12,
    pkcs12Password: cluster.clientP12Password,
    timeoutMs: 20000,
  });

  let failure: string | undefined;
  if (result.timedOut) {
    failure = 'Command timed out after 20s.';
  } else if (result.error) {
    try {
      const status = JSON.parse(result.error);
      if (status.status === 'Failure') {
        const exitCode = status.details?.causes?.find((c: any) => c.reason === 'ExitCode')?.message;
        failure = exitCode ? `exit code ${exitCode}` : status.message;
      }
    } catch {
      failure = result.error;
    }
  }

  const output = [result.stdout, result.stderr].filter(Boolean).join('').replace(/\n$/, '');
  return { output, failure };
}
