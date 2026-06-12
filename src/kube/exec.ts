import {
  isNativeTransportAvailable,
  nativeExec,
  NativeExecSessionHandle,
  nativeExecSessionStart,
} from '../../modules/kube-http';
import { getBearerToken } from '../auth/tokens';
import { ClusterConfig } from '../types';
import { tlsOptionsOf } from './transport';

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
    ...tlsOptionsOf(cluster),
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

export interface ShellSession {
  /** Writes a line (plus newline) to the shell's stdin. */
  sendLine(line: string): void;
  stop(): void;
}

export interface ShellHandlers {
  onOutput: (text: string) => void;
  /** Called once when the session ends; `failure` is undefined on a clean exit. */
  onClosed: (failure?: string) => void;
}

/**
 * Opens an interactive shell in the container (`kubectl exec -it`): the
 * WebSocket stays open with tty=true, so the PTY echoes input and merges
 * stderr into stdout. One session per screen; stop() on unmount.
 */
export async function startShellSession(
  cluster: ClusterConfig,
  namespace: string,
  pod: string,
  container: string | undefined,
  handlers: ShellHandlers
): Promise<ShellSession> {
  if (!isNativeTransportAvailable()) {
    throw new Error('Exec requires the development build (native KubeHttp module).');
  }
  const params = new URLSearchParams();
  params.append('command', '/bin/sh');
  if (container) params.set('container', container);
  params.set('stdin', 'true');
  params.set('stdout', 'true');
  params.set('stderr', 'false');
  params.set('tty', 'true');

  const headers: Record<string, string> = {};
  const token = await getBearerToken(cluster);
  if (token) headers.Authorization = `Bearer ${token}`;

  const session: NativeExecSessionHandle = await nativeExecSessionStart(
    {
      url: wsUrl(
        cluster,
        `/api/v1/namespaces/${encodeURIComponent(namespace)}/pods/${encodeURIComponent(pod)}/exec?${params.toString()}`
      ),
      headers,
      ...tlsOptionsOf(cluster),
    },
    {
      onOutput: (data) => handlers.onOutput(data),
      onClosed: handlers.onClosed,
    }
  );
  return {
    sendLine(line: string) {
      session.send(`${line}\n`);
    },
    stop() {
      session.stop();
    },
  };
}
