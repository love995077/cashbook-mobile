/**
 * Where the JWT lives between launches.
 *
 * expo-secure-store uses the iOS keychain and Android keystore, but has no web
 * implementation — calling it there throws. The web build falls back to
 * localStorage, which is fine for local development and is the only option
 * short of a cookie-based session.
 */

import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';

const TOKEN_KEY = 'cashbook.access_token';

const isWeb = Platform.OS === 'web';

export async function saveToken(token: string): Promise<void> {
  if (isWeb) {
    globalThis.localStorage?.setItem(TOKEN_KEY, token);
    return;
  }
  await SecureStore.setItemAsync(TOKEN_KEY, token);
}

export async function loadToken(): Promise<string | null> {
  try {
    if (isWeb) return globalThis.localStorage?.getItem(TOKEN_KEY) ?? null;
    return await SecureStore.getItemAsync(TOKEN_KEY);
  } catch {
    // A corrupt or unreadable entry should log the user out, not crash launch.
    return null;
  }
}

export async function clearToken(): Promise<void> {
  try {
    if (isWeb) {
      globalThis.localStorage?.removeItem(TOKEN_KEY);
      return;
    }
    await SecureStore.deleteItemAsync(TOKEN_KEY);
  } catch {
    // Already gone.
  }
}
