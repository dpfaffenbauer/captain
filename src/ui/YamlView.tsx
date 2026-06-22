import React, { useMemo } from 'react';
import { StyleSheet, Text, View } from './rn';
import { colors } from './theme';

/** Simple line-based YAML syntax coloring like the design's viewer. */
export function YamlView({ text }: { text: string }) {
  const lines = useMemo(() => text.split('\n'), [text]);
  return (
    <View>
      {lines.map((line, index) => {
        const match = /^(\s*-?\s*[^:]+:)(.*)$/.exec(line);
        if (!match) {
          return (
            <Text key={index} style={styles.yamlValue}>
              {line || ' '}
            </Text>
          );
        }
        const value = match[2];
        const valueColor = /^\s*-?[0-9.]+\s*$/.test(value)
          ? colors.monoNumber
          : value.trim()
            ? colors.monoString
            : colors.textFaint;
        return (
          <Text key={index} style={styles.yamlLine}>
            <Text style={styles.yamlKey}>{match[1]}</Text>
            <Text style={[styles.yamlValue, { color: valueColor }]}>{value}</Text>
          </Text>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  yamlLine: { fontFamily: 'Menlo', fontSize: 10.5, lineHeight: 18 },
  yamlKey: { color: colors.monoKey, fontFamily: 'Menlo', fontSize: 10.5 },
  yamlValue: { color: colors.mono, fontFamily: 'Menlo', fontSize: 10.5, lineHeight: 18 },
});
