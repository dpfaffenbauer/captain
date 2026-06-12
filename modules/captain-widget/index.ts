import { requireOptionalNativeModule } from 'expo-modules-core';

/** Per-cluster entry of the widget snapshot, mirrored in targets/widget. */
export interface WidgetClusterEntry {
  name: string;
  /** ok | warn | bad | unknown — drives the status dot color. */
  tone: string;
  /** One-line summary, e.g. "3/3 nodes · 42 pods · 2 problems". */
  summary: string;
}

export interface WidgetSnapshot {
  clusters: WidgetClusterEntry[];
  /** Unix epoch seconds of the probe. */
  updatedAt: number;
}

interface CaptainWidgetNativeModule {
  setSnapshot(json: string): void;
}

const native = requireOptionalNativeModule<CaptainWidgetNativeModule>('CaptainWidget');

/**
 * Publishes the latest multi-cluster health snapshot to the home-screen
 * widget. No-op in Expo Go or when the widget extension is not built.
 */
export function publishWidgetSnapshot(snapshot: WidgetSnapshot): void {
  try {
    native?.setSnapshot(JSON.stringify(snapshot));
  } catch {
    // The widget is cosmetic; never let it break the app.
  }
}
