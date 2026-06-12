import * as Haptics from 'expo-haptics';
import * as SecureStore from 'expo-secure-store';

const KEY = 'captain.haptics';
let enabled = true;
let loaded = false;

export async function loadHapticsSetting(): Promise<boolean> {
  if (!loaded) {
    const raw = await SecureStore.getItemAsync(KEY).catch(() => null);
    enabled = raw !== 'off';
    loaded = true;
  }
  return enabled;
}

export function hapticsEnabled(): boolean {
  return enabled;
}

export async function setHapticsEnabled(value: boolean): Promise<void> {
  enabled = value;
  loaded = true;
  await SecureStore.setItemAsync(KEY, value ? 'on' : 'off').catch(() => {});
}

/** Tap feedback for destructive actions, honoring the settings toggle. */
export function hapticWarning(): void {
  if (enabled) {
    void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning).catch(() => {});
  }
}

export function hapticTap(): void {
  if (enabled) {
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
  }
}
