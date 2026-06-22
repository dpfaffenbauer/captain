import * as SecureStore from 'expo-secure-store';
import React, { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { Dimensions, Platform } from 'react-native';

const KEY = 'captain.ui-scale';

/** Selectable interface sizes. macOS/large displays make iPad points feel tiny. */
export const UI_SCALE_OPTIONS = [
  { label: 'Default', value: 1 },
  { label: 'Large', value: 1.25 },
  { label: 'Larger', value: 1.5 },
  { label: 'Largest', value: 1.8 },
] as const;

/**
 * Decide whether we are rendering on a Mac, where iPad point sizes look tiny.
 * Mac Catalyst reports the `mac` idiom directly. Apps shipped as "Designed for
 * iPad" run on Apple Silicon Macs while still reporting the `pad` idiom, so we
 * fall back to a screen-width check: no iPad is wider than 1366pt, so anything
 * past that on iOS is a Mac display.
 */
function isDesktop(): boolean {
  const idiom = (Platform.constants as { interfaceIdiom?: string } | undefined)?.interfaceIdiom;
  if (idiom === 'mac') return true;
  if (Platform.OS !== 'ios') return false;
  const { width, height } = Dimensions.get('screen');
  return Math.max(width, height) > 1400;
}

/** macOS displays render iPad points small, so default to a comfortably larger zoom. */
function defaultScale(): number {
  return isDesktop() ? 1.5 : 1;
}

interface UiScaleValue {
  scale: number;
  setScale(scale: number): void;
}

const UiScaleContext = createContext<UiScaleValue | null>(null);

export function UiScaleProvider({ children }: { children: React.ReactNode }) {
  const [scale, setScaleState] = useState(defaultScale);

  useEffect(() => {
    SecureStore.getItemAsync(KEY)
      .then((raw) => {
        const stored = raw ? parseFloat(raw) : NaN;
        if (!Number.isNaN(stored) && stored > 0) setScaleState(stored);
      })
      .catch(() => {});
  }, []);

  const setScale = (next: number) => {
    setScaleState(next);
    void SecureStore.setItemAsync(KEY, String(next)).catch(() => {});
  };

  const value = useMemo(() => ({ scale, setScale }), [scale]);
  return <UiScaleContext.Provider value={value}>{children}</UiScaleContext.Provider>;
}

export function useUiScale(): UiScaleValue {
  const context = useContext(UiScaleContext);
  if (!context) throw new Error('useUiScale must be used within a UiScaleProvider');
  return context;
}
