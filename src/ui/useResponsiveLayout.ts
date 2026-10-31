import { useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

/** iPad portrait and most resized macOS windows clear this. */
export const WIDE_BREAKPOINT = 768;
/** Enough room for sidebar + master + a third detail column. */
export const EXTRA_WIDE_BREAKPOINT = 1100;
/** Cluster icon rail + sidebar in the wide layout. */
const SIDE_COLUMNS_WIDTH = 320;

export interface ResponsiveLayout {
  width: number;
  height: number;
  /** Two-column territory: show the sidebar and master-detail splits. */
  isWide: boolean;
  /** Three-column territory: sidebar + master + a persistent detail pane. */
  isExtraWide: boolean;
  /** Width left for the master content, net of side columns and system insets. */
  masterWidth: number;
}

/**
 * Single source of truth for the layout breakpoints. Re-renders on rotation and
 * window resize (macOS / Stage Manager) because it wraps useWindowDimensions.
 */
export function useResponsiveLayout(): ResponsiveLayout {
  const { width, height } = useWindowDimensions();
  const { left, right } = useSafeAreaInsets();
  const isWide = width >= WIDE_BREAKPOINT;
  return {
    width,
    height,
    isWide,
    isExtraWide: width >= EXTRA_WIDE_BREAKPOINT,
    masterWidth: width - left - right - (isWide ? SIDE_COLUMNS_WIDTH : 0),
  };
}
