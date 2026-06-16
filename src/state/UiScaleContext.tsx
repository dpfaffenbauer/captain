import * as SecureStore from 'expo-secure-store';
import React, { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { Platform } from 'react-native';

const KEY = 'captain.ui-scale';

/** Selectable interface sizes. macOS/large displays make iPad points feel tiny. */
export const UI_SCALE_OPTIONS = [
  { label: 'Default', value: 1 },
  { label: 'Large', value: 1.15 },
  { label: 'Larger', value: 1.3 },
] as const;

/** Mac Catalyst reports this idiom; default it a notch larger out of the box. */
function defaultScale(): number {
  const idiom = (Platform.constants as { interfaceIdiom?: string } | undefined)?.interfaceIdiom;
  return idiom === 'mac' ? 1.15 : 1;
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
