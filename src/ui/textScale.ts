import { StyleSheet, Text, TextInput } from 'react-native';

/**
 * Global, crisp interface zoom.
 *
 * The previous approach wrapped the whole tree in a `transform: [{ scale }]`,
 * which magnifies an already-rasterized layer — text ends up soft/blurry
 * because the glyphs were drawn at the smaller point size and then stretched.
 *
 * Instead we patch React Native's `Text`/`TextInput` so every explicit
 * `fontSize` (and matching `lineHeight`) is multiplied by the active scale.
 * Each label re-renders at its true larger point size, so it stays sharp.
 * Layout grows with the text because most rows are auto-height.
 */

let currentScale = 1;
let patched = false;

/** Set the active font scale. Callers should remount the tree so it takes hold. */
export function setTextScale(scale: number): void {
  currentScale = scale > 0 ? scale : 1;
}

function scaleStyle(style: unknown): unknown {
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
  // Keep the original style last-but-one so explicit per-element overrides still
  // win, with the scaled font size applied on top.
  return [style, scaled];
}

/**
 * Monkey-patch the `Text` and `TextInput` render functions once. Safe under
 * Fast Refresh thanks to the `patched` guard.
 */
export function patchTextScaling(): void {
  if (patched) return;
  patched = true;
  for (const Component of [Text, TextInput] as Array<{
    render?: (props: { style?: unknown }, ref: unknown) => unknown;
  }>) {
    const original = Component.render;
    if (typeof original !== 'function') continue;
    Component.render = function patchedRender(props, ref) {
      return original.call(this, { ...props, style: scaleStyle(props.style) }, ref);
    };
  }
}
