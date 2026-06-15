import { ApiResourceType } from '../types';
import { ageOf } from '../util/format';

export type RowStatus = 'ok' | 'warn' | 'bad';

export interface SummaryRow {
  label: string;
  value: string;
  mono?: boolean;
  status?: RowStatus;
}

export interface SummarySection {
  title: string;
  rows: SummaryRow[];
}

type Manifest = Record<string, any>;

function row(label: string, value: unknown, extra?: Partial<SummaryRow>): SummaryRow | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  return { label, value: String(value), ...extra };
}

function section(title: string, rows: Array<SummaryRow | undefined>): SummarySection | undefined {
  const present = rows.filter((entry): entry is SummaryRow => entry !== undefined);
  return present.length > 0 ? { title, rows: present } : undefined;
}

function joinMap(map?: Record<string, string>, max = 8): string | undefined {
  if (!map) return undefined;
  const entries = Object.entries(map);
  if (entries.length === 0) return undefined;
  const shown = entries.slice(0, max).map(([key, value]) => `${key}=${value}`);
  if (entries.length > max) shown.push(`… +${entries.length - max}`);
  return shown.join('\n');
}

function metadataSection(manifest: Manifest): SummarySection | undefined {
  const metadata = manifest.metadata ?? {};
  return section('Metadata', [
    row('Namespace', metadata.namespace),
    row('Age', ageOf(metadata.creationTimestamp)),
    row('Created', metadata.creationTimestamp),
    row('Labels', joinMap(metadata.labels), { mono: true }),
    row('Annotations', metadata.annotations ? `${Object.keys(metadata.annotations).length}` : undefined),
  ]);
}

/** Generic status.conditions table; True is healthy for most condition types. */
function conditionsSection(manifest: Manifest, invertedTypes: string[] = []): SummarySection | undefined {
  const conditions: any[] = manifest.status?.conditions ?? [];
  if (!Array.isArray(conditions) || conditions.length === 0) return undefined;
  return section(
    'Conditions',
    conditions.map((condition) => {
      const isTrue = condition.status === 'True';
      const healthyWhenTrue = !invertedTypes.some((type) => String(condition.type).includes(type));
      const healthy = healthyWhenTrue ? isTrue : !isTrue;
      const detail = condition.reason ? ` (${condition.reason})` : '';
      return row(String(condition.type), `${condition.status}${detail}`, {
        status: healthy ? 'ok' : 'bad',
      });
    })
  );
}

function containerRows(containers: any[] = [], statuses: any[] = []): Array<SummaryRow | undefined> {
  return containers.map((container) => {
    const status = statuses.find((entry) => entry.name === container.name);
    let value = container.image ?? '';
    let state: RowStatus | undefined;
    if (status) {
      const ready = status.ready === true;
      const restarts = status.restartCount ?? 0;
      const stateName = status.state ? Object.keys(status.state)[0] : '';
      value = `${container.image}\n${stateName}${ready ? ' · ready' : ''}${restarts ? ` · ${restarts} restarts` : ''}`;
      state = ready ? 'ok' : stateName === 'waiting' ? 'warn' : 'bad';
    }
    return row(container.name, value, { mono: true, status: state });
  });
}

function replicaStatus(actual: number, desired: number): RowStatus {
  if (desired === 0) return 'warn';
  return actual >= desired ? 'ok' : 'warn';
}

function podSummary(manifest: Manifest): Array<SummarySection | undefined> {
  const spec = manifest.spec ?? {};
  const status = manifest.status ?? {};
  const phase = status.phase ?? 'Unknown';
  const phaseStatus: RowStatus =
    phase === 'Running' || phase === 'Succeeded' ? 'ok' : phase === 'Pending' ? 'warn' : 'bad';
  return [
    section('Status', [
      row('Phase', phase, { status: phaseStatus }),
      row('Node', spec.nodeName, { mono: true }),
      row('Pod IP', status.podIP, { mono: true }),
      row('Host IP', status.hostIP, { mono: true }),
      row('QoS class', status.qosClass),
      row('ServiceAccount', spec.serviceAccountName),
      row('Started', status.startTime ? ageOf(status.startTime) : undefined),
    ]),
    section('Container', containerRows(spec.containers, status.containerStatuses)),
    section('Init containers', containerRows(spec.initContainers, status.initContainerStatuses)),
    conditionsSection(manifest),
  ];
}

function deploymentSummary(manifest: Manifest): Array<SummarySection | undefined> {
  const spec = manifest.spec ?? {};
  const status = manifest.status ?? {};
  const desired = spec.replicas ?? 0;
  return [
    section('Replicas', [
      row('Paused', spec.paused === true ? 'yes' : undefined, { status: 'warn' }),
      row('Revision', manifest.metadata?.annotations?.['deployment.kubernetes.io/revision']),
      row('Desired', desired),
      row('Ready', `${status.readyReplicas ?? 0} / ${desired}`, {
        status: replicaStatus(status.readyReplicas ?? 0, desired),
      }),
      row('Current', status.replicas),
      row('Updated', status.updatedReplicas),
      row('Available', status.availableReplicas),
      row('Unavailable', status.unavailableReplicas, { status: 'warn' }),
    ]),
    section('Strategy', [
      row('Type', spec.strategy?.type),
      row('maxSurge', spec.strategy?.rollingUpdate?.maxSurge),
      row('maxUnavailable', spec.strategy?.rollingUpdate?.maxUnavailable),
      row('Selector', joinMap(spec.selector?.matchLabels), { mono: true }),
    ]),
    section('Container', containerRows(spec.template?.spec?.containers)),
    conditionsSection(manifest),
  ];
}

function workloadSetSummary(manifest: Manifest, kind: string): Array<SummarySection | undefined> {
  const spec = manifest.spec ?? {};
  const status = manifest.status ?? {};
  const desired =
    kind === 'DaemonSet' ? status.desiredNumberScheduled ?? 0 : spec.replicas ?? 0;
  const ready = kind === 'DaemonSet' ? status.numberReady ?? 0 : status.readyReplicas ?? 0;
  return [
    section('Replicas', [
      row('Desired', desired),
      row('Ready', `${ready} / ${desired}`, { status: replicaStatus(ready, desired) }),
      kind === 'StatefulSet' ? row('Updated', status.updatedReplicas) : undefined,
      kind === 'DaemonSet' ? row('Available', status.numberAvailable) : undefined,
      row('Selector', joinMap(spec.selector?.matchLabels), { mono: true }),
      kind === 'StatefulSet' ? row('Service', spec.serviceName, { mono: true }) : undefined,
    ]),
    section('Container', containerRows(spec.template?.spec?.containers)),
    conditionsSection(manifest),
  ];
}

function jobSummary(manifest: Manifest): Array<SummarySection | undefined> {
  const spec = manifest.spec ?? {};
  const status = manifest.status ?? {};
  const succeeded = status.succeeded ?? 0;
  const completions = spec.completions ?? 1;
  return [
    section('Status', [
      row('Completed', `${succeeded} / ${completions}`, {
        status: succeeded >= completions ? 'ok' : 'warn',
      }),
      row('Active', status.active, { status: 'warn' }),
      row('Failed', status.failed, { status: 'bad' }),
      row('Parallelism', spec.parallelism),
      row('Started', status.startTime ? ageOf(status.startTime) : undefined),
      row('Finished', status.completionTime ? ageOf(status.completionTime) : undefined),
    ]),
    section('Container', containerRows(spec.template?.spec?.containers)),
    conditionsSection(manifest),
  ];
}

function cronJobSummary(manifest: Manifest): Array<SummarySection | undefined> {
  const spec = manifest.spec ?? {};
  const status = manifest.status ?? {};
  return [
    section('Schedule', [
      row('Schedule', spec.schedule, { mono: true }),
      row('Suspended', spec.suspend === true ? 'yes' : undefined, { status: 'warn' }),
      row('Concurrency', spec.concurrencyPolicy),
      row('Last run', status.lastScheduleTime ? ageOf(status.lastScheduleTime) : undefined),
      row('Last success', status.lastSuccessfulTime ? ageOf(status.lastSuccessfulTime) : undefined),
      row('Active jobs', Array.isArray(status.active) ? status.active.length : undefined),
    ]),
    section('Container', containerRows(spec.jobTemplate?.spec?.template?.spec?.containers)),
  ];
}

function serviceSummary(manifest: Manifest): Array<SummarySection | undefined> {
  const spec = manifest.spec ?? {};
  const ports: any[] = spec.ports ?? [];
  const ingress: any[] = manifest.status?.loadBalancer?.ingress ?? [];
  return [
    section('Service', [
      row('Type', spec.type),
      row('Cluster IP', spec.clusterIP, { mono: true }),
      row(
        'External',
        ingress.map((entry) => entry.ip ?? entry.hostname).join(', ') || spec.externalName,
        { mono: true }
      ),
      row('Selector', joinMap(spec.selector), { mono: true }),
    ]),
    section(
      'Ports',
      ports.map((port) =>
        row(
          port.name ?? String(port.port),
          `${port.port} → ${port.targetPort ?? port.port}/${port.protocol ?? 'TCP'}${
            port.nodePort ? ` · NodePort ${port.nodePort}` : ''
          }`,
          { mono: true }
        )
      )
    ),
  ];
}

function ingressSummary(manifest: Manifest): Array<SummarySection | undefined> {
  const spec = manifest.spec ?? {};
  const rules: any[] = spec.rules ?? [];
  const rows: Array<SummaryRow | undefined> = [];
  for (const rule of rules) {
    for (const path of rule.http?.paths ?? []) {
      const backend = path.backend?.service
        ? `${path.backend.service.name}:${path.backend.service.port?.number ?? path.backend.service.port?.name ?? ''}`
        : '—';
      rows.push(row(`${rule.host ?? '*'}${path.path ?? '/'}`, backend, { mono: true }));
    }
  }
  const lbIngress: any[] = manifest.status?.loadBalancer?.ingress ?? [];
  return [
    section('Ingress', [
      row('Class', spec.ingressClassName),
      row('Address', lbIngress.map((entry) => entry.ip ?? entry.hostname).join(', '), { mono: true }),
      row('TLS', Array.isArray(spec.tls) ? spec.tls.map((tls: any) => tls.secretName).join(', ') : undefined),
    ]),
    section('Routes', rows),
  ];
}

function dataKeysSummary(manifest: Manifest, kind: string): Array<SummarySection | undefined> {
  const data = { ...(manifest.data ?? {}), ...(manifest.binaryData ?? {}), ...(manifest.stringData ?? {}) };
  const keys = Object.keys(data);
  return [
    section(kind === 'Secret' ? 'Secret' : 'Data', [
      kind === 'Secret' ? row('Type', manifest.type, { mono: true }) : undefined,
      row('Entries', keys.length),
    ]),
    section(
      'Keys',
      keys.map((key) =>
        row(
          key,
          kind === 'Secret' ? '••••••' : `${String(data[key]).length} characters`,
          { mono: true }
        )
      )
    ),
  ];
}

function nodeSummary(manifest: Manifest): Array<SummarySection | undefined> {
  const status = manifest.status ?? {};
  const addresses: any[] = status.addresses ?? [];
  const info = status.nodeInfo ?? {};
  return [
    section('Node', [
      row('Schedulable', manifest.spec?.unschedulable ? 'no (cordoned)' : 'yes', {
        status: manifest.spec?.unschedulable ? 'warn' : 'ok',
      }),
      ...addresses.map((address) => row(address.type, address.address, { mono: true })),
      row('Kubelet', info.kubeletVersion),
      row('OS', `${info.osImage ?? ''} (${info.architecture ?? ''})`),
      row('Runtime', info.containerRuntimeVersion, { mono: true }),
    ]),
    section('Capacity', [
      row('CPU', `${status.allocatable?.cpu ?? '?'} / ${status.capacity?.cpu ?? '?'}`),
      row('Memory', `${status.allocatable?.memory ?? '?'} / ${status.capacity?.memory ?? '?'}`),
      row('Pods', `${status.allocatable?.pods ?? '?'} / ${status.capacity?.pods ?? '?'}`),
    ]),
    conditionsSection(manifest, ['Pressure', 'Unavailable']),
  ];
}

function pvcSummary(manifest: Manifest): Array<SummarySection | undefined> {
  const spec = manifest.spec ?? {};
  const status = manifest.status ?? {};
  return [
    section('Volume Claim', [
      row('Status', status.phase, { status: status.phase === 'Bound' ? 'ok' : 'warn' }),
      row('Volume', spec.volumeName, { mono: true }),
      row('Capacity', status.capacity?.storage ?? spec.resources?.requests?.storage),
      row('StorageClass', spec.storageClassName),
      row('Access Modes', (spec.accessModes ?? []).join(', ')),
    ]),
  ];
}

function pvSummary(manifest: Manifest): Array<SummarySection | undefined> {
  const spec = manifest.spec ?? {};
  const status = manifest.status ?? {};
  const claim = spec.claimRef ? `${spec.claimRef.namespace}/${spec.claimRef.name}` : undefined;
  return [
    section('Volume', [
      row('Status', status.phase, { status: status.phase === 'Bound' ? 'ok' : 'warn' }),
      row('Claim', claim, { mono: true }),
      row('Capacity', spec.capacity?.storage),
      row('StorageClass', spec.storageClassName),
      row('Reclaim Policy', spec.persistentVolumeReclaimPolicy),
      row('Access Modes', (spec.accessModes ?? []).join(', ')),
    ]),
  ];
}

function eventSummary(manifest: Manifest): Array<SummarySection | undefined> {
  const involved = manifest.involvedObject ?? manifest.regarding ?? {};
  return [
    section('Event', [
      row('Type', manifest.type, { status: manifest.type === 'Normal' ? 'ok' : 'warn' }),
      row('Reason', manifest.reason),
      row('Message', manifest.message ?? manifest.note),
      row('Object', involved.kind ? `${involved.kind}/${involved.name}` : undefined, { mono: true }),
      row('Count', manifest.count ?? manifest.deprecatedCount),
      row('Last seen', ageOf(manifest.lastTimestamp ?? manifest.deprecatedLastTimestamp ?? manifest.eventTime)),
    ]),
  ];
}

function hpaSummary(manifest: Manifest): Array<SummarySection | undefined> {
  const spec = manifest.spec ?? {};
  const status = manifest.status ?? {};
  const target = spec.scaleTargetRef ? `${spec.scaleTargetRef.kind}/${spec.scaleTargetRef.name}` : undefined;
  return [
    section('Autoscaler', [
      row('Target', target, { mono: true }),
      row('Min / Max', `${spec.minReplicas ?? 1} / ${spec.maxReplicas ?? '?'}`),
      row('Current', status.currentReplicas),
      row('Desired', status.desiredReplicas),
    ]),
    conditionsSection(manifest),
  ];
}

function genericSummary(manifest: Manifest): Array<SummarySection | undefined> {
  const spec = manifest.spec ?? {};
  const status = manifest.status ?? {};
  const specRows = Object.entries(spec)
    .filter(([, value]) => typeof value !== 'object' || value === null)
    .slice(0, 10)
    .map(([key, value]) => row(key, value, { mono: true }));
  const statusRows = Object.entries(status)
    .filter(([key, value]) => key !== 'conditions' && (typeof value !== 'object' || value === null))
    .slice(0, 10)
    .map(([key, value]) => row(key, value, { mono: true }));
  return [
    section('Spec', specRows),
    section('Status', statusRows),
    conditionsSection(manifest),
  ];
}

/** Builds the kind-specific structured overview shown in the detail screen. */
export function summarizeResource(type: ApiResourceType, manifest: Manifest): SummarySection[] {
  let sections: Array<SummarySection | undefined>;
  switch (`${type.group}/${type.kind}`) {
    case '/Pod':
      sections = podSummary(manifest);
      break;
    case 'apps/Deployment':
      sections = deploymentSummary(manifest);
      break;
    case 'apps/StatefulSet':
    case 'apps/DaemonSet':
    case 'apps/ReplicaSet':
    case '/ReplicationController':
      sections = workloadSetSummary(manifest, type.kind);
      break;
    case 'batch/Job':
      sections = jobSummary(manifest);
      break;
    case 'batch/CronJob':
      sections = cronJobSummary(manifest);
      break;
    case '/Service':
      sections = serviceSummary(manifest);
      break;
    case 'networking.k8s.io/Ingress':
      sections = ingressSummary(manifest);
      break;
    case '/ConfigMap':
    case '/Secret':
      sections = dataKeysSummary(manifest, type.kind);
      break;
    case '/Node':
      sections = nodeSummary(manifest);
      break;
    case '/PersistentVolumeClaim':
      sections = pvcSummary(manifest);
      break;
    case '/PersistentVolume':
      sections = pvSummary(manifest);
      break;
    case '/Event':
    case 'events.k8s.io/Event':
      sections = eventSummary(manifest);
      break;
    case 'autoscaling/HorizontalPodAutoscaler':
      sections = hpaSummary(manifest);
      break;
    case '/Namespace':
      sections = [
        section('Namespace', [
          row('Status', manifest.status?.phase, {
            status: manifest.status?.phase === 'Active' ? 'ok' : 'warn',
          }),
        ]),
        conditionsSection(manifest),
      ];
      break;
    default:
      sections = genericSummary(manifest);
  }
  return [...sections, metadataSection(manifest)].filter(
    (entry): entry is SummarySection => entry !== undefined
  );
}
