/** Parses a Kubernetes CPU quantity into cores (e.g. "250m" → 0.25). */
export function parseCpu(quantity?: string): number {
  if (!quantity) return 0;
  if (quantity.endsWith('m')) return parseFloat(quantity) / 1000;
  if (quantity.endsWith('n')) return parseFloat(quantity) / 1e9;
  if (quantity.endsWith('u')) return parseFloat(quantity) / 1e6;
  const value = parseFloat(quantity);
  return Number.isNaN(value) ? 0 : value;
}

const MEM_SUFFIXES: Record<string, number> = {
  Ki: 2 ** 10,
  Mi: 2 ** 20,
  Gi: 2 ** 30,
  Ti: 2 ** 40,
  Pi: 2 ** 50,
  k: 1e3,
  M: 1e6,
  G: 1e9,
  T: 1e12,
  P: 1e15,
};

/** Parses a Kubernetes memory quantity into bytes (e.g. "512Mi"). */
export function parseMemory(quantity?: string): number {
  if (!quantity) return 0;
  const match = /^([0-9.]+)([A-Za-z]*)$/.exec(quantity.trim());
  if (!match) return 0;
  const value = parseFloat(match[1]);
  if (Number.isNaN(value)) return 0;
  return value * (MEM_SUFFIXES[match[2]] ?? 1);
}

export function formatCores(cores: number): string {
  return cores >= 10 ? cores.toFixed(0) : cores.toFixed(1);
}

export function formatGiB(bytes: number): string {
  const gib = bytes / 2 ** 30;
  return gib >= 10 ? gib.toFixed(0) : gib.toFixed(1);
}
