import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';
import { favoriteKey, loadFavorites, saveFavorites } from '../storage/favorites';
import { FavoriteResource } from '../types';

interface FavoritesContextValue {
  favorites: FavoriteResource[];
  loading: boolean;
  isFavorite(key: string): boolean;
  /** Pin if not pinned, unpin if already pinned. Returns the new pinned state. */
  toggle(fav: Omit<FavoriteResource, 'addedAt'>): boolean;
  remove(key: string): void;
}

const FavoritesContext = createContext<FavoritesContextValue | undefined>(undefined);

export function FavoritesProvider({ children }: { children: React.ReactNode }) {
  const [favorites, setFavorites] = useState<FavoriteResource[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadFavorites()
      .then(setFavorites)
      .finally(() => setLoading(false));
  }, []);

  // The set of currently pinned keys, recomputed only when the list changes.
  const keys = useMemo(() => new Set(favorites.map((fav) => favoriteKey(fav))), [favorites]);

  const persist = useCallback((next: FavoriteResource[]) => {
    setFavorites(next);
    void saveFavorites(next);
  }, []);

  const isFavorite = useCallback((key: string) => keys.has(key), [keys]);

  const toggle = useCallback(
    (fav: Omit<FavoriteResource, 'addedAt'>): boolean => {
      const key = favoriteKey(fav);
      const existing = favorites.some((entry) => favoriteKey(entry) === key);
      if (existing) {
        persist(favorites.filter((entry) => favoriteKey(entry) !== key));
        return false;
      }
      // Newest first so freshly pinned items surface at the top.
      persist([{ ...fav, addedAt: Date.now() }, ...favorites]);
      return true;
    },
    [favorites, persist]
  );

  const remove = useCallback(
    (key: string) => {
      persist(favorites.filter((entry) => favoriteKey(entry) !== key));
    },
    [favorites, persist]
  );

  const value = useMemo(
    () => ({ favorites, loading, isFavorite, toggle, remove }),
    [favorites, loading, isFavorite, toggle, remove]
  );

  return <FavoritesContext.Provider value={value}>{children}</FavoritesContext.Provider>;
}

export function useFavorites(): FavoritesContextValue {
  const context = useContext(FavoritesContext);
  if (!context) throw new Error('useFavorites must be used within FavoritesProvider');
  return context;
}
