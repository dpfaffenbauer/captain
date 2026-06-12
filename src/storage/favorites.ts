import * as SecureStore from 'expo-secure-store';
import { FavoriteResource } from '../types';

const KEY = 'captain.favorites';

/** Stable identity for a pinned resource: cluster + type + namespace + name. */
export function favoriteKey(fav: {
  clusterId: string;
  group: string;
  kind: string;
  namespace?: string;
  name: string;
}): string {
  return `${fav.clusterId}|${fav.group}/${fav.kind}|${fav.namespace ?? ''}|${fav.name}`;
}

export async function loadFavorites(): Promise<FavoriteResource[]> {
  const raw = await SecureStore.getItemAsync(KEY);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as FavoriteResource[]) : [];
  } catch {
    return [];
  }
}

export async function saveFavorites(favorites: FavoriteResource[]): Promise<void> {
  await SecureStore.setItemAsync(KEY, JSON.stringify(favorites));
}
