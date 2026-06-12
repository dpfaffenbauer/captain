import { ApiResourceType } from '../types';

export interface ResourceCategory {
  key: string;
  title: string;
  icon: string;
  /** Resource types in curated order. */
  types: ApiResourceType[];
  /** Collapsed by default in the UI. */
  collapsedByDefault?: boolean;
}

/** Curated category definitions, matched by "group/Kind". Order matters. */
const CATEGORY_DEFS: Array<{
  key: string;
  title: string;
  icon: string;
  members: string[];
  collapsedByDefault?: boolean;
}> = [
  {
    key: 'cluster',
    title: 'Cluster',
    icon: '🖥',
    members: ['/Node', '/Namespace', '/Event'],
  },
  {
    key: 'workloads',
    title: 'Workloads',
    icon: '⚙️',
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
    icon: '🔧',
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
    title: 'Netzwerk',
    icon: '🌐',
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
    icon: '💾',
    members: [
      '/PersistentVolumeClaim',
      '/PersistentVolume',
      'storage.k8s.io/StorageClass',
    ],
  },
  {
    key: 'access',
    title: 'Zugriffskontrolle',
    icon: '🔐',
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
 * remaining builtin types land in "Sonstiges".
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
        icon: def.icon,
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
    categories.push({ key: 'custom', title: 'Custom Resources', icon: '🧩', types: custom });
  }
  if (other.length > 0) {
    categories.push({
      key: 'other',
      title: 'Sonstiges',
      icon: '📦',
      types: other,
      collapsedByDefault: true,
    });
  }
  return categories;
}
