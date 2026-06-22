import {
  LinearGradient } from 'expo-linear-gradient';
import React from 'react';
import {
  Modal,
  StyleSheet,
  TouchableOpacity,
  View,
  ViewStyle,
} from 'react-native';
import { Text } from './Text';
import Svg, { Circle, Path } from 'react-native-svg';
import { cardGradient, colors, radius, spacing } from './theme';

/** Card with the soft top-to-bottom gradient used everywhere in the design. */
export function Card({
  children,
  style,
  borderColor,
}: {
  children: React.ReactNode;
  style?: ViewStyle;
  borderColor?: string;
}) {
  return (
    <LinearGradient
      colors={[...cardGradient]}
      style={[styles.card, borderColor ? { borderColor } : null, style]}
    >
      {children}
    </LinearGradient>
  );
}

/** iOS-Settings-style squircle icon with a kind abbreviation (Po, De, Cm …). */
export function SquircleIcon({
  abbr,
  color,
  size = 30,
}: {
  abbr: string;
  color: string;
  size?: number;
}) {
  return (
    <View
      style={{
        width: size,
        height: size,
        borderRadius: size * 0.3,
        backgroundColor: color,
        alignItems: 'center',
        justifyContent: 'center',
        borderTopColor: 'rgba(255,255,255,0.25)',
        borderTopWidth: 1,
      }}
    >
      <Text style={{ color: '#fff', fontSize: size * 0.35, fontWeight: '800' }}>{abbr}</Text>
    </View>
  );
}

export function StatusDot({ color, size = 9 }: { color: string; size?: number }) {
  return (
    <View
      style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: color }}
    />
  );
}

/** Rounded pill chip (namespace selector, filters, follow toggle …). */
export function Pill({
  label,
  onPress,
  active,
  icon,
}: {
  label: string;
  onPress?: () => void;
  active?: boolean;
  icon?: React.ReactNode;
}) {
  return (
    <TouchableOpacity
      onPress={onPress}
      disabled={!onPress}
      style={[styles.pill, active && styles.pillActive]}
    >
      {icon}
      <Text style={[styles.pillText, active && styles.pillTextActive]}>{label}</Text>
    </TouchableOpacity>
  );
}

/** Donut progress ring used as the dashboard health hero. */
export function HealthRing({
  percent,
  size = 78,
  label,
}: {
  percent: number;
  size?: number;
  label: string;
}) {
  const strokeWidth = 8;
  const r = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * r;
  const clamped = Math.max(0, Math.min(100, percent));
  const ringColor = clamped >= 90 ? colors.success : clamped >= 70 ? colors.warning : colors.danger;
  return (
    <View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}>
      <Svg width={size} height={size} style={{ position: 'absolute', transform: [{ rotate: '-90deg' }] }}>
        <Circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          stroke="rgba(255,255,255,0.08)"
          strokeWidth={strokeWidth}
          fill="none"
        />
        <Circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          stroke={ringColor}
          strokeWidth={strokeWidth}
          strokeLinecap="round"
          strokeDasharray={`${(circumference * clamped) / 100} ${circumference}`}
          fill="none"
        />
      </Svg>
      <Text style={{ color: colors.text, fontSize: 18, fontWeight: '800' }}>
        {label}
        <Text style={{ fontSize: 11, fontWeight: '600', color: colors.textDim }}>%</Text>
      </Text>
    </View>
  );
}

/** Thin usage bar (capacity, deployment readiness …). */
export function UsageBar({ percent, color }: { percent: number; color: string }) {
  return (
    <View style={styles.barTrack}>
      <View
        style={[
          styles.barFill,
          { width: `${Math.max(0, Math.min(100, percent))}%`, backgroundColor: color },
        ]}
      />
    </View>
  );
}

/** Compact line+area chart for a metric series (Prometheus trends). */
export function Sparkline({
  values,
  color,
  width = 130,
  height = 38,
}: {
  values: number[];
  color: string;
  width?: number;
  height?: number;
}) {
  if (values.length < 2) {
    return <View style={{ width, height }} />;
  }
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;
  const pad = 3;
  const innerH = height - pad * 2;
  const stepX = width / (values.length - 1);
  const coords = values.map((v, i) => {
    const x = i * stepX;
    const y = pad + innerH - ((v - min) / range) * innerH;
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  });
  const line = `M${coords.join(' L')}`;
  const area = `${line} L${width.toFixed(1)},${height} L0,${height} Z`;
  return (
    <Svg width={width} height={height}>
      <Path d={area} fill={color} opacity={0.13} />
      <Path
        d={line}
        stroke={color}
        strokeWidth={2}
        fill="none"
        strokeLinejoin="round"
        strokeLinecap="round"
      />
    </Svg>
  );
}

/** Bottom sheet styled like the design's cluster/namespace pickers. */
export function BottomSheet({
  visible,
  onClose,
  title,
  children,
}: {
  visible: boolean;
  onClose: () => void;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.sheetBackdropWrap}>
        <TouchableOpacity style={styles.sheetBackdrop} activeOpacity={1} onPress={onClose} />
        <View style={styles.sheet}>
          <View style={styles.sheetHandle} />
          <Text style={styles.sheetTitle}>{title}</Text>
          {children}
        </View>
      </View>
    </Modal>
  );
}

/** Round back chevron button used in all sub-screen headers. */
export function BackButton({ onPress }: { onPress: () => void }) {
  return (
    <TouchableOpacity style={styles.backButton} onPress={onPress}>
      <Text style={styles.backChevron}>‹</Text>
    </TouchableOpacity>
  );
}

/** Same chrome as BackButton but an ✕ — used to dismiss a detail pane/sidebar. */
export function CloseButton({ onPress }: { onPress: () => void }) {
  return (
    <TouchableOpacity style={styles.backButton} onPress={onPress}>
      <Text style={styles.closeGlyph}>✕</Text>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: radius.card,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.lg - 1,
  },
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.pill,
    paddingHorizontal: 13,
    paddingVertical: 7,
  },
  pillActive: {
    backgroundColor: colors.accentSoft,
    borderColor: 'rgba(91,124,255,0.5)',
  },
  pillText: { color: colors.textMid, fontSize: 12.5, fontWeight: '600' },
  pillTextActive: { color: '#fff' },
  barTrack: {
    height: 7,
    borderRadius: radius.pill,
    backgroundColor: 'rgba(255,255,255,0.07)',
    overflow: 'hidden',
  },
  barFill: { height: '100%', borderRadius: radius.pill },
  sheetBackdropWrap: { flex: 1, justifyContent: 'flex-end' },
  sheetBackdrop: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(5,8,14,0.6)',
  },
  sheet: {
    backgroundColor: colors.sheet,
    borderTopLeftRadius: radius.sheet,
    borderTopRightRadius: radius.sheet,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 18,
    paddingBottom: 48,
    gap: 12,
    maxHeight: '75%',
  },
  sheetHandle: {
    width: 38,
    height: 5,
    borderRadius: radius.pill,
    backgroundColor: 'rgba(255,255,255,0.18)',
    alignSelf: 'center',
  },
  sheetTitle: { color: colors.text, fontSize: 17, fontWeight: '700', paddingHorizontal: 2 },
  backButton: {
    width: 38,
    height: 38,
    borderRadius: radius.pill,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  backChevron: { color: colors.textMid, fontSize: 24, fontWeight: '600', marginTop: -3 },
  closeGlyph: { color: colors.textMid, fontSize: 15, fontWeight: '700' },
});
