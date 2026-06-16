import { useWindowDimensions } from 'react-native';

/** iPad portrait and most resized macOS windows clear this. */
export const WIDE_BREAKPOINT = 768;
/** Enough room for sidebar + master + a third detail column. */
export const EXTRA_WIDE_BREAKPOINT = 1100;

export interface ResponsiveLayout {
  width: number;
  height: number;
  /** Two-column territory: show the sidebar and master-detail splits. */
  isWide: boolean;
  /** Three-column territory: sidebar + master + a persistent detail pane. */
  isExtraWide: boolean;
}

/**
 * Single source of truth for the layout breakpoints. Re-renders on rotation and
 * window resize (macOS / Stage Manager) because it wraps useWindowDimensions.
 */
export function useResponsiveLayout(): ResponsiveLayout {
  const { width, height } = useWindowDimensions();
  return {
    width,
    height,
    isWide: width >= WIDE_BREAKPOINT,
    isExtraWide: width >= EXTRA_WIDE_BREAKPOINT,
  };
}
