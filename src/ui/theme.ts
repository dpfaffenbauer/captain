/**
 * Design tokens from "Captain v2 · Soft Bridge" (Claude Design handoff).
 * Dark indigo base, soft pastel status colors, SF Pro everywhere except
 * logs/YAML/image refs (mono).
 */
export const colors = {
  background: '#0F1420',
  backgroundDeep: '#0B0F18',
  sheet: '#1A2131',
  cardTop: '#1E2638',
  cardBottom: '#171E2D',
  border: 'rgba(255,255,255,0.08)',
  borderFaint: 'rgba(255,255,255,0.05)',
  surface: 'rgba(255,255,255,0.06)',
  surfaceAlt: 'rgba(255,255,255,0.04)',

  text: '#F2F5FA',
  textMid: 'rgba(242,245,250,0.65)',
  textDim: 'rgba(242,245,250,0.45)',
  textFaint: 'rgba(242,245,250,0.35)',

  accent: '#5B7CFF',
  accentSoft: 'rgba(91,124,255,0.9)',
  accentText: '#ffffff',
  link: '#8FA5FF',

  success: '#34D399',
  warning: '#FBBF55',
  warningLight: '#FFD083',
  danger: '#FB7185',
  dangerLight: '#FB95A6',

  mono: 'rgba(242,245,250,0.75)',
  monoKey: '#8FA5FF',
  monoString: '#34D399',
  monoNumber: '#FBBF55',
};

/** Category accent colors from the Browse design. */
export const categoryColors: Record<string, string> = {
  workloads: '#5B7CFF',
  config: '#A78BFA',
  network: '#2DD4BF',
  storage: '#F4A85C',
  cluster: '#F472B6',
  access: '#818CF8',
  custom: '#4ADE80',
  other: '#94A3B8',
};

export const spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
};

export const radius = {
  row: 16,
  card: 18,
  cardLg: 22,
  hero: 24,
  pill: 999,
  sheet: 30,
};

export const cardGradient = [colors.cardTop, colors.cardBottom] as const;
