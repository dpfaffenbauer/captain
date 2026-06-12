import { useRouter } from 'expo-router';
import React, { useState } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { ImportedContext, parseKubeconfig } from '../src/kube/kubeconfig';
import { useClusters } from '../src/state/ClustersContext';
import { Button, ErrorBox, Field } from '../src/ui/components';
import { colors, spacing } from '../src/ui/theme';

export default function KubeconfigImportScreen() {
  const router = useRouter();
  const { addOrUpdate } = useClusters();
  const [text, setText] = useState('');
  const [error, setError] = useState('');
  const [contexts, setContexts] = useState<ImportedContext[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const handleParse = () => {
    setError('');
    try {
      const parsed = parseKubeconfig(text);
      setContexts(parsed);
      setSelected(new Set(parsed.map((entry) => entry.contextName)));
    } catch (caught) {
      setContexts([]);
      setError(caught instanceof Error ? caught.message : String(caught));
    }
  };

  const toggle = (contextName: string) => {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(contextName)) next.delete(contextName);
      else next.add(contextName);
      return next;
    });
  };

  const handleImport = async () => {
    for (const entry of contexts) {
      if (selected.has(entry.contextName)) {
        await addOrUpdate(entry.cluster);
      }
    }
    router.back();
  };

  return (
    <KeyboardAvoidingView
      style={styles.flex}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScrollView
        style={styles.flex}
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="interactive"
      >
        {error ? <ErrorBox message={error} /> : null}
        <Field
          label="Kubeconfig (YAML einfügen)"
          value={text}
          onChangeText={setText}
          placeholder="apiVersion: v1&#10;kind: Config&#10;clusters: …"
          multiline
          style={styles.editor}
        />
        <Button title="Kontexte lesen" variant="secondary" onPress={handleParse} disabled={!text.trim()} />

        {contexts.map((entry) => (
          <TouchableOpacity
            key={entry.contextName}
            style={styles.contextRow}
            onPress={() => toggle(entry.contextName)}
          >
            <View
              style={[styles.checkbox, selected.has(entry.contextName) && styles.checkboxChecked]}
            />
            <View style={styles.contextText}>
              <Text style={styles.contextName}>{entry.contextName}</Text>
              <Text style={styles.contextServer} numberOfLines={1}>
                {entry.cluster.server}
              </Text>
              {entry.warnings.map((warning) => (
                <Text key={warning} style={styles.warning}>
                  ⚠ {warning}
                </Text>
              ))}
            </View>
          </TouchableOpacity>
        ))}

        {contexts.length > 0 && (
          <View style={styles.actions}>
            <Button
              title={`${selected.size} Cluster importieren`}
              onPress={() => void handleImport()}
              disabled={selected.size === 0}
            />
          </View>
        )}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: colors.background },
  content: { padding: spacing.lg, paddingBottom: 48 },
  editor: { minHeight: 180 },
  contextRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: 8,
    padding: spacing.md,
    marginTop: spacing.sm,
  },
  checkbox: {
    width: 20,
    height: 20,
    borderRadius: 4,
    borderWidth: 1,
    borderColor: colors.border,
    marginRight: spacing.sm,
    marginTop: 2,
  },
  checkboxChecked: { backgroundColor: colors.accent, borderColor: colors.accent },
  contextText: { flex: 1 },
  contextName: { color: colors.text, fontSize: 15, fontWeight: '600' },
  contextServer: { color: colors.textDim, fontSize: 12, marginTop: 2 },
  warning: { color: colors.warning, fontSize: 12, marginTop: 4 },
  actions: { marginTop: spacing.lg },
});
