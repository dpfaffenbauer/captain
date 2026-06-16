import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ScrollView, Share, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { getPodLogs, streamPodLogs } from '../kube/client';
import { isStreamingAvailable, KubeStreamHandle } from '../kube/stream';
import { ClusterConfig } from '../types';
import { BackButton, CloseButton, Pill } from './kit';
import { EmptyState, ErrorBox, Loading } from './components';
import { colors, spacing } from './theme';

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

/** Bound memory: keep only the newest lines when a stream runs for long. */
const MAX_LINES = 3000;

function capLines(text: string): string {
  const lines = text.split('\n');
  if (lines.length <= MAX_LINES) return text;
  return lines.slice(lines.length - MAX_LINES).join('\n');
}

export interface LogsViewProps {
  cluster: ClusterConfig;
  namespace: string;
  name: string;
  containers: string[];
  previous?: boolean;
  mode: 'screen' | 'pane';
  onClose: () => void;
  onBack?: () => void;
}

export function LogsView({
  cluster,
  namespace,
  name,
  containers,
  previous: previousInitial,
  mode,
  onClose,
  onBack,
}: LogsViewProps) {
  const [container, setContainer] = useState<string | undefined>(containers[0]);
  const [previous, setPrevious] = useState(previousInitial === true);
  const [follow, setFollow] = useState(true);
  const [logs, setLogs] = useState<string | null>(null);
  const [streamEnded, setStreamEnded] = useState(false);
  const [search, setSearch] = useState('');
  const [error, setError] = useState('');
  const scrollRef = useRef<ScrollView>(null);
  const streamRef = useRef<KubeStreamHandle | null>(null);

  const canStream = isStreamingAvailable();

  const load = useCallback(async () => {
    if (!cluster || !namespace || !name) return;
    try {
      const text = await getPodLogs(cluster, namespace, name, {
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
  }, [cluster, namespace, name, container, previous]);

  // Live mode: a real `follow=true` stream over the native transport.
  useEffect(() => {
    if (!follow || previous || !canStream) return;
    if (!cluster || !namespace || !name) return;
    let cancelled = false;
    setLogs(null);
    setStreamEnded(false);
    setError('');
    streamPodLogs(
      cluster,
      namespace,
      name,
      { container, tailLines: 500 },
      {
        onChunk: (chunk) => {
          if (cancelled) return;
          setLogs((current) => capLines((current ?? '') + chunk));
        },
        onEnd: (failure) => {
          if (cancelled) return;
          setStreamEnded(true);
          setLogs((current) => current ?? '');
          if (failure) setError(failure);
        },
      }
    )
      .then((handle) => {
        if (cancelled) {
          handle.stop();
          return;
        }
        streamRef.current = handle;
      })
      .catch((caught) => {
        if (cancelled) return;
        setError(caught instanceof Error ? caught.message : String(caught));
        setLogs((current) => current ?? '');
      });
    return () => {
      cancelled = true;
      streamRef.current?.stop();
      streamRef.current = null;
    };
  }, [follow, previous, canStream, cluster, namespace, name, container]);

  // Static modes: previous logs, paused, or Expo Go (no native streaming).
  useEffect(() => {
    if (follow && !previous && canStream) return;
    setLogs(null);
    void load();
  }, [follow, previous, canStream, load]);

  // Without native streaming, "follow" falls back to polling the tail.
  useEffect(() => {
    if (canStream || !follow || previous) return;
    const timer = setInterval(() => void load(), 3000);
    return () => clearInterval(timer);
  }, [canStream, follow, previous, load]);

  const lines = useMemo(() => (logs ?? '').split('\n'), [logs]);
  const query = search.trim().toLowerCase();
  const visibleLines = useMemo(
    () => (query ? lines.filter((line) => line.toLowerCase().includes(query)) : lines),
    [lines, query]
  );

  const handleShare = () => {
    if (!logs) return;
    void Share.share({
      message: logs,
      title: `${name}${container ? ` · ${container}` : ''} logs`,
    });
  };

  if (!cluster) return <EmptyState message="Cluster not found." />;

  const streaming = canStream && follow && !previous && !streamEnded;

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
          <Text style={styles.headerSub}>
            {container ?? 'pod'}
            {previous ? ' · previous' : streaming ? ' · live' : ' · last 500 lines'}
          </Text>
        </View>
        <Pill
          label={previous ? 'Previous' : follow ? (streaming ? 'Live' : 'Following') : 'Paused'}
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
          {containers.map((entry) => (
            <Pill key={entry} label={entry} active={container === entry} onPress={() => setContainer(entry)} />
          ))}
        </ScrollView>
      ) : null}

      <View style={styles.searchRow}>
        <TextInput
          style={styles.search}
          value={search}
          onChangeText={setSearch}
          placeholder="Search in logs"
          placeholderTextColor={colors.textFaint}
          autoCapitalize="none"
          autoCorrect={false}
        />
        {query ? (
          <Text style={styles.searchMeta}>
            {visibleLines.length} {visibleLines.length === 1 ? 'match' : 'matches'}
          </Text>
        ) : null}
      </View>

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
            if (follow && !query) scrollRef.current?.scrollToEnd({ animated: false });
          }}
        >
          {error ? <ErrorBox message={error} /> : null}
          {visibleLines.length === 1 && visibleLines[0] === '' ? (
            <Text style={styles.placeholder}>
              {query ? '(no matching lines)' : '(no log output)'}
            </Text>
          ) : (
            visibleLines.map((line, index) => {
              const tone = lineColor(line);
              return (
                <Text key={index} style={[styles.logLine, { color: tone.color }]} selectable>
                  {line || ' '}
                </Text>
              );
            })
          )}
          {streaming ? <Text style={styles.cursor}>▋ streaming…</Text> : null}
          {streamEnded && !error ? <Text style={styles.placeholder}>— stream ended —</Text> : null}
        </ScrollView>
      )}

      <View style={[styles.footer, mode === 'pane' && styles.footerPane]}>
        <TouchableOpacity onPress={() => setPrevious(!previous)}>
          <Text style={styles.footerLink}>
            {previous ? 'Show current logs' : 'Show previous logs'}
          </Text>
        </TouchableOpacity>
        <TouchableOpacity onPress={handleShare} disabled={!logs}>
          <Text style={[styles.footerLink, !logs && { opacity: 0.4 }]}>Share</Text>
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
  headerPane: { paddingTop: 16 },
  headerName: { color: colors.text, fontSize: 13.5, fontWeight: '700' },
  headerSub: { color: 'rgba(242,245,250,0.4)', fontSize: 11 },
  chips: { flexGrow: 0, paddingVertical: 8, backgroundColor: colors.background },
  searchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: colors.background,
    paddingHorizontal: spacing.lg,
    paddingBottom: 9,
  },
  search: {
    flex: 1,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 11,
    paddingHorizontal: 12,
    paddingVertical: 7,
    color: colors.text,
    fontSize: 13,
  },
  searchMeta: { color: colors.textFaint, fontSize: 11 },
  logWrap: { flex: 1 },
  logContent: { padding: 14, paddingBottom: 40 },
  logLine: { fontFamily: 'Menlo', fontSize: 10, lineHeight: 16.5 },
  placeholder: { color: colors.textFaint, fontFamily: 'Menlo', fontSize: 10.5, paddingTop: 4 },
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
  footerPane: { paddingBottom: 16 },
  footerLink: { color: colors.link, fontSize: 12.5, fontWeight: '600' },
});
