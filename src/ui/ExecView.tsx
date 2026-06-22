import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from './rn';
import { execCommand, ShellSession, startShellSession } from '../kube/exec';
import { ClusterConfig } from '../types';
import { BackButton, CloseButton, Pill } from './kit';
import { EmptyState } from './components';
import { colors, radius, spacing } from './theme';

interface TermLine {
  kind: 'cmd' | 'out' | 'err';
  text: string;
}

const QUICK_COMMANDS = ['ls', 'env', 'ps aux', 'cat /etc/resolv.conf', 'nslookup kubernetes'];

/** Strips ANSI escape sequences and carriage returns from PTY output. */
function stripAnsi(text: string): string {
  return text
    // eslint-disable-next-line no-control-regex
    .replace(/\x1b\[[0-9;?]*[a-zA-Z]/g, '')
    // eslint-disable-next-line no-control-regex
    .replace(/\x1b\][^\x07\x1b]*(\x07|\x1b\\)/g, '')
    // eslint-disable-next-line no-control-regex
    .replace(/\x1b[=>]/g, '')
    .replace(/\r/g, '');
}

const MAX_TERM_CHARS = 60_000;

export interface ExecViewProps {
  cluster: ClusterConfig;
  namespace: string;
  name: string;
  container?: string;
  mode: 'screen' | 'pane';
  onClose: () => void;
  onBack?: () => void;
}

export function ExecView({ cluster, namespace, name, container: containerParam, mode, onClose, onBack }: ExecViewProps) {
  const [lines, setLines] = useState<TermLine[]>([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const scrollRef = useRef<ScrollView>(null);

  // Interactive PTY mode: one persistent `kubectl exec -it`-style session.
  const [interactive, setInteractive] = useState(false);
  const [term, setTerm] = useState('');
  const [shellState, setShellState] = useState<'connecting' | 'open' | 'closed'>('closed');
  const [shellError, setShellError] = useState('');
  const shellRef = useRef<ShellSession | null>(null);

  const container = useMemo(() => containerParam || undefined, [containerParam]);

  useEffect(() => {
    if (!interactive || !cluster) return;
    let cancelled = false;
    setTerm('');
    setShellError('');
    setShellState('connecting');
    startShellSession(cluster, namespace ?? '', name ?? '', container, {
      onOutput: (text) => {
        if (cancelled) return;
        setShellState('open');
        setTerm((current) => {
          const next = current + stripAnsi(text);
          return next.length > MAX_TERM_CHARS ? next.slice(next.length - MAX_TERM_CHARS) : next;
        });
      },
      onClosed: (failure) => {
        if (cancelled) return;
        setShellState('closed');
        if (failure) setShellError(failure);
      },
    })
      .then((session) => {
        if (cancelled) {
          session.stop();
          return;
        }
        shellRef.current = session;
        setShellState('open');
      })
      .catch((caught) => {
        if (cancelled) return;
        setShellState('closed');
        setShellError(caught instanceof Error ? caught.message : String(caught));
      });
    return () => {
      cancelled = true;
      shellRef.current?.stop();
      shellRef.current = null;
      setShellState('closed');
    };
  }, [interactive, cluster, namespace, name, container]);

  const sendInteractive = (raw: string) => {
    if (!shellRef.current || shellState !== 'open') return;
    shellRef.current.sendLine(raw);
    setInput('');
  };

  const run = async (commandRaw: string) => {
    const command = commandRaw.trim();
    if (!command || busy || !cluster) return;
    setBusy(true);
    setInput('');
    setLines((current) => [...current, { kind: 'cmd', text: command }]);
    try {
      const result = await execCommand(cluster, namespace ?? '', name ?? '', container, command);
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

  const content = (
    <>
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
            {container ?? 'pod'} · /bin/sh{interactive ? ' -it' : ''}
          </Text>
        </View>
        <Pill
          label={interactive ? 'Interactive' : 'One-shot'}
          active={interactive}
          onPress={() => setInteractive(!interactive)}
        />
        <View style={styles.connectedPill}>
          <Text
            style={[
              styles.connectedText,
              interactive && shellState === 'closed' && { color: colors.dangerLight },
            ]}
          >
            {interactive
              ? shellState === 'open'
                ? 'Connected'
                : shellState === 'connecting'
                  ? 'Connecting…'
                  : 'Closed'
              : busy
                ? 'Running…'
                : 'Ready'}
          </Text>
        </View>
      </View>

      <ScrollView
        ref={scrollRef}
        style={styles.terminal}
        contentContainerStyle={styles.terminalContent}
        onContentSizeChange={() => scrollRef.current?.scrollToEnd({ animated: false })}
        keyboardShouldPersistTaps="handled"
      >
        {interactive ? (
          <>
            {shellError ? <Text style={[styles.line, styles.lineErr]}>{shellError}</Text> : null}
            <Text style={styles.line} selectable>
              {term ||
                (shellState === 'connecting'
                  ? 'Connecting to /bin/sh…'
                  : shellState === 'closed'
                    ? '— session closed —'
                    : ' ')}
            </Text>
            {shellState === 'closed' && term ? (
              <Text style={styles.placeholder}>— session closed —</Text>
            ) : null}
          </>
        ) : lines.length === 0 ? (
          <Text style={styles.placeholder}>
            Shell ready. Each command runs as a fresh `/bin/sh -c` in the container. Type below or
            tap a suggestion — or switch to Interactive for a persistent PTY session.
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
          <Pill
            key={command}
            label={command}
            onPress={() => (interactive ? sendInteractive(command) : void run(command))}
          />
        ))}
      </ScrollView>

      <View style={[styles.inputRow, mode === 'pane' && styles.inputRowPane]}>
        <Text style={styles.prompt}>$</Text>
        <TextInput
          style={styles.input}
          value={input}
          onChangeText={setInput}
          onSubmitEditing={() => (interactive ? sendInteractive(input) : void run(input))}
          blurOnSubmit={false}
          placeholder="command…"
          placeholderTextColor={colors.textFaint}
          autoCapitalize="none"
          autoCorrect={false}
          editable={interactive ? shellState === 'open' : !busy}
        />
        <TouchableOpacity
          style={[styles.runButton, (interactive ? shellState !== 'open' : busy) && { opacity: 0.5 }]}
          onPress={() => (interactive ? sendInteractive(input) : void run(input))}
          disabled={interactive ? shellState !== 'open' : busy}
        >
          <Text style={styles.runText}>{interactive ? 'Send' : 'Run'}</Text>
        </TouchableOpacity>
      </View>
    </>
  );

  if (mode === 'pane') {
    return <View style={styles.container}>{content}</View>;
  }
  return (
    <KeyboardAvoidingView style={styles.container} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      {content}
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
  headerPane: { paddingTop: 16 },
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
  inputRowPane: { paddingBottom: 16 },
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
