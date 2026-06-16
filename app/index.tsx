import { useFocusEffect, useRouter } from 'expo-router';
import React, { useCallback, useEffect, useState } from 'react';
import {
  Alert,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { publishWidgetSnapshot, WidgetClusterEntry } from '../modules/captain-widget';
import { abbreviationFor } from '../src/kube/categories';
import { ClusterHealth, getClusterHealth, healthTone } from '../src/kube/health';
import { useClusters } from '../src/state/ClustersContext';
import { useFavorites } from '../src/state/FavoritesContext';
import { favoriteKey } from '../src/storage/favorites';
import { ClusterConfig, FavoriteResource } from '../src/types';
import { Card, SquircleIcon, StatusDot } from '../src/ui/kit';
import { Loading } from '../src/ui/components';
import { useResponsiveLayout } from '../src/ui/useResponsiveLayout';
import { colors, radius, spacing } from '../src/ui/theme';

const TONE_COLORS = {
  ok: colors.success,
  warn: colors.warning,
  bad: colors.danger,
  unknown: colors.textFaint,
} as const;

function healthSummary(health: ClusterHealth | null | undefined): string | null {
  if (!health) return null;
  if (!health.reachable) return 'unreachable';
  const parts = [`${health.nodesReady}/${health.nodesTotal} nodes`, `${health.podsTotal} pods`];
  if (health.podsProblem > 0) {
    parts.push(`${health.podsProblem} ${health.podsProblem === 1 ? 'problem' : 'problems'}`);
  }
  return parts.join(' · ');
}

function authLabel(cluster: ClusterConfig): string {
  switch (cluster.auth.type) {
    case 'token':
      return 'Bearer token';
    case 'clientCert':
      return 'Client certificate';
    case 'eks':
      return `AWS EKS · ${cluster.auth.region}`;
    case 'gke':
      return 'Google GKE';
    case 'aks':
      return 'Azure AKS';
    case 'oidc':
      return 'OIDC';
  }
}

function ConnectOption({
  icon,
  iconBg,
  title,
  subtitle,
  onPress,
}: {
  icon: string;
  iconBg: string;
  title: string;
  subtitle: string;
  onPress: () => void;
}) {
  return (
    <TouchableOpacity onPress={onPress}>
      <Card style={styles.option}>
        <View style={[styles.optionIcon, { backgroundColor: iconBg }]}>
          <Text style={styles.optionIconText}>{icon}</Text>
        </View>
        <View style={{ flex: 1, gap: 2 }}>
          <Text style={styles.optionTitle}>{title}</Text>
          <Text style={styles.optionSub}>{subtitle}</Text>
        </View>
        <Text style={styles.chevron}>›</Text>
      </Card>
    </TouchableOpacity>
  );
}

export default function HomeScreen() {
  const router = useRouter();
  const { clusters, loading, remove, getById } = useClusters();
  const { favorites, remove: removeFavorite } = useFavorites();
  const [health, setHealth] = useState<Record<string, ClusterHealth | null>>({});
  // iPad: keep the hero/cluster cards at a phone-ish width, centered.
  const { isWide } = useResponsiveLayout();

  // Probe every stored cluster in parallel whenever the home screen appears.
  useFocusEffect(
    useCallback(() => {
      let cancelled = false;
      for (const cluster of clusters) {
        void getClusterHealth(cluster).then((result) => {
          if (!cancelled) setHealth((current) => ({ ...current, [cluster.id]: result }));
        });
      }
      return () => {
        cancelled = true;
      };
    }, [clusters])
  );

  // Mirror every finished probe to the home-screen widget.
  useEffect(() => {
    const entries: WidgetClusterEntry[] = [];
    for (const cluster of clusters) {
      const clusterHealth = health[cluster.id];
      if (!clusterHealth) continue;
      entries.push({
        name: cluster.name,
        tone: healthTone(clusterHealth),
        summary: healthSummary(clusterHealth) ?? '',
      });
    }
    if (entries.length > 0) {
      publishWidgetSnapshot({ clusters: entries, updatedAt: Math.floor(Date.now() / 1000) });
    }
  }, [clusters, health]);

  if (loading) return <Loading />;

  const confirmDelete = (cluster: ClusterConfig) => {
    Alert.alert('Remove cluster', `Really remove "${cluster.name}"?`, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Remove', style: 'destructive', onPress: () => void remove(cluster.id) },
    ]);
  };

  // Only show pins whose cluster still exists; tapping jumps straight to the item.
  const pinned = favorites.filter((fav) => getById(fav.clusterId));

  const openFavorite = (fav: FavoriteResource) => {
    router.push({
      pathname: '/cluster/[id]/item',
      params: {
        id: fav.clusterId,
        group: fav.group,
        version: fav.version,
        plural: fav.plural,
        kind: fav.kind,
        namespaced: fav.namespaced ? '1' : '0',
        verbs: fav.verbs.join(','),
        name: fav.name,
        namespace: fav.namespace ?? '',
      },
    });
  };

  const confirmUnpin = (fav: FavoriteResource) => {
    Alert.alert('Unpin', `Remove "${fav.name}" from pinned?`, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Unpin', style: 'destructive', onPress: () => removeFavorite(favoriteKey(fav)) },
    ]);
  };

  return (
    <View style={styles.container}>
      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={[styles.scroll, isWide && styles.scrollWide]}
      >
        {/* Hero */}
        <View style={[styles.hero, clusters.length > 0 && styles.heroCompact]}>
          <View style={styles.logo}>
            <Text style={styles.logoGlyph}>⎈</Text>
          </View>
          <Text style={styles.appName}>Captain</Text>
          {clusters.length === 0 ? (
            <Text style={styles.tagline}>
              Your clusters, in your pocket. Friendly on the surface, full Kubernetes underneath.
            </Text>
          ) : null}
        </View>

        {/* Pinned resources (across all clusters) */}
        {pinned.length > 0 ? (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Pinned</Text>
            {pinned.map((fav) => {
              const cluster = getById(fav.clusterId);
              const sub = [fav.kind, cluster?.name, fav.namespace].filter(Boolean).join(' · ');
              return (
                <TouchableOpacity
                  key={favoriteKey(fav)}
                  onPress={() => openFavorite(fav)}
                  onLongPress={() => confirmUnpin(fav)}
                >
                  <Card style={styles.pinnedRow}>
                    <SquircleIcon abbr={abbreviationFor(fav)} color={colors.accent} size={32} />
                    <View style={{ flex: 1, gap: 2 }}>
                      <Text style={styles.clusterName} numberOfLines={1}>
                        {fav.name}
                      </Text>
                      <Text style={styles.clusterSub} numberOfLines={1}>
                        {sub}
                      </Text>
                    </View>
                    <Text style={styles.starGlyph}>★</Text>
                    <Text style={styles.chevron}>›</Text>
                  </Card>
                </TouchableOpacity>
              );
            })}
            <Text style={styles.hint}>Long-press a pin to remove it.</Text>
          </View>
        ) : null}

        {/* Stored clusters */}
        {clusters.length > 0 ? (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Clusters</Text>
            {clusters.map((cluster) => {
              const clusterHealth = health[cluster.id];
              const summary = healthSummary(clusterHealth);
              const tone = healthTone(clusterHealth);
              return (
                <TouchableOpacity
                  key={cluster.id}
                  onPress={() => router.push(`/cluster/${cluster.id}` as never)}
                  onLongPress={() => confirmDelete(cluster)}
                >
                  <Card style={styles.clusterRow}>
                    <StatusDot color={TONE_COLORS[tone]} />
                    <View style={{ flex: 1, gap: 2 }}>
                      <Text style={styles.clusterName}>{cluster.name}</Text>
                      <Text style={styles.clusterSub} numberOfLines={1}>
                        {authLabel(cluster)} · {cluster.server.replace(/^https?:\/\//, '')}
                      </Text>
                      {summary ? (
                        <Text
                          style={[
                            styles.clusterHealth,
                            tone !== 'ok' && { color: TONE_COLORS[tone] },
                          ]}
                          numberOfLines={1}
                        >
                          {summary}
                        </Text>
                      ) : null}
                    </View>
                    <Text style={styles.chevron}>›</Text>
                  </Card>
                </TouchableOpacity>
              );
            })}
            <Text style={styles.hint}>Long-press a cluster to remove it.</Text>
          </View>
        ) : null}

        {/* Connect options */}
        <View style={styles.section}>
          {clusters.length > 0 ? <Text style={styles.sectionTitle}>Add cluster</Text> : null}
          <ConnectOption
            icon="▣"
            iconBg="#6B8AFF"
            title="Scan QR code"
            subtitle="Kubeconfig as QR, e.g. from qrencode"
            onPress={() => router.push('/qr-scan')}
          />
          <ConnectOption
            icon="⧉"
            iconBg="#3FE0C5"
            title="Paste kubeconfig"
            subtitle="Import contexts from clipboard"
            onPress={() => router.push('/kubeconfig-import')}
          />
          <ConnectOption
            icon="⌘"
            iconBg="#A78BFA"
            title="Single Sign-On"
            subtitle="EKS · GKE · AKS · OIDC"
            onPress={() => router.push('/cluster-form')}
          />
          <ConnectOption
            icon="✎"
            iconBg="#FFC46B"
            title="Manual setup"
            subtitle="API server URL, token or client certificate"
            onPress={() => router.push('/cluster-form')}
          />
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  scroll: { padding: spacing.xl, paddingBottom: 54, flexGrow: 1, justifyContent: 'center' },
  scrollWide: { maxWidth: 640, width: '100%', alignSelf: 'center' },
  hero: { alignItems: 'center', gap: 18, paddingVertical: 28 },
  heroCompact: { paddingVertical: 16, gap: 10 },
  logo: {
    width: 96,
    height: 96,
    borderRadius: 28,
    backgroundColor: '#5577F2',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#5B7CFF',
    shadowOpacity: 0.35,
    shadowRadius: 48,
    shadowOffset: { width: 0, height: 16 },
    elevation: 14,
  },
  logoGlyph: { color: '#fff', fontSize: 54 },
  appName: { color: colors.text, fontSize: 40, fontWeight: '800', letterSpacing: -1 },
  tagline: {
    color: 'rgba(242,245,250,0.6)',
    fontSize: 16,
    lineHeight: 24,
    textAlign: 'center',
    maxWidth: 290,
  },
  section: { gap: 10, paddingTop: 18 },
  sectionTitle: { color: colors.text, fontSize: 15, fontWeight: '700', paddingHorizontal: 4 },
  clusterRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    borderRadius: radius.card + 2,
    padding: 15,
  },
  clusterName: { color: colors.text, fontSize: 15.5, fontWeight: '600' },
  clusterSub: { color: colors.textDim, fontSize: 12 },
  pinnedRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    borderRadius: radius.card + 2,
    padding: 15,
  },
  starGlyph: { color: colors.warning, fontSize: 14 },
  clusterHealth: { color: colors.textDim, fontSize: 11.5, fontWeight: '600' },
  option: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    borderRadius: radius.card + 2,
    padding: 15,
  },
  optionIcon: {
    width: 40,
    height: 40,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  optionIconText: { color: '#fff', fontSize: 18, fontWeight: '700' },
  optionTitle: { color: colors.text, fontSize: 15.5, fontWeight: '600' },
  optionSub: { color: colors.textDim, fontSize: 12.5 },
  chevron: { color: 'rgba(242,245,250,0.3)', fontSize: 20, fontWeight: '600' },
  hint: { color: colors.textFaint, fontSize: 11, textAlign: 'center', paddingTop: 2 },
});
