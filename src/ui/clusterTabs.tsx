import React from 'react';
import Svg, { Circle, Path, Rect } from 'react-native-svg';

/** The three primary tabs of a cluster (bottom bar on phone, sidebar on iPad). */
export type TabKey = 'home' | 'browse' | 'events';

export const TABS: Array<{ key: TabKey; label: string; path: string }> = [
  { key: 'home', label: 'Cluster', path: '' },
  { key: 'browse', label: 'Browse', path: 'browse' },
  { key: 'events', label: 'Events', path: 'events' },
];

/**
 * Secondary destinations surfaced in the sidebar on wide screens. The phone
 * reaches these through the Browse tab, so they are not part of TABS.
 */
export const SHORTCUTS: Array<{ label: string; path: string; abbr: string; color: string }> = [
  { label: 'Search', path: 'search', abbr: '⌕', color: '#6B8AFF' },
  { label: 'Helm', path: 'helm', abbr: 'He', color: '#36B3F4' },
  { label: 'GitOps', path: 'gitops', abbr: 'Go', color: '#F4845C' },
  { label: 'Forwards', path: 'forwards', abbr: 'Pf', color: '#3FE0C5' },
];

export function TabIcon({ tab, color }: { tab: TabKey; color: string }) {
  if (tab === 'home') {
    return (
      <Svg width={19} height={19} viewBox="0 0 20 20">
        <Circle cx={10} cy={10} r={7} fill="none" stroke={color} strokeWidth={1.7} />
        <Circle cx={10} cy={10} r={2.2} fill={color} />
        <Path d="M10 3v4M10 13v4M3 10h4M13 10h4" stroke={color} strokeWidth={1.7} strokeLinecap="round" />
      </Svg>
    );
  }
  if (tab === 'browse') {
    return (
      <Svg width={19} height={19} viewBox="0 0 20 20">
        <Rect x={2.5} y={2.5} width={6.2} height={6.2} rx={2} fill="none" stroke={color} strokeWidth={1.7} />
        <Rect x={11.3} y={2.5} width={6.2} height={6.2} rx={2} fill="none" stroke={color} strokeWidth={1.7} />
        <Rect x={2.5} y={11.3} width={6.2} height={6.2} rx={2} fill="none" stroke={color} strokeWidth={1.7} />
        <Rect x={11.3} y={11.3} width={6.2} height={6.2} rx={2} fill={color} />
      </Svg>
    );
  }
  return (
    <Svg width={19} height={19} viewBox="0 0 20 20">
      <Path
        d="M2 11h4l2.5-6 3 10 2.5-6H18"
        fill="none"
        stroke={color}
        strokeWidth={1.7}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  );
}
