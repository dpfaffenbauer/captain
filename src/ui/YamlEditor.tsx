import React, { useMemo } from 'react';
import { ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { colors, spacing } from './theme';

/**
 * Editable YAML field with live syntax highlighting.
 *
 * React Native has no DOM, so we can't use a web code editor (Monaco/CodeMirror).
 * Instead we use the overlay technique: a transparent <TextInput> sits exactly on
 * top of a syntax-colored <Text> layer. Both share identical font metrics so the
 * (invisible) typed glyphs line up pixel-for-pixel with the colored copy behind
 * them. The caret stays visible via `selectionColor`. A non-scrolling TextInput
 * inside a shared ScrollView keeps both layers in sync while scrolling.
 */
export function YamlEditor({
  value,
  onChangeText,
}: {
  value: string;
  onChangeText: (text: string) => void;
}) {
  const lines = useMemo(() => value.split('\n'), [value]);
  return (
    <ScrollView
      style={styles.scroll}
      contentContainerStyle={styles.content}
      keyboardShouldPersistTaps="handled"
    >
      <View style={styles.stack}>
        <View style={styles.highlight} pointerEvents="none">
          {lines.map((line, index) => (
            <HighlightedLine key={index} line={line} />
          ))}
        </View>
        <TextInput
          style={styles.input}
          value={value}
          onChangeText={onChangeText}
          multiline
          scrollEnabled={false}
          autoCapitalize="none"
          autoCorrect={false}
          autoComplete="off"
          spellCheck={false}
          selectionColor={colors.accent}
          keyboardAppearance="dark"
        />
      </View>
    </ScrollView>
  );
}

/** Token-colors a single YAML line: comments, list markers, keys and scalar values. */
function HighlightedLine({ line }: { line: string }) {
  // Render an empty line as a space so the line still occupies a row.
  if (line.length === 0) {
    return <Text style={styles.line}> </Text>;
  }

  const indentMatch = /^(\s*)/.exec(line);
  const indent = indentMatch ? indentMatch[1] : '';
  let rest = line.slice(indent.length);

  // Whole-line comment.
  if (rest.startsWith('#')) {
    return (
      <Text style={styles.line}>
        {indent}
        <Text style={styles.comment}>{rest}</Text>
      </Text>
    );
  }

  // Optional list marker(s): "- " possibly repeated ("- - item").
  let bullets = '';
  const bulletMatch = /^((?:- )+|-$)/.exec(rest);
  if (bulletMatch) {
    bullets = bulletMatch[0];
    rest = rest.slice(bullets.length);
  }

  // "key: value" — only treat as a mapping when the colon is followed by a
  // space or end-of-line (avoids splitting URLs / times inside scalar values).
  const keyMatch = /^([^:\s][^:]*?):(\s|$)(.*)$/.exec(rest);
  if (keyMatch) {
    const key = keyMatch[1];
    const sep = keyMatch[2];
    const value = keyMatch[3];
    return (
      <Text style={styles.line}>
        {indent}
        {bullets ? <Text style={styles.bullet}>{bullets}</Text> : null}
        <Text style={styles.key}>{key}</Text>
        <Text style={styles.value}>:{sep}</Text>
        {renderScalar(value)}
      </Text>
    );
  }

  // No key — the remainder is a bare scalar (list item value, block content).
  return (
    <Text style={styles.line}>
      {indent}
      {bullets ? <Text style={styles.bullet}>{bullets}</Text> : null}
      {renderScalar(rest)}
    </Text>
  );
}

/** Colors a scalar value, splitting off a trailing inline comment. */
function renderScalar(raw: string) {
  if (raw.length === 0) {
    return null;
  }
  // Split off an inline comment that is preceded by whitespace.
  const commentMatch = /(\s+#.*)$/.exec(raw);
  const text = commentMatch ? raw.slice(0, commentMatch.index) : raw;
  const comment = commentMatch ? commentMatch[1] : '';
  return (
    <>
      <Text style={scalarStyle(text)}>{text}</Text>
      {comment ? <Text style={styles.comment}>{comment}</Text> : null}
    </>
  );
}

function scalarStyle(text: string) {
  const trimmed = text.trim();
  if (trimmed === '') {
    return styles.value;
  }
  if (/^-?\d+(\.\d+)?$/.test(trimmed)) {
    return styles.number;
  }
  if (/^(true|false|null|~|yes|no|on|off)$/i.test(trimmed)) {
    return styles.keyword;
  }
  if (/^["'].*["']$/.test(trimmed) || /^[|>][-+]?$/.test(trimmed)) {
    return styles.string;
  }
  return styles.value;
}

const FONT_SIZE = 12;
const LINE_HEIGHT = 18;
const base = {
  fontFamily: 'Menlo',
  fontSize: FONT_SIZE,
  lineHeight: LINE_HEIGHT,
} as const;

const styles = StyleSheet.create({
  scroll: { flex: 1, backgroundColor: colors.backgroundDeep },
  content: { padding: spacing.lg, minHeight: '100%' },
  stack: { position: 'relative', flexGrow: 1 },
  highlight: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 },
  input: {
    ...base,
    color: 'transparent',
    padding: 0,
    margin: 0,
    textAlignVertical: 'top',
    minHeight: 200,
  },
  line: { ...base, color: colors.mono },
  key: { ...base, color: colors.monoKey },
  value: { ...base, color: colors.mono },
  string: { ...base, color: colors.monoString },
  number: { ...base, color: colors.monoNumber },
  keyword: { ...base, color: colors.warning },
  bullet: { ...base, color: colors.textDim },
  comment: { ...base, color: colors.textFaint, fontStyle: 'italic' },
});
