import React, { createContext, useContext, useMemo, useState } from 'react';

interface SidePaneState {
  /** Width of the right detail column, shared across list/helm and resizable. */
  width: number;
  setWidth: (width: number) => void;
}

const DEFAULT_WIDTH = 460;

const SidePaneContext = createContext<SidePaneState | null>(null);

export function SidePaneProvider({ children }: { children: React.ReactNode }) {
  const [width, setWidth] = useState(DEFAULT_WIDTH);
  const value = useMemo(() => ({ width, setWidth }), [width]);
  return <SidePaneContext.Provider value={value}>{children}</SidePaneContext.Provider>;
}

export function useSidePane(): SidePaneState {
  const context = useContext(SidePaneContext);
  if (!context) throw new Error('useSidePane must be used within a SidePaneProvider');
  return context;
}
