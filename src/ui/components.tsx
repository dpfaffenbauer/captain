import React from 'react';
import {
  ActivityIndicator,
  StyleSheet,
  TextInputProps,
  TouchableOpacity,
  View,
} from 'react-native';
import { Text, TextInput } from './Text';
import { colors, spacing } from './theme';

export function Field({
  label,
  ...inputProps
}: TextInputProps & { label: string }) {
  return (
    <View style={styles.fieldContainer}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <TextInput
        placeholderTextColor={colors.textDim}
        autoCapitalize="none"
        autoCorrect={false}
        {...inputProps}
        style={[styles.fieldInput, inputProps.multiline && styles.fieldInputMultiline, inputProps.style]}
      />
    </View>
  );
}

export function Button({
  title,
  onPress,
  variant = 'primary',
  disabled,
  busy,
}: {
  title: string;
  onPress: () => void;
  variant?: 'primary' | 'secondary' | 'danger';
  disabled?: boolean;
  busy?: boolean;
}) {
  return (
    <TouchableOpacity
      onPress={onPress}
      disabled={disabled || busy}
      style={[
        styles.button,
        variant === 'secondary' && styles.buttonSecondary,
        variant === 'danger' && styles.buttonDanger,
        (disabled || busy) && styles.buttonDisabled,
      ]}
    >
      {busy ? (
        <ActivityIndicator color={colors.accentText} />
      ) : (
        <Text style={[styles.buttonText, variant === 'secondary' && styles.buttonTextSecondary]}>
          {title}
        </Text>
      )}
    </TouchableOpacity>
  );
}

export function ErrorBox({ message }: { message: string }) {
  return (
    <View style={styles.errorBox}>
      <Text style={styles.errorText}>{message}</Text>
    </View>
  );
}

export function EmptyState({ message }: { message: string }) {
  return (
    <View style={styles.emptyState}>
      <Text style={styles.emptyText}>{message}</Text>
    </View>
  );
}

export function Loading() {
  return (
    <View style={styles.emptyState}>
      <ActivityIndicator color={colors.accent} size="large" />
    </View>
  );
}

const styles = StyleSheet.create({
  fieldContainer: {
    marginBottom: spacing.md,
  },
  fieldLabel: {
    color: colors.textDim,
    fontSize: 13,
    marginBottom: spacing.xs,
  },
  fieldInput: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: 8,
    color: colors.text,
    paddingHorizontal: spacing.md,
    paddingVertical: 10,
    fontSize: 15,
  },
  fieldInputMultiline: {
    minHeight: 120,
    textAlignVertical: 'top',
    fontFamily: 'Menlo',
    fontSize: 12,
  },
  button: {
    backgroundColor: colors.accent,
    borderRadius: 8,
    paddingVertical: 12,
    alignItems: 'center',
    marginBottom: spacing.sm,
  },
  buttonSecondary: {
    backgroundColor: colors.surfaceAlt,
    borderWidth: 1,
    borderColor: colors.border,
  },
  buttonDanger: {
    backgroundColor: colors.danger,
  },
  buttonDisabled: {
    opacity: 0.5,
  },
  buttonText: {
    color: colors.accentText,
    fontWeight: '600',
    fontSize: 15,
  },
  buttonTextSecondary: {
    color: colors.text,
  },
  errorBox: {
    backgroundColor: '#3d1418',
    borderColor: colors.danger,
    borderWidth: 1,
    borderRadius: 8,
    padding: spacing.md,
    marginBottom: spacing.md,
  },
  errorText: {
    color: '#fca5a5',
    fontSize: 13,
  },
  emptyState: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.xl,
  },
  emptyText: {
    color: colors.textDim,
    fontSize: 15,
    textAlign: 'center',
  },
});
