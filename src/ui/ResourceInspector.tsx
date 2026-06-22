import yaml from 'js-yaml';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ScrollView, StyleSheet, Text, TouchableOpacity, View } from './rn';
import { getResource, listEventsFor, ResourceEvent } from '../kube/client';
import { summarizeResource } from '../kube/summarize';
import { ApiResourceType, ClusterConfig } from '../types';
import { ageOf } from '../util/format';
import { Card, Pill, StatusDot } from './kit';
import { ErrorBox, Loading } from './components';
import { colors, radius, spacing } from './theme';
import { YamlView } from './YamlView';

const STATUS_COLORS = { ok: colors.success, warn: colors.warning, bad: colors.danger } as const;

function stripManagedFields(manifest: Record<string, unknown>): Record<string, unknown> {
  const metadata = manifest.metadata as Record<string, unknown> | undefined;
  if (metadata && 'managedFields' in metadata) {
    const { managedFields: _omitted, ...rest } = metadata;
    return { ...manifest, metadata: rest };
  }
  return manifest;
}

/**
 * Read-only detail pane for the iPad split view: summary cards, events and
 * YAML for the selected resource. Actions (edit, scale, logs …) live in the
 * full item screen, reachable via the Open button.
 */
export function ResourceInspector({
  cluster,
  type,
  name,
  namespace,
  onOpenFull,
}: {
  cluster: ClusterConfig;
  type: ApiResourceType;
  name: string;
  namespace?: string;
  onOpenFull: () => void;
}) {
  const [manifest, setManifest] = useState<Record<string, unknown> | null>(null);
  const [events, setEvents] = useState<ResourceEvent[]>([]);
  const [tab, setTab] = useState<'overview' | 'yaml'>('overview');
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setManifest(null);
    setError('');
    try {
      setManifest(await getResource(cluster, type, name, namespace));
      listEventsFor(cluster, type.kind, name, namespace)
        .then(setEvents)
        .catch(() => setEvents([]));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    }
  }, [cluster, type, name, namespace]);

  useEffect(() => {
    void load();
  }, [load]);

  const yamlText = useMemo(
    () =>
      manifest ? yaml.dump(stripManagedFields(manifest), { noRefs: true, lineWidth: -1 }) : '',
    [manifest]
  );
  const sections = useMemo(
    () => (manifest ? summarizeResource(type, manifest) : []),
    [manifest, type]
  );

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={styles.headerName} numberOfLines={1}>
            {name}
          </Text>
          <Text style={styles.headerSub} numberOfLines={1}>
            {type.kind}
            {namespace ? ` · ${namespace}` : ''}
          </Text>
        </View>
        <Pill
          label={tab === 'yaml' ? 'Overview' : 'YAML'}
          onPress={() => setTab(tab === 'yaml' ? 'overview' : 'yaml')}
        />
        <Pill label="Open ↗" active onPress={onOpenFull} />
      </View>

      {error ? (
        <View style={{ padding: spacing.lg }}>
          <ErrorBox message={error} />
        </View>
      ) : manifest === null ? (
        <Loading />
      ) : (
        <ScrollView style={{ flex: 1 }} contentContainerStyle={styles.scroll}>
          {tab === 'yaml' ? (
            <Card style={styles.yamlCard}>
              <YamlView text={yamlText} />
            </Card>
          ) : (
            <>
              {sections.map((section) => (
                <Card key={section.title} style={styles.summaryCard}>
                  <Text style={styles.cardTitle}>{section.title}</Text>
                  {section.rows.map((entry, index) => (
                    <View
                      key={`${entry.label}-${index}`}
                      style={[styles.kvRow, index > 0 && styles.kvDivider]}
                    >
                      <View style={styles.kvLabelWrap}>
                        {entry.status ? (
                          <StatusDot color={STATUS_COLORS[entry.status]} size={8} />
                        ) : null}
                        <Text style={styles.kvLabel}>{entry.label}</Text>
                      </View>
                      <Text style={[styles.kvValue, entry.mono && styles.kvValueMono]} selectable>
                        {entry.value}
                      </Text>
                    </View>
                  ))}
                </Card>
              ))}
              {events.length > 0 ? (
                <Card style={styles.summaryCard}>
                  <Text style={styles.cardTitle}>Events</Text>
                  {events.map((event, index) => (
                    <View key={index} style={[styles.eventRow, index > 0 && styles.kvDivider]}>
                      <View style={styles.kvLabelWrap}>
                        <StatusDot
                          color={event.type === 'Normal' ? colors.success : colors.warning}
                          size={8}
                        />
                        <Text style={styles.kvLabel}>
                          {event.reason}
                          {event.count && event.count > 1 ? ` ×${event.count}` : ''}
                          {event.lastTimestamp ? ` · ${ageOf(event.lastTimestamp)}` : ''}
                        </Text>
                      </View>
                      <Text style={styles.eventMessage} selectable>
                        {event.message}
                      </Text>
                    </View>
                  ))}
                </Card>
              ) : null}
            </>
          )}
        </ScrollView>
      )}
    </View>
  );
}

/** Placeholder for the right pane before anything is selected. */
export function InspectorPlaceholder() {
  return (
    <View style={styles.placeholder}>
      <Text style={styles.placeholderGlyph}>⎈</Text>
      <Text style={styles.placeholderText}>Select a resource to inspect it</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: spacing.lg,
    paddingBottom: 10,
  },
  headerName: { color: colors.text, fontSize: 14, fontWeight: '700' },
  headerSub: { color: 'rgba(242,245,250,0.4)', fontSize: 11.5 },
  scroll: { padding: spacing.lg, paddingTop: 4, paddingBottom: 60, gap: 12 },
  summaryCard: { gap: 0, borderRadius: radius.card + 2 },
  cardTitle: {
    color: colors.link,
    fontSize: 12,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: spacing.sm,
  },
  kvRow: { flexDirection: 'row', alignItems: 'flex-start', paddingVertical: 6 },
  kvDivider: { borderTopColor: colors.borderFaint, borderTopWidth: StyleSheet.hairlineWidth },
  kvLabelWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    width: '38%',
    paddingRight: spacing.sm,
  },
  kvLabel: { color: colors.textDim, fontSize: 12.5, flexShrink: 1 },
  kvValue: { color: colors.text, fontSize: 12.5, flex: 1 },
  kvValueMono: { fontFamily: 'Menlo', fontSize: 11.5, color: colors.mono },
  eventRow: { paddingVertical: 7 },
  eventMessage: { color: colors.text, fontSize: 12.5, marginTop: 2, marginLeft: 14, lineHeight: 18 },
  yamlCard: { borderRadius: radius.card, backgroundColor: colors.backgroundDeep },
  placeholder: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 10 },
  placeholderGlyph: { fontSize: 40, color: 'rgba(242,245,250,0.15)' },
  placeholderText: { color: colors.textFaint, fontSize: 13.5 },
});
