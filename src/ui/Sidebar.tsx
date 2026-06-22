import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { abbreviationFor, categorizeResourceTypes, ResourceCategory } from '../kube/categories';
import { discoverResourceTypesCached } from '../kube/client';
import { useAccessibleResourceTypes } from '../state/AccessContext';
import { MasterView, useClusterNav } from '../state/ClusterNav';
import { namespaceLabel, useClusterScope } from '../state/ClusterScope';
import { ConnectionState, useClusterStatus } from '../state/ClusterStatusContext';
import { useClusters } from '../state/ClustersContext';
import { useFavorites } from '../state/FavoritesContext';
import { favoriteKey } from '../storage/favorites';
import { ApiResourceType, FavoriteResource } from '../types';
import { hapticTap } from '../util/haptics';
import { SHORTCUTS, TabIcon } from './clusterTabs';
import { SquircleIcon, StatusDot } from './kit';
import {
  ClusterSwitcherFlyout,
  FlyoutAnchor,
  NamespaceSheet,
  SettingsSheet,
} from './sheets';
import { colors, radius, spacing } from './theme';

/**
 * Lens-style navigation rail for wide screens: cluster switcher, favorites, the
 * dashboard, and the full resource tree grouped into collapsible categories,
 * plus tool shortcuts. Tapping an entry swaps the content column in place.
 */
function connectionColor(state: ConnectionState): string {
  switch (state) {
    case 'connected':
      return colors.success;
    case 'error':
      return colors.danger;
    case 'checking':
      return colors.warning;
    default:
      return colors.textFaint;
  }
}

export function Sidebar({ clusterId }: { clusterId: string }) {
  const nav = useClusterNav();
  const { getById } = useClusters();
  const { statusOf } = useClusterStatus();
  const cluster = getById(clusterId);
  const { namespace } = useClusterScope();
  const { favorites, remove: removeFavorite } = useFavorites();

  const [types, setTypes] = useState<ApiResourceType[]>([]);
  const [hasGitOps, setHasGitOps] = useState(false);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [switcherOpen, setSwitcherOpen] = useState(false);
  const [switcherAnchor, setSwitcherAnchor] = useState<FlyoutAnchor | null>(null);
  const pillRef = useRef<View>(null);
  const [nsOpen, setNsOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);

  const load = useCallback(async () => {
    if (!cluster) return;
    try {
      const discovered = await discoverResourceTypesCached(cluster);
      setTypes(discovered);
      setHasGitOps(
        discovered.some(
          (type) =>
            (type.group === 'argoproj.io' && type.kind === 'Application') ||
            type.group.endsWith('.toolkit.fluxcd.io')
        )
      );
    } catch {
      // The dashboard surfaces discovery failures; the rail just stays lean.
    }
  }, [cluster]);

  useEffect(() => {
    void load();
  }, [load]);

  // Listable kinds, narrowed to what the current credentials may list (RBAC).
  const listableTypes = useMemo(
    () => types.filter((type) => type.verbs.includes('list')),
    [types]
  );
  const accessibleTypes = useAccessibleResourceTypes(listableTypes);
  const categories = useMemo(
    () => categorizeResourceTypes(accessibleTypes),
    [accessibleTypes]
  );

  if (!cluster) return null;

  const current = nav.current;
  const onDashboard = current.kind === 'dashboard';
  const onEvents = current.kind === 'events';
  const activePlural = current.kind === 'list' ? current.type.plural : undefined;
  const activeKindsCategory = current.kind === 'kinds' ? current.category : undefined;
  const activeShortcut =
    current.kind === 'helm'
      ? 'helm'
      : current.kind === 'gitops'
        ? 'gitops'
        : current.kind === 'forwards'
          ? 'forwards'
          : current.kind === 'search'
            ? 'search'
            : undefined;

  const isExpanded = (key: string, collapsedByDefault?: boolean) =>
    expanded[key] ?? !collapsedByDefault;
  const toggle = (key: string, collapsedByDefault?: boolean) =>
    setExpanded((current) => ({ ...current, [key]: !isExpanded(key, collapsedByDefault) }));

  const viewForPath = (path: string): MasterView => {
    switch (path) {
      case 'events':
        return { kind: 'events' };
      case 'browse':
        return { kind: 'browse' };
      case 'helm':
        return { kind: 'helm' };
      case 'gitops':
        return { kind: 'gitops' };
      case 'forwards':
        return { kind: 'forwards' };
      case 'search':
        return { kind: 'search' };
      default:
        return { kind: 'dashboard' };
    }
  };

  const go = (path: string) => {
    hapticTap();
    nav.show(viewForPath(path));
  };

  const openType = (type: ApiResourceType) => {
    hapticTap();
    nav.show({ kind: 'list', type });
  };

  const openKinds = (category: ResourceCategory) => {
    hapticTap();
    nav.show({ kind: 'kinds', category: category.key, title: category.title });
  };

  const openFavorite = (fav: FavoriteResource) => {
    hapticTap();
    nav.openItem(
      {
        group: fav.group,
        version: fav.version,
        plural: fav.plural,
        kind: fav.kind,
        namespaced: fav.namespaced,
        verbs: fav.verbs,
      },
      fav.name,
      fav.namespace
    );
  };

  const clusterFavorites = favorites.filter((fav) => fav.clusterId === clusterId);

  return (
    <View style={styles.rail}>
      <TouchableOpacity
        ref={pillRef}
        style={styles.clusterPill}
        onPress={() => {
          pillRef.current?.measureInWindow((x, y, width, height) => {
            setSwitcherAnchor({ x, y, width, height });
            setSwitcherOpen(true);
          });
        }}
      >
        <StatusDot color={connectionColor(statusOf(clusterId))} size={9} />
        <Text style={styles.clusterName} numberOfLines={1}>
          {cluster.name}
        </Text>
        <Text style={styles.clusterChevron}>⌄</Text>
      </TouchableOpacity>

      <ScrollView style={{ flex: 1 }} contentContainerStyle={styles.scroll}>
        {/* Favorites */}
        {clusterFavorites.length > 0 ? (
          <View style={styles.group}>
            <TouchableOpacity style={styles.sectionRow} onPress={() => toggle('favorites')}>
              <Text style={styles.sectionStar}>★</Text>
              <Text style={styles.sectionTitle}>Favorites</Text>
              <Text style={styles.caret}>{isExpanded('favorites') ? '⌄' : '›'}</Text>
            </TouchableOpacity>
            {isExpanded('favorites')
              ? clusterFavorites.map((fav) => (
                  <TouchableOpacity
                    key={favoriteKey(fav)}
                    style={styles.kindRow}
                    onPress={() => openFavorite(fav)}
                    onLongPress={() => removeFavorite(favoriteKey(fav))}
                  >
                    <Text style={styles.kindLabel} numberOfLines={1}>
                      {fav.name}
                    </Text>
                    <Text style={styles.kindMeta} numberOfLines={1}>
                      {fav.kind}
                    </Text>
                  </TouchableOpacity>
                ))
              : null}
          </View>
        ) : null}

        {/* Primary */}
        <View style={styles.group}>
          <TouchableOpacity
            style={[styles.navItem, onDashboard && styles.navItemActive]}
            onPress={() => go('')}
          >
            {onDashboard ? <View style={styles.activeBar} pointerEvents="none" /> : null}
            <TabIcon tab="home" color={onDashboard ? '#fff' : colors.textDim} />
            <Text style={[styles.navLabel, { color: onDashboard ? '#fff' : colors.textDim }]}>
              Cluster
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.navItem, onEvents && styles.navItemActive]}
            onPress={() => go('events')}
          >
            {onEvents ? <View style={styles.activeBar} pointerEvents="none" /> : null}
            <TabIcon tab="events" color={onEvents ? '#fff' : colors.textDim} />
            <Text style={[styles.navLabel, { color: onEvents ? '#fff' : colors.textDim }]}>
              Events
            </Text>
          </TouchableOpacity>
        </View>

        {/* Resource tree */}
        {categories.map((category) => {
          // Open-ended catch-alls (CRDs, misc) get a sub-list instead of
          // dumping every kind into the rail.
          if (category.key === 'custom' || category.key === 'other') {
            const active = activeKindsCategory === category.key;
            return (
              <View key={category.key} style={styles.group}>
                <TouchableOpacity
                  style={[styles.navItem, active && styles.navItemActive]}
                  onPress={() => openKinds(category)}
                >
                  {active ? <View style={styles.activeBar} pointerEvents="none" /> : null}
                  <SquircleIcon abbr={category.title.slice(0, 2)} color={category.color} size={22} />
                  <Text style={[styles.navLabel, { color: active ? '#fff' : colors.textDim }]}>
                    {category.title}
                  </Text>
                  <Text style={styles.caret}>›</Text>
                </TouchableOpacity>
              </View>
            );
          }
          const open = isExpanded(category.key, category.collapsedByDefault);
          return (
            <View key={category.key} style={styles.group}>
              <TouchableOpacity
                style={styles.sectionRow}
                onPress={() => toggle(category.key, category.collapsedByDefault)}
              >
                <SquircleIcon abbr={category.title.slice(0, 2)} color={category.color} size={20} />
                <Text style={styles.sectionTitle}>{category.title}</Text>
                <Text style={styles.caret}>{open ? '⌄' : '›'}</Text>
              </TouchableOpacity>
              {open
                ? category.types.map((type) => {
                    const active = type.plural === activePlural;
                    return (
                      <TouchableOpacity
                        key={`${type.group}/${type.version}/${type.plural}`}
                        style={[styles.kindRow, active && styles.kindRowActive]}
                        onPress={() => openType(type)}
                      >
                        {active ? <View style={styles.activeBar} pointerEvents="none" /> : null}
                        <Text
                          style={[styles.kindLabel, active && styles.kindLabelActive]}
                          numberOfLines={1}
                        >
                          {type.kind}
                        </Text>
                        {!type.namespaced ? <Text style={styles.kindMeta}>cluster</Text> : null}
                      </TouchableOpacity>
                    );
                  })
                : null}
            </View>
          );
        })}

        {/* Tools */}
        <Text style={styles.toolsLabel}>Tools</Text>
        <View style={styles.group}>
          {SHORTCUTS.filter((s) => s.path !== 'gitops' || hasGitOps).map((shortcut) => {
            const active = activeShortcut === shortcut.path;
            return (
              <TouchableOpacity
                key={shortcut.path}
                style={[styles.navItem, active && styles.navItemActive]}
                onPress={() => go(shortcut.path)}
              >
                {active ? <View style={styles.activeBar} pointerEvents="none" /> : null}
                <SquircleIcon abbr={shortcut.abbr} color={shortcut.color} size={22} />
                <Text style={[styles.navLabel, { color: active ? '#fff' : colors.textDim }]}>
                  {shortcut.label}
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>
      </ScrollView>

      <View style={styles.footer}>
        <TouchableOpacity style={styles.nsPill} onPress={() => setNsOpen(true)}>
          <Text style={styles.nsText} numberOfLines={1}>
            {namespaceLabel(namespace)} ▾
          </Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.settingsButton} onPress={() => setSettingsOpen(true)}>
          <Text style={styles.settingsGlyph}>⚙</Text>
        </TouchableOpacity>
      </View>

      <ClusterSwitcherFlyout
        visible={switcherOpen}
        onClose={() => setSwitcherOpen(false)}
        activeCluster={cluster}
        anchor={switcherAnchor}
      />
      <NamespaceSheet visible={nsOpen} onClose={() => setNsOpen(false)} cluster={cluster} />
      <SettingsSheet
        visible={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        cluster={cluster}
        onOpenNamespaces={() => {
          setSettingsOpen(false);
          setNsOpen(true);
        }}
      />
    </View>
  );
}

const SIDEBAR_WIDTH = 256;

const styles = StyleSheet.create({
  rail: {
    width: SIDEBAR_WIDTH,
    backgroundColor: colors.surface,
    borderRightColor: colors.border,
    borderRightWidth: StyleSheet.hairlineWidth,
    paddingTop: 60,
  },
  clusterPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 9,
    marginHorizontal: spacing.md,
    marginBottom: spacing.sm,
    paddingHorizontal: 13,
    paddingVertical: 11,
    borderRadius: radius.card,
    backgroundColor: colors.background,
    borderWidth: 1,
    borderColor: colors.border,
  },
  clusterName: { flex: 1, color: colors.text, fontSize: 14, fontWeight: '700' },
  clusterChevron: { color: colors.textFaint, fontSize: 14 },
  scroll: { paddingHorizontal: spacing.sm, paddingBottom: spacing.lg },
  group: { marginBottom: 2 },
  navItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 11,
    paddingVertical: 9,
    borderRadius: radius.card,
  },
  navItemActive: { backgroundColor: colors.accentSoft },
  navLabel: { fontSize: 14, fontWeight: '600' },
  activeBar: {
    position: 'absolute',
    left: 0,
    top: 7,
    bottom: 7,
    width: 3,
    borderRadius: 2,
    backgroundColor: '#fff',
  },
  sectionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 11,
    paddingVertical: 8,
    marginTop: 6,
  },
  sectionStar: { color: colors.warning, fontSize: 14, width: 20, textAlign: 'center' },
  sectionTitle: {
    flex: 1,
    color: colors.textMid,
    fontSize: 12,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.4,
  },
  caret: { color: colors.textFaint, fontSize: 13 },
  kindRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingLeft: 42,
    paddingRight: 11,
    paddingVertical: 7,
    borderRadius: radius.card,
  },
  kindRowActive: { backgroundColor: colors.accentSoft },
  kindLabel: { flex: 1, color: colors.textDim, fontSize: 13.5 },
  kindLabelActive: { color: '#fff', fontWeight: '600' },
  kindMeta: { color: colors.textFaint, fontSize: 10.5 },
  toolsLabel: {
    color: colors.textFaint,
    fontSize: 11,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    paddingHorizontal: 11,
    paddingTop: spacing.md,
    paddingBottom: 4,
  },
  footer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: spacing.md,
    paddingTop: 10,
    paddingBottom: 18,
    borderTopColor: colors.border,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  nsPill: {
    flex: 1,
    paddingHorizontal: 12,
    paddingVertical: 9,
    borderRadius: radius.pill,
    backgroundColor: colors.background,
    borderWidth: 1,
    borderColor: colors.border,
  },
  nsText: { color: colors.textDim, fontSize: 12.5, fontWeight: '600' },
  settingsButton: {
    width: 38,
    height: 38,
    borderRadius: radius.card,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.background,
    borderWidth: 1,
    borderColor: colors.border,
  },
  settingsGlyph: { color: colors.textDim, fontSize: 17 },
});
