import React from 'react';
import { StyleSheet, Text as RNText, TextInput as RNTextInput } from 'react-native';

export * from 'react-native';

/**
 * Global, crisp interface zoom.
 *
 * React Native 0.85 / React 19 turned `Text` and `TextInput` into plain
 * function components (ref-as-prop) with no `.render` to monkey-patch, so the
 * previous global patch silently did nothing — text never scaled on any
 * platform (most visible on macOS, where the default zoom is supposed to be
 * larger). Instead we re-export drop-in `Text`/`TextInput` wrappers that
 * multiply every explicit `fontSize` (and matching `lineHeight`) by the active
 * scale. Each label re-renders at its true larger point size, so it stays
 * sharp — unlike a `transform: scale`, which magnifies an already-rasterized
 * layer and turns blurry.
 *
 * Consumers import `Text`/`TextInput` from this module instead of
 * 'react-native'; every other React Native export is re-exported untouched.
 */

let currentScale = 1;

/** Set the active font scale. The tree must remount for it to take hold. */
export function setTextScale(scale: number): void {
  currentScale = scale > 0 ? scale : 1;
}

function scaleStyle<T>(style: T): T {
  if (currentScale === 1) return style;
  const flat = StyleSheet.flatten(style as never) as
    | { fontSize?: number; lineHeight?: number }
    | undefined;
  if (!flat || typeof flat.fontSize !== 'number') return style;
  const scaled: { fontSize: number; lineHeight?: number } = {
    fontSize: flat.fontSize * currentScale,
  };
  if (typeof flat.lineHeight === 'number') {
    scaled.lineHeight = flat.lineHeight * currentScale;
  }
  // Keep the caller's style first so explicit per-element overrides still win,
  // with the scaled font size layered on top.
  return [style, scaled] as unknown as T;
}

export function Text(props: React.ComponentProps<typeof RNText>) {
  return <RNText {...props} style={scaleStyle(props.style)} />;
}

export function TextInput(props: React.ComponentProps<typeof RNTextInput>) {
  return <RNTextInput {...props} style={scaleStyle(props.style)} />;
}

/**
 * The unscaled React Native `Text`, for fixed-size chrome (icon rails, avatars,
 * badges) whose glyphs must track their fixed container rather than the global
 * interface zoom — otherwise the text outgrows its box.
 */
export const RawText = RNText;

