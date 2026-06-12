import { useLocalSearchParams, useRouter } from 'expo-router';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { getPodLogs } from '../../../src/kube/client';
import { useClusters } from '../../../src/state/ClustersContext';
import { BackButton, Pill } from '../../../src/ui/kit';
import { EmptyState, ErrorBox, Loading } from '../../../src/ui/components';
import { colors, spacing } from '../../../src/ui/theme';

const LEVEL_COLORS: Record<string, string> = {
  ERROR: colors.danger,
  ERRO: colors.danger,
  FATAL: colors.danger,
  PANIC: colors.danger,
  WARN: colors.warning,
  WARNING: colors.warning,
  INFO: colors.link,
  DEBUG: colors.textFaint,
};

function lineColor(line: string): { level?: string; color: string } {
  const upper = line.toUpperCase();
  for (const [level, color] of Object.entries(LEVEL_COLORS)) {
    if (upper.includes(level)) return { level, color };
  }
  return { color: colors.mono };
}

export default function PodLogsScreen() {
  const params = useLocalSearchParams<{
    id: string;
    namespace: string;
    name: string;
    containers: string;
    previous?: string;
  }>();
  const router = useRouter();
  const { getById } = useClusters();
  const cluster = getById(params.id);

  const containers = useMemo(
    () => (params.containers ?? '').split(',').filter(Boolean),
    [params.containers]
  );
  const [container, setContainer] = useState<string | undefined>(containers[0]);
  const [previous, setPrevious] = useState(params.previous === '1');
  const [follow, setFollow] = useState(true);
  const [logs, setLogs] = useState<string | null>(null);
  const [error, setError] = useState('');
  const scrollRef = useRef<ScrollView>(null);

  const load = useCallback(async () => {
    if (!cluster || !params.namespace || !params.name) return;
    try {
      const text = await getPodLogs(cluster, params.namespace, params.name, {
        container,
        tailLines: 500,
        previous,
      });
      setLogs(text);
      setError('');
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
      setLogs((current) => current ?? '');
    }
  }, [cluster, params.namespace, params.name, container, previous]);

  useEffect(() => {
    setLogs(null);
    void load();
  }, [load]);

  // "Follow" polls the tail every 3 seconds, like the design's streaming mode.
  useEffect(() => {
    if (!follow || previous) return;
    const timer = setInterval(() => void load(), 3000);
    return () => clearInterval(timer);
  }, [follow, previous, load]);

  const lines = useMemo(() => (logs ?? '').split('\n'), [logs]);

  if (!cluster) return <EmptyState message="Cluster not found." />;

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <BackButton onPress={() => router.back()} />
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={styles.headerName} numberOfLines={1}>
            {params.name}
          </Text>
          <Text style={styles.headerSub}>
            {container ?? 'pod'} · last 500 lines{previous ? ' · previous' : ''}
          </Text>
        </View>
        <Pill
          label={previous ? 'Previous' : follow ? 'Following' : 'Paused'}
          active={!previous && follow}
          onPress={() => (previous ? setPrevious(false) : setFollow(!follow))}
        />
      </View>

      {containers.length > 1 ? (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          style={styles.chips}
          contentContainerStyle={{ gap: 7, paddingHorizontal: spacing.lg }}
        >
          {containers.map((name) => (
            <Pill key={name} label={name} active={container === name} onPress={() => setContainer(name)} />
          ))}
        </ScrollView>
      ) : null}

      {error && logs === null ? (
        <View style={{ padding: spacing.lg }}>
          <ErrorBox message={error} />
        </View>
      ) : logs === null ? (
        <Loading />
      ) : (
        <ScrollView
          ref={scrollRef}
          style={styles.logWrap}
          contentContainerStyle={styles.logContent}
          onContentSizeChange={() => {
            if (follow) scrollRef.current?.scrollToEnd({ animated: false });
          }}
        >
          {lines.length === 1 && lines[0] === '' ? (
            <Text style={styles.placeholder}>(no log output)</Text>
          ) : (
            lines.map((line, index) => {
              const tone = lineColor(line);
              return (
                <Text key={index} style={[styles.logLine, { color: tone.color }]} selectable>
                  {line || ' '}
                </Text>
              );
            })
          )}
          {follow && !previous ? <Text style={styles.cursor}>▋ streaming…</Text> : null}
        </ScrollView>
      )}

      <View style={styles.footer}>
        <TouchableOpacity onPress={() => setPrevious(!previous)}>
          <Text style={styles.footerLink}>
            {previous ? 'Show current logs' : 'Show previous logs'}
          </Text>
        </TouchableOpacity>
        <TouchableOpacity onPress={() => void load()}>
          <Text style={styles.footerLink}>Refresh</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.backgroundDeep },
  header: {
    paddingTop: 60,
    paddingHorizontal: spacing.lg,
    paddingBottom: 10,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: colors.background,
    borderBottomColor: colors.border,
    borderBottomWidth: 1,
  },
  headerName: { color: colors.text, fontSize: 13.5, fontWeight: '700' },
  headerSub: { color: 'rgba(242,245,250,0.4)', fontSize: 11 },
  chips: { flexGrow: 0, paddingVertical: 8, backgroundColor: colors.background },
  logWrap: { flex: 1 },
  logContent: { padding: 14, paddingBottom: 40 },
  logLine: { fontFamily: 'Menlo', fontSize: 10, lineHeight: 16.5 },
  placeholder: { color: colors.textFaint, fontFamily: 'Menlo', fontSize: 10.5 },
  cursor: { color: colors.link, fontFamily: 'Menlo', fontSize: 10, paddingTop: 4 },
  footer: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.xl,
    paddingTop: 10,
    paddingBottom: 40,
    borderTopColor: colors.border,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  footerLink: { color: colors.link, fontSize: 12.5, fontWeight: '600' },
});
