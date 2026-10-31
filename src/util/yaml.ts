import { CORE_SCHEMA, load, mergeTag } from 'js-yaml';

// Kubernetes manifests and kubeconfigs may use `<<` merge keys, which the
// js-yaml default schema leaves as a literal key instead of resolving.
const SCHEMA = CORE_SCHEMA.withTags(mergeTag);

/** Parses a YAML document; blank or comment-only input yields undefined instead of throwing. */
export function parseYaml(text: string): unknown {
  const hasContent = text.split('\n').some((line) => !/^\s*(#.*)?$/.test(line));
  return hasContent ? load(text, { schema: SCHEMA }) : undefined;
}
