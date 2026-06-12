import * as BackgroundTask from 'expo-background-task';
import * as Notifications from 'expo-notifications';
import * as SecureStore from 'expo-secure-store';
import * as TaskManager from 'expo-task-manager';
import { publishWidgetSnapshot, WidgetClusterEntry } from '../../modules/captain-widget';
import { ClusterHealth, getClusterHealth, healthTone } from '../kube/health';
import { loadClusters } from '../storage/clusters';

/**
 * Periodic background health check (BGTaskScheduler via expo-background-task):
 * probes every stored cluster, refreshes the home-screen widget and raises a
 * local notification when a cluster degrades. iOS schedules the task
 * opportunistically — this is a best-effort early warning, not monitoring.
 */

const TASK_NAME = 'captain.health-check';
const ENABLED_KEY = 'captain.bg-alerts';
/** Fingerprint of the last notified problem set, to avoid repeat alerts. */
const LAST_STATE_KEY = 'captain.bg-alerts.last';

function healthSummary(health: ClusterHealth): string {
  if (!health.reachable) return 'unreachable';
  const parts = [`${health.nodesReady}/${health.nodesTotal} nodes ready`];
  if (health.podsProblem > 0) {
    parts.push(`${health.podsProblem} problem ${health.podsProblem === 1 ? 'pod' : 'pods'}`);
  }
  return parts.join(' · ');
}

async function runHealthCheck(): Promise<void> {
  const clusters = await loadClusters();
  if (clusters.length === 0) return;

  const results = await Promise.all(
    clusters.map(async (cluster) => ({
      cluster,
      health: await getClusterHealth(cluster),
    }))
  );

  // Keep the widget fresh even when the app has not been opened for a while.
  const entries: WidgetClusterEntry[] = results.map(({ cluster, health }) => ({
    name: cluster.name,
    tone: healthTone(health),
    summary: healthSummary(health),
  }));
  publishWidgetSnapshot({ clusters: entries, updatedAt: Math.floor(Date.now() / 1000) });

  const problems = results.filter(({ health }) => healthTone(health) !== 'ok');
  const fingerprint = problems
    .map(({ cluster, health }) => `${cluster.id}:${healthTone(health)}:${health.podsProblem}`)
    .sort()
    .join('|');
  const last = await SecureStore.getItemAsync(LAST_STATE_KEY).catch(() => null);
  if (fingerprint === (last ?? '')) return;
  await SecureStore.setItemAsync(LAST_STATE_KEY, fingerprint).catch(() => {});
  if (problems.length === 0) return;

  const lines = problems.map(
    ({ cluster, health }) => `${cluster.name}: ${healthSummary(health)}`
  );
  await Notifications.scheduleNotificationAsync({
    content: {
      title:
        problems.length === 1
          ? `Cluster "${problems[0].cluster.name}" needs attention`
          : `${problems.length} clusters need attention`,
      body: lines.join('\n'),
      sound: 'default',
    },
    trigger: null,
  });
}

TaskManager.defineTask(TASK_NAME, async () => {
  try {
    await runHealthCheck();
    return BackgroundTask.BackgroundTaskResult.Success;
  } catch {
    return BackgroundTask.BackgroundTaskResult.Failed;
  }
});

export async function loadBackgroundAlertsSetting(): Promise<boolean> {
  const raw = await SecureStore.getItemAsync(ENABLED_KEY).catch(() => null);
  return raw === 'on';
}

/** Re-arms the task registration on app start when the setting is on. */
export async function syncBackgroundAlerts(): Promise<void> {
  if (await loadBackgroundAlertsSetting()) {
    await BackgroundTask.registerTaskAsync(TASK_NAME, { minimumInterval: 30 }).catch(() => {});
  }
}

/** Returns false when notification permission was denied. */
export async function setBackgroundAlertsEnabled(value: boolean): Promise<boolean> {
  if (value) {
    const permission = await Notifications.requestPermissionsAsync();
    if (!permission.granted) return false;
    await BackgroundTask.registerTaskAsync(TASK_NAME, { minimumInterval: 30 });
  } else {
    await BackgroundTask.unregisterTaskAsync(TASK_NAME).catch(() => {});
  }
  await SecureStore.setItemAsync(ENABLED_KEY, value ? 'on' : 'off').catch(() => {});
  return true;
}
