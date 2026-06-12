import { categoryColors } from '../ui/theme';
import { ApiResourceType } from '../types';

export interface ResourceCategory {
  key: string;
  title: string;
  color: string;
  /** Resource types in curated order. */
  types: ApiResourceType[];
  /** Collapsed by default in the UI. */
  collapsedByDefault?: boolean;
}

/** kubectl-style two/three-letter abbreviations from the design. */
const ABBREVIATIONS: Record<string, string> = {
  '/Pod': 'Po',
  'apps/Deployment': 'De',
  'apps/StatefulSet': 'St',
  'apps/DaemonSet': 'Ds',
  'apps/ReplicaSet': 'Rs',
  '/ReplicationController': 'Rc',
  'batch/Job': 'Jo',
  'batch/CronJob': 'Cj',
  '/ConfigMap': 'Cm',
  '/Secret': 'Se',
  '/ResourceQuota': 'Rq',
  '/LimitRange': 'Lr',
  'autoscaling/HorizontalPodAutoscaler': 'Ha',
  'policy/PodDisruptionBudget': 'Pb',
  'scheduling.k8s.io/PriorityClass': 'Pc',
  'node.k8s.io/RuntimeClass': 'Rt',
  'coordination.k8s.io/Lease': 'Le',
  'admissionregistration.k8s.io/MutatingWebhookConfiguration': 'Mw',
  'admissionregistration.k8s.io/ValidatingWebhookConfiguration': 'Vw',
  '/Service': 'Sv',
  'discovery.k8s.io/EndpointSlice': 'Es',
  '/Endpoints': 'Ep',
  'networking.k8s.io/Ingress': 'In',
  'networking.k8s.io/IngressClass': 'Ic',
  'networking.k8s.io/NetworkPolicy': 'Np',
  '/PersistentVolumeClaim': 'Pvc',
  '/PersistentVolume': 'Pv',
  'storage.k8s.io/StorageClass': 'Sc',
  '/Node': 'No',
  '/Namespace': 'Ns',
  '/Event': 'Ev',
  '/ServiceAccount': 'Sa',
  'rbac.authorization.k8s.io/Role': 'Ro',
  'rbac.authorization.k8s.io/RoleBinding': 'Rb',
  'rbac.authorization.k8s.io/ClusterRole': 'Cr',
  'rbac.authorization.k8s.io/ClusterRoleBinding': 'Cb',
  'apiextensions.k8s.io/CustomResourceDefinition': 'Crd',
};

export function abbreviationFor(type: ApiResourceType): string {
  const exact = ABBREVIATIONS[`${type.group}/${type.kind}`];
  if (exact) return exact;
  const upper = type.kind.replace(/[^A-Z]/g, '');
  if (upper.length >= 2) return upper.slice(0, 2)[0] + upper.slice(1, 2).toLowerCase();
  return type.kind.slice(0, 2).replace(/^./, (c) => c.toUpperCase());
}

/** Curated category definitions, matched by "group/Kind". Order matters. */
const CATEGORY_DEFS: Array<{
  key: string;
  title: string;
  members: string[];
  collapsedByDefault?: boolean;
}> = [
  {
    key: 'workloads',
    title: 'Workloads',
    members: [
      '/Pod',
      'apps/Deployment',
      'apps/StatefulSet',
      'apps/DaemonSet',
      'apps/ReplicaSet',
      '/ReplicationController',
      'batch/Job',
      'batch/CronJob',
    ],
  },
  {
    key: 'config',
    title: 'Config',
    members: [
      '/ConfigMap',
      '/Secret',
      '/ResourceQuota',
      '/LimitRange',
      'autoscaling/HorizontalPodAutoscaler',
      'policy/PodDisruptionBudget',
      'scheduling.k8s.io/PriorityClass',
      'node.k8s.io/RuntimeClass',
      'coordination.k8s.io/Lease',
      'admissionregistration.k8s.io/MutatingWebhookConfiguration',
      'admissionregistration.k8s.io/ValidatingWebhookConfiguration',
    ],
  },
  {
    key: 'network',
    title: 'Network',
    members: [
      '/Service',
      'discovery.k8s.io/EndpointSlice',
      '/Endpoints',
      'networking.k8s.io/Ingress',
      'networking.k8s.io/IngressClass',
      'networking.k8s.io/NetworkPolicy',
    ],
  },
  {
    key: 'storage',
    title: 'Storage',
    members: [
      '/PersistentVolumeClaim',
      '/PersistentVolume',
      'storage.k8s.io/StorageClass',
    ],
  },
  {
    key: 'cluster',
    title: 'Cluster',
    members: ['/Node', '/Namespace', '/Event'],
  },
  {
    key: 'access',
    title: 'Access Control',
    members: [
      '/ServiceAccount',
      'rbac.authorization.k8s.io/Role',
      'rbac.authorization.k8s.io/RoleBinding',
      'rbac.authorization.k8s.io/ClusterRole',
      'rbac.authorization.k8s.io/ClusterRoleBinding',
    ],
  },
];

/** API groups that ship with Kubernetes itself (everything else is a CRD). */
function isBuiltinGroup(group: string): boolean {
  return (
    group === '' ||
    group === 'apps' ||
    group === 'batch' ||
    group === 'autoscaling' ||
    group === 'policy' ||
    group === 'extensions' ||
    group.endsWith('.k8s.io')
  );
}

function keyOf(type: ApiResourceType): string {
  return `${type.group}/${type.kind}`;
}

/**
 * Sorts discovered resource types into the curated categories. Anything from
 * a non-builtin API group becomes a custom resource (grouped by API group);
 * remaining builtin types land in "Other".
 */
export function categorizeResourceTypes(types: ApiResourceType[]): ResourceCategory[] {
  const byKey = new Map<string, ApiResourceType>();
  for (const type of types) {
    // Keep the first occurrence (preferred version from discovery).
    if (!byKey.has(keyOf(type))) byKey.set(keyOf(type), type);
  }

  const used = new Set<string>();
  const categories: ResourceCategory[] = [];

  for (const def of CATEGORY_DEFS) {
    const members: ApiResourceType[] = [];
    for (const member of def.members) {
      const type = byKey.get(member);
      if (type) {
        members.push(type);
        used.add(member);
      }
    }
    if (members.length > 0) {
      categories.push({
        key: def.key,
        title: def.title,
        color: categoryColors[def.key],
        types: members,
        collapsedByDefault: def.collapsedByDefault,
      });
    }
  }

  const custom: ApiResourceType[] = [];
  const other: ApiResourceType[] = [];
  for (const type of types) {
    const key = keyOf(type);
    if (used.has(key)) continue;
    if (byKey.get(key) !== type) continue; // duplicate version
    if (key === 'apiextensions.k8s.io/CustomResourceDefinition' || !isBuiltinGroup(type.group)) {
      custom.push(type);
    } else {
      other.push(type);
    }
  }

  custom.sort(
    (a, b) =>
      // CRD definition type first, then grouped by API group.
      Number(b.group === 'apiextensions.k8s.io') - Number(a.group === 'apiextensions.k8s.io') ||
      a.group.localeCompare(b.group) ||
      a.kind.localeCompare(b.kind)
  );
  other.sort((a, b) => a.kind.localeCompare(b.kind) || a.group.localeCompare(b.group));

  if (custom.length > 0) {
    categories.push({
      key: 'custom',
      title: 'Custom Resources',
      color: categoryColors.custom,
      types: custom,
    });
  }
  if (other.length > 0) {
    categories.push({
      key: 'other',
      title: 'Other',
      color: categoryColors.other,
      types: other,
      collapsedByDefault: true,
    });
  }
  return categories;
}
