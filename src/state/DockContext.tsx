import React, { createContext, useContext, useMemo, useState } from 'react';
import { DetailTarget, detailKey } from './DetailSelection';

export type DockTarget = Extract<DetailTarget, { kind: 'logs' } | { kind: 'exec' }>;

export interface DockSession {
  id: string;
  target: DockTarget;
  title: string;
}

interface DockState {
  sessions: DockSession[];
  activeId: string | null;
  height: number;
  minimized: boolean;
  openLogs: (target: Extract<DetailTarget, { kind: 'logs' }>) => void;
  openExec: (target: Extract<DetailTarget, { kind: 'exec' }>) => void;
  close: (id: string) => void;
  setActive: (id: string) => void;
  setHeight: (height: number) => void;
  setMinimized: (minimized: boolean) => void;
}

const DEFAULT_HEIGHT = 300;

function titleFor(target: DockTarget): string {
  return target.kind === 'logs' ? `${target.name} · logs` : `${target.name} · sh`;
}

const DockContext = createContext<DockState | null>(null);

export function DockProvider({ children }: { children: React.ReactNode }) {
  const [sessions, setSessions] = useState<DockSession[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [height, setHeight] = useState(DEFAULT_HEIGHT);
  const [minimized, setMinimized] = useState(false);

  const value = useMemo<DockState>(() => {
    const open = (target: DockTarget) => {
      const id = detailKey(target);
      setSessions((current) =>
        current.some((s) => s.id === id)
          ? current
          : [...current, { id, target, title: titleFor(target) }]
      );
      setActiveId(id);
      setMinimized(false);
    };
    return {
      sessions,
      activeId,
      height,
      minimized,
      openLogs: open,
      openExec: open,
      close: (id) =>
        setSessions((current) => {
          const next = current.filter((s) => s.id !== id);
          setActiveId((active) =>
            active === id ? next[next.length - 1]?.id ?? null : active
          );
          return next;
        }),
      setActive: setActiveId,
      setHeight,
      setMinimized,
    };
  }, [sessions, activeId, height, minimized]);

  return <DockContext.Provider value={value}>{children}</DockContext.Provider>;
}

export function useDock(): DockState {
  const context = useContext(DockContext);
  if (!context) throw new Error('useDock must be used within a DockProvider');
  return context;
}
