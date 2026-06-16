import React, { useRef } from 'react';
import { PanResponder, StyleSheet, useWindowDimensions, View } from 'react-native';
import { useSidePane } from '../state/SidePaneContext';
import { colors } from './theme';

const MIN_WIDTH = 320;

/**
 * Resizable right detail column — the same dockable feel as the bottom dock,
 * but a single pane (no tabs). Drag the left edge to widen or narrow it.
 */
export function SidePane({ children }: { children: React.ReactNode }) {
  const { width, setWidth } = useSidePane();
  const { width: windowWidth } = useWindowDimensions();

  const startWidth = useRef(width);
  const widthRef = useRef(width);
  widthRef.current = width;
  const maxWidthRef = useRef(windowWidth * 0.6);
  maxWidthRef.current = windowWidth * 0.6;

  const responder = useRef(
    PanResponder.create({
      onMoveShouldSetPanResponder: (_evt, gesture) => Math.abs(gesture.dx) > 2,
      onPanResponderGrant: () => {
        startWidth.current = widthRef.current;
      },
      onPanResponderMove: (_evt, gesture) => {
        // Dragging the handle left (negative dx) widens the pane.
        const next = Math.max(
          MIN_WIDTH,
          Math.min(maxWidthRef.current, startWidth.current - gesture.dx)
        );
        setWidth(next);
      },
    })
  ).current;

  return (
    <View style={[styles.pane, { width }]}>
      <View style={styles.handleZone} {...responder.panHandlers}>
        <View style={styles.handle} />
      </View>
      <View style={styles.content}>{children}</View>
    </View>
  );
}

const styles = StyleSheet.create({
  pane: { flexDirection: 'row' },
  handleZone: {
    width: 14,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.background,
    borderLeftColor: colors.border,
    borderLeftWidth: StyleSheet.hairlineWidth,
  },
  handle: { width: 3, height: 38, borderRadius: 2, backgroundColor: colors.border },
  // Clear the status bar so the detail header lines up with the side rails.
  content: { flex: 1, paddingTop: 44 },
});
