import React from 'react';
import {
  StyleSheet,
  Text as RNText,
  TextInput as RNTextInput,
  TextInputProps,
  TextProps,
  TextStyle,
} from 'react-native';
import { useScaleFactor } from '../state/UiScaleContext';

/**
 * Crisp interface zoom. Instead of magnifying a rasterized layer with a
 * transform (which blurs text), these drop-in replacements for React Native's
 * `Text`/`TextInput` multiply the resolved `fontSize` (and `lineHeight`) by the
 * active UI scale, so every label re-renders at its true larger point size and
 * stays sharp. The scale is read from context, so changing it in Settings
 * re-renders all text immediately — no remount needed.
 */
function scaleFont(style: TextProps['style'], scale: number): TextProps['style'] {
  if (scale === 1) return style;
  const flat = StyleSheet.flatten(style) as TextStyle | undefined;
  if (!flat || typeof flat.fontSize !== 'number') return style;
  const extra: TextStyle = { fontSize: flat.fontSize * scale };
  if (typeof flat.lineHeight === 'number') extra.lineHeight = flat.lineHeight * scale;
  // Original style first so explicit overrides survive, scaled font on top.
  return [style, extra];
}

export const Text = React.forwardRef<React.ElementRef<typeof RNText>, TextProps>(
  (props, ref) => {
    const scale = useScaleFactor();
    return <RNText ref={ref} {...props} style={scaleFont(props.style, scale)} />;
  },
);
Text.displayName = 'ScaledText';

export const TextInput = React.forwardRef<React.ElementRef<typeof RNTextInput>, TextInputProps>(
  (props, ref) => {
    const scale = useScaleFactor();
    return (
      <RNTextInput ref={ref} {...props} style={scaleFont(props.style, scale) as TextInputProps['style']} />
    );
  },
);
TextInput.displayName = 'ScaledTextInput';
