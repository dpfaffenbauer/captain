import React from 'react';
import { ActivityIndicator, StyleSheet, Text, TouchableOpacity, View } from './rn';
import Svg, { Circle, Path, Rect } from 'react-native-svg';
import { AuthType } from '../types';
import { colors, radius, spacing } from './theme';

/**
 * Brand marks for the sign-in UI, drawn as inline SVG so we don't pull in an
 * icon dependency. Google and Microsoft follow their official multicolor
 * logos; AWS uses the smile mark; OIDC/SSO and the credential types get a
 * tinted key/badge glyph.
 */
export function BrandLogo({ provider, size = 22 }: { provider: AuthType; size?: number }) {
  switch (provider) {
    case 'gke':
      // Official Google "G", four-color.
      return (
        <Svg width={size} height={size} viewBox="0 0 48 48">
          <Path
            fill="#FFC107"
            d="M43.611 20.083H42V20H24v8h11.303c-1.649 4.657-6.08 8-11.303 8-6.627 0-12-5.373-12-12s5.373-12 12-12c3.059 0 5.842 1.154 7.961 3.039l5.657-5.657C34.046 6.053 29.268 4 24 4 12.955 4 4 12.955 4 24s8.955 20 20 20 20-8.955 20-20c0-1.341-.138-2.65-.389-3.917z"
          />
          <Path
            fill="#FF3D00"
            d="M6.306 14.691l6.571 4.819C14.655 15.108 18.961 12 24 12c3.059 0 5.842 1.154 7.961 3.039l5.657-5.657C34.046 6.053 29.268 4 24 4 16.318 4 9.656 8.337 6.306 14.691z"
          />
          <Path
            fill="#4CAF50"
            d="M24 44c5.166 0 9.86-1.977 13.409-5.192l-6.19-5.238C29.211 35.091 26.715 36 24 36c-5.202 0-9.619-3.317-11.283-7.946l-6.522 5.025C9.505 39.556 16.227 44 24 44z"
          />
          <Path
            fill="#1976D2"
            d="M43.611 20.083H42V20H24v8h11.303c-.792 2.237-2.231 4.166-4.087 5.571l.003-.002 6.19 5.238C36.971 39.205 44 34 44 24c0-1.341-.138-2.65-.389-3.917z"
          />
        </Svg>
      );
    case 'aks':
      // Official Microsoft four squares.
      return (
        <Svg width={size} height={size} viewBox="0 0 23 23">
          <Rect x={1} y={1} width={10} height={10} fill="#F25022" />
          <Rect x={12} y={1} width={10} height={10} fill="#7FBA00" />
          <Rect x={1} y={12} width={10} height={10} fill="#00A4EF" />
          <Rect x={12} y={12} width={10} height={10} fill="#FFB900" />
        </Svg>
      );
    case 'eks':
      // AWS smile mark.
      return (
        <Svg width={size} height={size} viewBox="0 0 24 24">
          <Path
            d="M3 14c5 3.6 13 3.6 18 0"
            stroke="#FF9900"
            strokeWidth={2.4}
            strokeLinecap="round"
            fill="none"
          />
          <Path d="M18 11.4l3.2.6-1.7 2.8z" fill="#FF9900" />
          <Path
            d="M5 7.5h2l1.3 3.4L9.6 7.5h1.8l1.3 3.4L14 7.5h2l-2.4 5.6h-1.7l-1.3-3.3-1.3 3.3H7.6z"
            fill={colors.text}
          />
        </Svg>
      );
    case 'oidc':
      // OpenID-style ring + key.
      return (
        <Svg width={size} height={size} viewBox="0 0 24 24">
          <Circle cx={12} cy={9} r={4.2} stroke={colors.accent} strokeWidth={2} fill="none" />
          <Path
            d="M12 13.2V21M9.4 17h3.2M9.4 19.4h3.2"
            stroke={colors.accent}
            strokeWidth={2}
            strokeLinecap="round"
          />
        </Svg>
      );
    case 'token':
      return (
        <Svg width={size} height={size} viewBox="0 0 24 24">
          <Circle cx={8} cy={12} r={4} stroke={colors.link} strokeWidth={2} fill="none" />
          <Path
            d="M11.5 12H21M18 12v3M15 12v2"
            stroke={colors.link}
            strokeWidth={2}
            strokeLinecap="round"
          />
        </Svg>
      );
    case 'clientCert':
    default:
      return (
        <Svg width={size} height={size} viewBox="0 0 24 24">
          <Rect x={3} y={4} width={18} height={12} rx={2} stroke={colors.success} strokeWidth={2} fill="none" />
          <Path d="M7 8h6M7 11h4" stroke={colors.success} strokeWidth={2} strokeLinecap="round" />
          <Circle cx={16} cy={18} r={3} stroke={colors.success} strokeWidth={2} fill="none" />
          <Path d="M14.5 20.5L13 23M17.5 20.5L19 23" stroke={colors.success} strokeWidth={2} strokeLinecap="round" />
        </Svg>
      );
  }
}

/** Selectable provider card: brand logo + name + one-line hint. */
export function ProviderTile({
  provider,
  title,
  subtitle,
  active,
  onPress,
}: {
  provider: AuthType;
  title: string;
  subtitle: string;
  active: boolean;
  onPress: () => void;
}) {
  return (
    <TouchableOpacity
      style={[styles.tile, active && styles.tileActive]}
      onPress={onPress}
      activeOpacity={0.8}
    >
      <View style={styles.tileLogo}>
        <BrandLogo provider={provider} size={24} />
      </View>
      <View style={styles.tileText}>
        <Text style={[styles.tileTitle, active && styles.tileTitleActive]} numberOfLines={1}>
          {title}
        </Text>
        <Text style={styles.tileSubtitle} numberOfLines={1}>
          {subtitle}
        </Text>
      </View>
    </TouchableOpacity>
  );
}

/**
 * Branded "Sign in with …" button. Google and Microsoft render on a light
 * surface per their brand guidelines; everything else uses the dark accent
 * surface with the provider's tinted logo.
 */
export function SignInButton({
  provider,
  title,
  onPress,
  busy,
  disabled,
  connected,
}: {
  provider: AuthType;
  title: string;
  onPress: () => void;
  busy?: boolean;
  disabled?: boolean;
  connected?: boolean;
}) {
  const light = provider === 'gke' || provider === 'aks';
  return (
    <TouchableOpacity
      onPress={onPress}
      disabled={disabled || busy}
      activeOpacity={0.85}
      style={[
        styles.signIn,
        light ? styles.signInLight : styles.signInDark,
        connected && !light && styles.signInConnected,
        (disabled || busy) && styles.signInDisabled,
      ]}
    >
      {busy ? (
        <ActivityIndicator color={light ? '#1F1F1F' : colors.text} />
      ) : (
        <>
          <BrandLogo provider={provider} size={20} />
          <Text style={[styles.signInText, light && styles.signInTextLight]}>{title}</Text>
        </>
      )}
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  tile: {
    flexBasis: '48%',
    flexGrow: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: radius.row,
    paddingHorizontal: spacing.md,
    paddingVertical: 10,
  },
  tileActive: {
    borderColor: colors.accent,
    backgroundColor: 'rgba(91,124,255,0.12)',
  },
  tileLogo: {
    width: 30,
    height: 30,
    borderRadius: 9,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.backgroundDeep,
  },
  tileText: { flex: 1 },
  tileTitle: { color: colors.textMid, fontSize: 14, fontWeight: '600' },
  tileTitleActive: { color: colors.text },
  tileSubtitle: { color: colors.textDim, fontSize: 11, marginTop: 1 },
  signIn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    borderRadius: 10,
    paddingVertical: 13,
    marginBottom: spacing.sm,
  },
  signInLight: { backgroundColor: '#FFFFFF' },
  signInDark: {
    backgroundColor: colors.surfaceAlt,
    borderWidth: 1,
    borderColor: colors.border,
  },
  signInConnected: { borderColor: colors.success },
  signInDisabled: { opacity: 0.5 },
  signInText: { color: colors.text, fontSize: 15, fontWeight: '600' },
  signInTextLight: { color: '#1F1F1F' },
});
