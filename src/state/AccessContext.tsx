import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { AccessAttributes, canI, rulesAllow, selfSubjectRules, SubjectRules } from '../kube/access';
import { ApiResourceType } from '../types';
import { useClusterScope } from './ClusterScope';
import { useClusters } from './ClustersContext';

/**
 * RBAC awareness for the active cluster + namespace scope. On entering a
 * namespace it loads the user's rule set once (SelfSubjectRulesReview) so the UI
 * can hide kinds the user can't list and disable actions they can't run —
 * instead of letting every request fail with "forbidden". Everything fails open:
 * when permissions can't be determined the UI behaves exactly as before.
 */
interface AccessValue {
  /** True once we hold an authoritative namespaced rule set for this scope. */
  restricted: boolean;
  /** Synchronous gate for namespaced resources (fail-open when unknown). */
  can(verb: string, type: ApiResourceType): boolean;
  /** Precise async check (works cluster-scoped too); cached per scope. */
  checkAccess(attrs: AccessAttributes): Promise<boolean>;
}

const AccessContext = createContext<AccessValue | undefined>(undefined);

function attrKey(attrs: AccessAttributes): string {
  return [
    attrs.verb,
    attrs.group ?? '',
    attrs.resource ?? '',
    attrs.namespace ?? '',
    attrs.subresource ?? '',
    attrs.name ?? '',
  ].join('|');
}

export function AccessProvider({
  clusterId,
  children,
}: {
  clusterId: string;
  children: React.ReactNode;
}) {
  const { getById } = useClusters();
  const cluster = getById(clusterId);
  const { namespace } = useClusterScope();

  const [rules, setRules] = useState<SubjectRules | null>(null);
  // SSAR results, keyed by attributes; reset whenever the scope changes.
  const cache = useRef(new Map<string, Promise<boolean>>());

  useEffect(() => {
    cache.current = new Map();
    setRules(null);
    if (!cluster || namespace === '') return;
    let cancelled = false;
    selfSubjectRules(cluster, namespace)
      .then((result) => {
        if (!cancelled) setRules(result);
      })
      .catch(() => {
        // Can't enumerate rules — stay fail-open (rules === null).
      });
    return () => {
      cancelled = true;
    };
  }, [cluster, namespace]);

  const restricted = namespace !== '' && rules !== null;

  const can = useCallback(
    (verb: string, type: ApiResourceType): boolean => {
      // Only namespaced resources in a concrete namespace are gated here;
      // cluster-scoped checks go through checkAccess. Unknown → allow.
      if (!type.namespaced || namespace === '' || !rules) return true;
      return rulesAllow(rules, verb, type.group, type.plural);
    },
    [namespace, rules]
  );

  const checkAccess = useCallback(
    (attrs: AccessAttributes): Promise<boolean> => {
      if (!cluster) return Promise.resolve(true);
      const key = attrKey(attrs);
      const existing = cache.current.get(key);
      if (existing) return existing;
      const pending = canI(cluster, attrs);
      cache.current.set(key, pending);
      return pending;
    },
    [cluster]
  );

  const value = useMemo<AccessValue>(
    () => ({ restricted, can, checkAccess }),
    [restricted, can, checkAccess]
  );

  return <AccessContext.Provider value={value}>{children}</AccessContext.Provider>;
}

export function useAccess(): AccessValue {
  const context = useContext(AccessContext);
  if (!context) throw new Error('useAccess must be used within AccessProvider');
  return context;
}

function typeId(type: ApiResourceType): string {
  return `${type.group}/${type.plural}`;
}

/**
 * Filters discovered resource types down to those the user can actually list in
 * the current scope. Namespaced kinds are resolved synchronously from the rule
 * set; cluster-scoped kinds are probed with SelfSubjectAccessReview (cached) and
 * stay visible until a check comes back denied. No work is done — and nothing is
 * hidden — when the scope isn't permission-restricted.
 */
export function useAccessibleResourceTypes(types: ApiResourceType[]): ApiResourceType[] {
  const { restricted, can, checkAccess } = useAccess();
  const [clusterAllowed, setClusterAllowed] = useState<Record<string, boolean>>({});

  useEffect(() => {
    if (!restricted) {
      setClusterAllowed({});
      return;
    }
    let cancelled = false;
    const clusterTypes = types.filter((type) => !type.namespaced);
    Promise.all(
      clusterTypes.map(async (type) => {
        const ok = await checkAccess({ verb: 'list', group: type.group, resource: type.plural });
        return [typeId(type), ok] as const;
      })
    ).then((entries) => {
      if (!cancelled) setClusterAllowed(Object.fromEntries(entries));
    });
    return () => {
      cancelled = true;
    };
  }, [restricted, types, checkAccess]);

  return useMemo(() => {
    if (!restricted) return types;
    return types.filter((type) =>
      type.namespaced ? can('list', type) : clusterAllowed[typeId(type)] ?? true
    );
  }, [restricted, types, can, clusterAllowed]);
}
