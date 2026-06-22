import yaml from 'js-yaml';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { Text } from './Text';
import {
  getHelmReleaseDetail,
  HelmReleaseDetail,
  HelmRevision,
  listHelmHistory,
} from '../kube/helm';
import { ClusterConfig } from '../types';
import { BackButton, Card, CloseButton, Pill, StatusDot } from './kit';
import { EmptyState, ErrorBox, Loading } from './components';
import { helmStatusColor } from './helmStatus';
import { YamlView } from './YamlView';
import { colors, radius, spacing } from './theme';
import { ageOf } from '../util/format';

type Tab = 'overview' | 'values' | 'manifest' | 'notes';

export interface HelmReleaseViewProps {
  cluster: ClusterConfig;
  namespace: string;
  name: string;
  revision: string;
  secretName: string;
  mode: 'screen' | 'pane';
  onClose: () => void;
  onBack?: () => void;
}

export function HelmReleaseView({
  cluster,
  namespace,
  name,
  secretName,
  mode,
  onClose,
  onBack,
}: HelmReleaseViewProps) {
  const [detail, setDetail] = useState<HelmReleaseDetail | null>(null);
  const [history, setHistory] = useState<HelmRevision[]>([]);
  const [tab, setTab] = useState<Tab>('overview');
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    if (!cluster || !namespace || !secretName) return;
    setError('');
    try {
      const [releaseDetail, revisions] = await Promise.all([
        getHelmReleaseDetail(cluster, namespace, secretName),
        listHelmHistory(cluster, namespace, name),
      ]);
      setDetail(releaseDetail);
      setHistory(revisions);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    }
  }, [cluster, namespace, secretName, name]);

  useEffect(() => {
    void load();
  }, [load]);

  const valuesYaml = useMemo(
    () =>
      detail?.values && Object.keys(detail.values).length > 0
        ? yaml.dump(detail.values, { noRefs: true, lineWidth: -1 })
        : '',
    [detail]
  );

  if (!cluster) return <EmptyState message="Cluster not found." />;

  const tabs: Array<{ key: Tab; label: string }> = [
    { key: 'overview', label: 'Overview' },
    { key: 'values', label: 'Values' },
    { key: 'manifest', label: 'Manifest' },
  ];
  if (detail?.notes) tabs.push({ key: 'notes', label: 'Notes' });

  return (
    <View style={styles.container}>
      <View style={[styles.header, mode === 'pane' && styles.headerPane]}>
        {mode === 'screen' ? (
          <BackButton onPress={onClose} />
        ) : onBack ? (
          <BackButton onPress={onBack} />
        ) : (
          <CloseButton onPress={onClose} />
        )}
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={styles.headerName} numberOfLines={1}>
            {name}
          </Text>
          <Text style={styles.headerSub} numberOfLines={1}>
            Helm release · {namespace}
          </Text>
        </View>
        {detail ? (
          <View
            style={[styles.statusPill, { backgroundColor: `${helmStatusColor(detail.status)}26` }]}
          >
            <Text style={[styles.statusPillText, { color: helmStatusColor(detail.status) }]}>
              {detail.status}
            </Text>
          </View>
        ) : null}
      </View>

      <View style={styles.tabs}>
        {tabs.map((entry) => (
          <Pill
            key={entry.key}
            label={entry.label}
            active={tab === entry.key}
            onPress={() => setTab(entry.key)}
          />
        ))}
      </View>

      {error ? (
        <View style={{ padding: spacing.lg }}>
          <ErrorBox message={error} />
        </View>
      ) : !detail ? (
        <Loading />
      ) : (
        <ScrollView style={{ flex: 1 }} contentContainerStyle={styles.scroll}>
          {tab === 'overview' ? (
            <>
              <Card style={styles.card}>
                <Text style={styles.cardTitle}>Chart</Text>
                {[
                  { label: 'Chart', value: `${detail.chart}-${detail.chartVersion}` },
                  ...(detail.appVersion ? [{ label: 'App version', value: detail.appVersion }] : []),
                  ...(detail.description ? [{ label: 'Description', value: detail.description }] : []),
                  ...(detail.firstDeployed
                    ? [{ label: 'First deployed', value: `${ageOf(detail.firstDeployed)} ago` }]
                    : []),
                  ...(detail.lastDeployed
                    ? [{ label: 'Last deployed', value: `${ageOf(detail.lastDeployed)} ago` }]
                    : []),
                ].map((row, index) => (
                  <View key={row.label} style={[styles.kvRow, index > 0 && styles.kvDivider]}>
                    <Text style={styles.kvLabel}>{row.label}</Text>
                    <Text style={styles.kvValue} selectable>
                      {row.value}
                    </Text>
                  </View>
                ))}
              </Card>

              {history.length > 0 ? (
                <Card style={styles.card}>
                  <Text style={styles.cardTitle}>History</Text>
                  {history.map((revision, index) => (
                    <View
                      key={revision.revision}
                      style={[styles.kvRow, index > 0 && styles.kvDivider]}
                    >
                      <View style={styles.revLabelWrap}>
                        <StatusDot color={helmStatusColor(revision.status)} size={8} />
                        <Text style={[styles.kvLabel, { width: 'auto' }]}>
                          rev {revision.revision}
                        </Text>
                      </View>
                      <Text style={styles.kvValue}>
                        {revision.status}
                        {revision.updated ? ` · ${ageOf(revision.updated)} ago` : ''}
                      </Text>
                    </View>
                  ))}
                </Card>
              ) : null}
            </>
          ) : tab === 'values' ? (
            <Card style={styles.monoCard}>
              {valuesYaml ? (
                <YamlView text={valuesYaml} />
              ) : (
                <Text style={styles.mono} selectable>
                  (no user-supplied values — chart defaults only)
                </Text>
              )}
            </Card>
          ) : tab === 'manifest' ? (
            <Card style={styles.monoCard}>
              {detail.manifest?.trim() ? (
                <YamlView text={detail.manifest.trim()} />
              ) : (
                <Text style={styles.mono} selectable>
                  (empty manifest)
                </Text>
              )}
            </Card>
          ) : (
            <Card style={styles.monoCard}>
              <Text style={styles.mono} selectable>
                {detail.notes?.trim() ?? ''}
              </Text>
            </Card>
          )}
        </ScrollView>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  header: {
    paddingTop: 60,
    paddingHorizontal: spacing.lg,
    paddingBottom: 8,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  headerPane: { paddingTop: 16 },
  headerName: { color: colors.text, fontSize: 14, fontWeight: '700' },
  headerSub: { color: 'rgba(242,245,250,0.4)', fontSize: 11.5 },
  statusPill: { borderRadius: radius.pill, paddingHorizontal: 11, paddingVertical: 5 },
  statusPillText: { fontSize: 11, fontWeight: '700' },
  tabs: {
    flexDirection: 'row',
    gap: 7,
    paddingHorizontal: spacing.lg,
    paddingVertical: 8,
  },
  scroll: { padding: spacing.lg, paddingTop: 8, paddingBottom: 60, gap: 12 },
  card: { gap: 0, borderRadius: radius.card + 2 },
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
  kvLabel: { color: colors.textDim, fontSize: 12.5, width: '38%', paddingRight: spacing.sm },
  revLabelWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    width: '38%',
    paddingRight: spacing.sm,
  },
  kvValue: { color: colors.text, fontSize: 12.5, flex: 1 },
  monoCard: { borderRadius: radius.card, backgroundColor: colors.backgroundDeep },
  mono: { color: colors.mono, fontFamily: 'Menlo', fontSize: 10.5, lineHeight: 17 },
});
