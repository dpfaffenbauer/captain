import * as LocalAuthentication from 'expo-local-authentication';
import * as SecureStore from 'expo-secure-store';

const KEY = 'captain.applock';
let enabled = false;
let loaded = false;

export async function loadAppLockSetting(): Promise<boolean> {
  if (!loaded) {
    const raw = await SecureStore.getItemAsync(KEY).catch(() => null);
    enabled = raw === 'on';
    loaded = true;
  }
  return enabled;
}

export function appLockEnabled(): boolean {
  return enabled;
}

export async function setAppLockEnabled(value: boolean): Promise<void> {
  enabled = value;
  loaded = true;
  await SecureStore.setItemAsync(KEY, value ? 'on' : 'off').catch(() => {});
}

/** Face ID / Touch ID / passcode available on this device? */
export async function isBiometricAvailable(): Promise<boolean> {
  const [hasHardware, isEnrolled] = await Promise.all([
    LocalAuthentication.hasHardwareAsync(),
    LocalAuthentication.isEnrolledAsync(),
  ]);
  return hasHardware && isEnrolled;
}

/** Prompts for Face ID/Touch ID (with passcode fallback). */
export async function authenticate(): Promise<boolean> {
  try {
    const result = await LocalAuthentication.authenticateAsync({
      promptMessage: 'Unlock Captain',
    });
    return result.success;
  } catch {
    return false;
  }
}
