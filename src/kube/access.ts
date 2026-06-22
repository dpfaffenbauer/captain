import { ClusterConfig } from '../types';
import { kubeRequestJson } from './transport';

/**
 * RBAC self-introspection via the authorization.k8s.io API. The cluster grants
 * `SelfSubjectAccessReview` and `SelfSubjectRulesReview` to every authenticated
 * user (the built-in `system:basic-user` ClusterRole), so Captain can ask
 * "what am I allowed to do?" up front instead of firing a request and getting a
 * "forbidden" error back. This is exactly what `kubectl auth can-i` does.
 */

export interface AccessAttributes {
  verb: string;
  /** API group; '' for the core group. */
  group?: string;
  /** Plural resource name, e.g. "pods". */
  resource?: string;
  /** Omit for a cluster-scoped check. */
  namespace?: string;
  name?: string;
  subresource?: string;
}

const SSAR_PATH = '/apis/authorization.k8s.io/v1/selfsubjectaccessreviews';
const SSRR_PATH = '/apis/authorization.k8s.io/v1/selfsubjectrulesreviews';

/**
 * `kubectl auth can-i <verb> <resource>`. Returns whether the current
 * credentials may perform the action. Fails open (true) when the review itself
 * can't be performed, so a quirky cluster never hides everything — the real
 * request still surfaces any genuine error.
 */
export async function canI(cluster: ClusterConfig, attrs: AccessAttributes): Promise<boolean> {
  try {
    const body = await kubeRequestJson<{ status?: { allowed?: boolean } }>(cluster, SSAR_PATH, {
      method: 'POST',
      body: JSON.stringify({
        apiVersion: 'authorization.k8s.io/v1',
        kind: 'SelfSubjectAccessReview',
        spec: {
          resourceAttributes: {
            namespace: attrs.namespace,
            verb: attrs.verb,
            group: attrs.group ?? '',
            resource: attrs.resource,
            name: attrs.name,
            subresource: attrs.subresource,
          },
        },
      }),
    });
    return body.status?.allowed === true;
  } catch {
    return true;
  }
}

export interface ResourceRule {
  verbs: string[];
  apiGroups?: string[];
  resources?: string[];
  resourceNames?: string[];
}

export interface SubjectRules {
  resourceRules: ResourceRule[];
  /** The server couldn't evaluate every rule (e.g. a webhook authorizer). */
  incomplete: boolean;
}

/**
 * `kubectl auth can-i --list`: the full set of resource rules the current user
 * has in a namespace. One round-trip describes every namespaced permission, so
 * the UI can hide kinds the user can't list and disable actions they can't run.
 * Throws on failure (callers fall back to fail-open behaviour).
 */
export async function selfSubjectRules(
  cluster: ClusterConfig,
  namespace: string
): Promise<SubjectRules> {
  const body = await kubeRequestJson<{
    status?: { resourceRules?: ResourceRule[]; incomplete?: boolean };
  }>(cluster, SSRR_PATH, {
    method: 'POST',
    body: JSON.stringify({
      apiVersion: 'authorization.k8s.io/v1',
      kind: 'SelfSubjectRulesReview',
      spec: { namespace },
    }),
  });
  return {
    resourceRules: body.status?.resourceRules ?? [],
    incomplete: body.status?.incomplete === true,
  };
}

function matches(values: string[] | undefined, candidate: string): boolean {
  if (!values) return false;
  return values.includes('*') || values.includes(candidate);
}

/** Whether a rule set permits `verb` on `group`/`resource`. */
export function rulesAllow(
  rules: SubjectRules,
  verb: string,
  group: string,
  resource: string
): boolean {
  return rules.resourceRules.some(
    (rule) =>
      matches(rule.verbs, verb) &&
      matches(rule.apiGroups, group) &&
      matches(rule.resources, resource)
  );
}
