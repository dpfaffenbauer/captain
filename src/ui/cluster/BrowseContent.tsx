import React, { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import {
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { abbreviationFor, categorizeResourceTypes } from '../../kube/categories';
import { discoverResourceTypes } from '../../kube/client';
import { getForwards, subscribeForwards } from '../../kube/portforward';
import { useAccessibleResourceTypes } from '../../state/AccessContext';
import { namespaceLabel, useClusterScope } from '../../state/ClusterScope';
import { useClusterNav } from '../../state/ClusterNav';
import { useClusters } from '../../state/ClustersContext';
import { ApiResourceType } from '../../types';
import { Card, Pill, SquircleIcon } from '../kit';
import { ClusterSwitcherButton, NamespaceSheet } from '../sheets';
import { EmptyState, ErrorBox, Loading } from '../components';
import { useResponsiveLayout } from '../useResponsiveLayout';
import { colors, radius, spacing } from '../theme';

export function BrowseContent({ clusterId }: { clusterId: string }) {
  const nav = useClusterNav();
  const { getById } = useClusters();
  const cluster = getById(clusterId);
  const { namespace } = useClusterScope();

  const [types, setTypes] = useState<ApiResourceType[]>([]);
  const [hasGitOps, setHasGitOps] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [nsOpen, setNsOpen] = useState(false);
  const forwardsCount = useSyncExternalStore(subscribeForwards, getForwards).filter(
    (forward) => forward.clusterId === clusterId
  ).length;
  // iPad: don't stretch the category cards across the full width.
  const { isWide } = useResponsiveLayout();

  const load = useCallback(async () => {
    if (!cluster) return;
    setError('');
    try {
      const discovered = await discoverResourceTypes(cluster);
      setTypes(discovered);
      setHasGitOps(
        discovered.some(
          (type) =>
            (type.group === 'argoproj.io' && type.kind === 'Application') ||
            type.group.endsWith('.toolkit.fluxcd.io')
        )
      );
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setLoading(false);
    }
  }, [cluster]);

  useEffect(() => {
    void load();
  }, [load]);

  // Only kinds the API supports listing, then narrowed to what the current
  // credentials may actually list (RBAC), so restricted users see a clean tree.
  const listableTypes = useMemo(
    () => types.filter((type) => type.verbs.includes('list')),
    [types]
  );
  const accessibleTypes = useAccessibleResourceTypes(listableTypes);
  const categories = useMemo(
    () => categorizeResourceTypes(accessibleTypes),
    [accessibleTypes]
  );

  const openType = (type: ApiResourceType) => {
    nav.show({ kind: 'list', type });
  };

  if (!cluster) return <EmptyState message="Cluster not found." />;

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        {/* The sidebar owns cluster switching on iPad/wide. */}
        {!isWide ? <ClusterSwitcherButton cluster={cluster} online={!error} /> : null}
        <View style={styles.titleRow}>
          <Text style={styles.title}>Browse</Text>
          <Pill label={`${namespaceLabel(namespace)} ▾`} onPress={() => setNsOpen(true)} />
        </View>
        <TouchableOpacity
          style={styles.search}
          onPress={() => nav.show({ kind: 'search' })}
        >
          <Text style={styles.searchIcon}>⌕</Text>
          <Text style={styles.searchText}>Search anything in the cluster</Text>
        </TouchableOpacity>
      </View>

      {error ? (
        <View style={{ padding: spacing.lg }}>
          <ErrorBox message={error} onRetry={() => void load()} />
        </View>
      ) : loading ? (
        <Loading />
      ) : (
        <ScrollView
          style={{ flex: 1 }}
          contentContainerStyle={[styles.scroll, isWide && styles.scrollWide]}
        >
          <View style={{ gap: 9 }}>
            <View style={styles.catHead}>
              <Text style={styles.catTitle}>Apps</Text>
            </View>
            <Card style={styles.catCard}>
              <TouchableOpacity
                style={styles.row}
                onPress={() => nav.show({ kind: 'helm' })}
              >
                <SquircleIcon abbr="He" color="#36B3F4" />
                <View style={{ flex: 1, gap: 1 }}>
                  <Text style={styles.rowLabel}>Helm Releases</Text>
                  <Text style={styles.rowSub}>Charts, history, values, manifests</Text>
                </View>
                <Text style={styles.chevron}>›</Text>
              </TouchableOpacity>
              {hasGitOps ? (
                <TouchableOpacity
                  style={[
                    styles.row,
                    { borderTopColor: colors.borderFaint, borderTopWidth: StyleSheet.hairlineWidth },
                  ]}
                  onPress={() => nav.show({ kind: 'gitops' })}
                >
                  <SquircleIcon abbr="Go" color="#F4845C" />
                  <View style={{ flex: 1, gap: 1 }}>
                    <Text style={styles.rowLabel}>GitOps</Text>
                    <Text style={styles.rowSub}>Argo CD · Flux · sync status</Text>
                  </View>
                  <Text style={styles.chevron}>›</Text>
                </TouchableOpacity>
              ) : null}
            </Card>
          </View>

          {categories.map((category) => (
            <View key={category.key} style={{ gap: 9 }}>
              <View style={styles.catHead}>
                <Text style={styles.catTitle}>{category.title}</Text>
                <Text style={styles.catMeta}>
                  {category.types.length} {category.types.length === 1 ? 'kind' : 'kinds'}
                </Text>
              </View>
              <Card style={styles.catCard}>
                {category.types.map((type, index) => (
                  <TouchableOpacity
                    key={`${type.group}/${type.version}/${type.plural}`}
                    style={[
                      styles.row,
                      index > 0 && {
                        borderTopColor: colors.borderFaint,
                        borderTopWidth: StyleSheet.hairlineWidth,
                      },
                    ]}
                    onPress={() => openType(type)}
                  >
                    <SquircleIcon abbr={abbreviationFor(type)} color={category.color} />
                    <View style={{ flex: 1, gap: 1 }}>
                      <Text style={styles.rowLabel}>{type.kind}</Text>
                      {category.key === 'custom' || category.key === 'other' ? (
                        <Text style={styles.rowSub}>
                          {type.group || 'core'}/{type.version}
                        </Text>
                      ) : null}
                    </View>
                    {!type.namespaced ? <Text style={styles.scopeTag}>cluster</Text> : null}
                    <Text style={styles.chevron}>›</Text>
                  </TouchableOpacity>
                ))}
                {category.key === 'network' ? (
                  <TouchableOpacity
                    style={[
                      styles.row,
                      { borderTopColor: colors.borderFaint, borderTopWidth: StyleSheet.hairlineWidth },
                    ]}
                    onPress={() => nav.show({ kind: 'forwards' })}
                  >
                    <SquircleIcon abbr="Pf" color={category.color} />
                    <View style={{ flex: 1, gap: 1 }}>
                      <Text style={styles.rowLabel}>Port Forwards</Text>
                    </View>
                    {forwardsCount > 0 ? (
                      <View style={styles.liveBadge}>
                        <Text style={styles.liveBadgeText}>{forwardsCount} live</Text>
                      </View>
                    ) : null}
                    <Text style={styles.chevron}>›</Text>
                  </TouchableOpacity>
                ) : null}
              </Card>
            </View>
          ))}
        </ScrollView>
      )}

      <NamespaceSheet visible={nsOpen} onClose={() => setNsOpen(false)} cluster={cluster} />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  header: { paddingTop: 62, paddingHorizontal: spacing.lg, gap: 12 },
  titleRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  title: { color: colors.text, fontSize: 30, fontWeight: '800', letterSpacing: -0.6 },
  search: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 9,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingVertical: 11,
  },
  searchIcon: { color: colors.textFaint, fontSize: 16 },
  searchText: { color: colors.textFaint, fontSize: 14 },
  scroll: { padding: spacing.lg, paddingTop: 14, paddingBottom: 130, gap: 20 },
  scrollWide: { maxWidth: 720, width: '100%', alignSelf: 'center' },
  catHead: { flexDirection: 'row', alignItems: 'baseline', gap: 8, paddingHorizontal: 4 },
  catTitle: { color: colors.text, fontSize: 15, fontWeight: '700' },
  catMeta: { color: colors.textFaint, fontSize: 11 },
  catCard: { borderRadius: radius.cardLg, padding: 0, overflow: 'hidden' },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 15,
    paddingVertical: 11,
  },
  rowLabel: { color: colors.text, fontSize: 14.5, fontWeight: '500' },
  rowSub: { color: colors.textFaint, fontSize: 10.5 },
  scopeTag: { color: colors.textFaint, fontSize: 10.5, fontWeight: '600' },
  chevron: { color: 'rgba(242,245,250,0.22)', fontSize: 18, fontWeight: '600' },
  liveBadge: {
    backgroundColor: 'rgba(143,165,255,0.15)',
    borderRadius: radius.pill,
    paddingHorizontal: 9,
    paddingVertical: 3,
  },
  liveBadgeText: { color: colors.link, fontSize: 10.5, fontWeight: '700' },
});
