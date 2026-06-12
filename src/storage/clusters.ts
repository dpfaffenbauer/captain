import * as SecureStore from 'expo-secure-store';
import { ClusterConfig } from '../types';

const INDEX_KEY = 'captain.cluster-ids';

function clusterKey(id: string): string {
  return `captain.cluster.${id}`;
}

async function readIndex(): Promise<string[]> {
  const raw = await SecureStore.getItemAsync(INDEX_KEY);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((x) => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

async function writeIndex(ids: string[]): Promise<void> {
  await SecureStore.setItemAsync(INDEX_KEY, JSON.stringify(ids));
}

export async function loadClusters(): Promise<ClusterConfig[]> {
  const ids = await readIndex();
  const clusters: ClusterConfig[] = [];
  for (const id of ids) {
    const raw = await SecureStore.getItemAsync(clusterKey(id));
    if (!raw) continue;
    try {
      clusters.push(JSON.parse(raw) as ClusterConfig);
    } catch {
      // skip corrupted entries
    }
  }
  return clusters;
}

export async function saveCluster(cluster: ClusterConfig): Promise<void> {
  await SecureStore.setItemAsync(clusterKey(cluster.id), JSON.stringify(cluster));
  const ids = await readIndex();
  if (!ids.includes(cluster.id)) {
    ids.push(cluster.id);
    await writeIndex(ids);
  }
}

export async function deleteCluster(id: string): Promise<void> {
  await SecureStore.deleteItemAsync(clusterKey(id));
  const ids = await readIndex();
  await writeIndex(ids.filter((existing) => existing !== id));
}
