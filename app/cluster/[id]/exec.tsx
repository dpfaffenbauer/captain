import { useLocalSearchParams, useRouter } from 'expo-router';
import React, { useMemo, useRef, useState } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { execCommand } from '../../../src/kube/exec';
import { useClusters } from '../../../src/state/ClustersContext';
import { BackButton, Pill } from '../../../src/ui/kit';
import { EmptyState } from '../../../src/ui/components';
import { colors, radius, spacing } from '../../../src/ui/theme';

interface TermLine {
  kind: 'cmd' | 'out' | 'err';
  text: string;
}

const QUICK_COMMANDS = ['ls', 'env', 'ps aux', 'cat /etc/resolv.conf', 'nslookup kubernetes'];

export default function ExecScreen() {
  const params = useLocalSearchParams<{
    id: string;
    namespace: string;
    name: string;
    container: string;
  }>();
  const router = useRouter();
  const { getById } = useClusters();
  const cluster = getById(params.id);

  const [lines, setLines] = useState<TermLine[]>([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const scrollRef = useRef<ScrollView>(null);

  const container = useMemo(() => params.container || undefined, [params.container]);

  const run = async (commandRaw: string) => {
    const command = commandRaw.trim();
    if (!command || busy || !cluster) return;
    setBusy(true);
    setInput('');
    setLines((current) => [...current, { kind: 'cmd', text: command }]);
    try {
      const result = await execCommand(
        cluster,
        params.namespace ?? '',
        params.name ?? '',
        container,
        command
      );
      setLines((current) => {
        const next = [...current];
        if (result.output) next.push({ kind: 'out', text: result.output });
        if (result.failure) next.push({ kind: 'err', text: `(${result.failure})` });
        if (!result.output && !result.failure) next.push({ kind: 'out', text: '(no output)' });
        return next.slice(-200);
      });
    } catch (caught) {
      setLines((current) => [
        ...current,
        { kind: 'err', text: caught instanceof Error ? caught.message : String(caught) },
      ]);
    } finally {
      setBusy(false);
    }
  };

  if (!cluster) return <EmptyState message="Cluster not found." />;

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <View style={styles.header}>
        <BackButton onPress={() => router.back()} />
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={styles.headerName} numberOfLines={1}>
            {params.name}
          </Text>
          <Text style={styles.headerSub}>
            {container ?? 'pod'} · /bin/sh
          </Text>
        </View>
        <View style={styles.connectedPill}>
          <Text style={styles.connectedText}>{busy ? 'Running…' : 'Ready'}</Text>
        </View>
      </View>

      <ScrollView
        ref={scrollRef}
        style={styles.terminal}
        contentContainerStyle={styles.terminalContent}
        onContentSizeChange={() => scrollRef.current?.scrollToEnd({ animated: false })}
        keyboardShouldPersistTaps="handled"
      >
        {lines.length === 0 ? (
          <Text style={styles.placeholder}>
            Shell ready. Each command runs as a fresh `/bin/sh -c` in the container. Type below or
            tap a suggestion.
          </Text>
        ) : (
          lines.map((line, index) => (
            <Text
              key={index}
              style={[
                styles.line,
                line.kind === 'cmd' && styles.lineCmd,
                line.kind === 'err' && styles.lineErr,
              ]}
              selectable
            >
              {line.kind === 'cmd' ? `$ ${line.text}` : line.text}
            </Text>
          ))
        )}
      </ScrollView>

      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={styles.chips}
        contentContainerStyle={{ gap: 7, paddingHorizontal: spacing.lg }}
        keyboardShouldPersistTaps="handled"
      >
        {QUICK_COMMANDS.map((command) => (
          <Pill key={command} label={command} onPress={() => void run(command)} />
        ))}
      </ScrollView>

      <View style={styles.inputRow}>
        <Text style={styles.prompt}>$</Text>
        <TextInput
          style={styles.input}
          value={input}
          onChangeText={setInput}
          onSubmitEditing={() => void run(input)}
          placeholder="command…"
          placeholderTextColor={colors.textFaint}
          autoCapitalize="none"
          autoCorrect={false}
          editable={!busy}
        />
        <TouchableOpacity
          style={[styles.runButton, busy && { opacity: 0.5 }]}
          onPress={() => void run(input)}
          disabled={busy}
        >
          <Text style={styles.runText}>Run</Text>
        </TouchableOpacity>
      </View>
    </KeyboardAvoidingView>
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
  connectedPill: {
    backgroundColor: 'rgba(52,211,153,0.18)',
    borderRadius: radius.pill,
    paddingHorizontal: 11,
    paddingVertical: 5,
  },
  connectedText: { color: colors.success, fontSize: 11, fontWeight: '700' },
  terminal: { flex: 1 },
  terminalContent: { padding: spacing.lg, gap: 2 },
  placeholder: {
    color: 'rgba(242,245,250,0.3)',
    fontFamily: 'Menlo',
    fontSize: 10.5,
    lineHeight: 17,
  },
  line: { color: 'rgba(242,245,250,0.8)', fontFamily: 'Menlo', fontSize: 11, lineHeight: 18 },
  lineCmd: { color: colors.link },
  lineErr: { color: colors.dangerLight },
  chips: { flexGrow: 0, paddingVertical: 8 },
  inputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: spacing.lg,
    paddingTop: 8,
    paddingBottom: 52,
    borderTopColor: colors.borderFaint,
    borderTopWidth: 1,
  },
  prompt: { color: colors.link, fontFamily: 'Menlo', fontSize: 12, fontWeight: '700' },
  input: {
    flex: 1,
    backgroundColor: 'rgba(255,255,255,0.07)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.12)',
    borderRadius: 12,
    paddingHorizontal: 13,
    paddingVertical: 10,
    color: colors.text,
    fontSize: 12,
    fontFamily: 'Menlo',
  },
  runButton: {
    backgroundColor: colors.accentSoft,
    borderRadius: 12,
    paddingHorizontal: 15,
    paddingVertical: 10,
  },
  runText: { color: '#fff', fontSize: 12, fontWeight: '700' },
});
