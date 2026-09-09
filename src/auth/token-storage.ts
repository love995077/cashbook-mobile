/**
 * Where the JWT and the signed-in profile live between launches.
 *
 * expo-secure-store uses the iOS keychain and Android keystore, but has no web
 * implementation — calling it there throws. The web build falls back to
 * localStorage, which is fine for local development and is the only option
 * short of a cookie-based session.
 *
 * The profile is stored beside the token because a token on its own is not a
 * session: GET /auth/me is the only thing that turns one into a `User`, and
 * offline it never answers. Caching the profile is what lets a crew on a site
 * with no signal get past the login screen.
 */

import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';

import type { User } from '@/data/types';

const TOKEN_KEY = 'cashbook.access_token';
const PROFILE_KEY = 'cashbook.profile';

const isWeb = Platform.OS === 'web';

async function setItem(key: string, value: string): Promise<void> {
  if (isWeb) {
    globalThis.localStorage?.setItem(key, value);
    return;
  }
  await SecureStore.setItemAsync(key, value);
}

async function getItem(key: string): Promise<string | null> {
  try {
    if (isWeb) return globalThis.localStorage?.getItem(key) ?? null;
    return await SecureStore.getItemAsync(key);
  } catch {
    // A corrupt or unreadable entry should log the user out, not crash launch.
    return null;
  }
}

async function removeItem(key: string): Promise<void> {
  try {
    if (isWeb) {
      globalThis.localStorage?.removeItem(key);
      return;
    }
    await SecureStore.deleteItemAsync(key);
  } catch {
    // Already gone.
  }
}

export async function saveToken(token: string): Promise<void> {
  await setItem(TOKEN_KEY, token);
}

export async function loadToken(): Promise<string | null> {
  return getItem(TOKEN_KEY);
}

export async function clearToken(): Promise<void> {
  await removeItem(TOKEN_KEY);
}

export async function saveProfile(user: User): Promise<void> {
  await setItem(PROFILE_KEY, JSON.stringify(user));
}

export async function loadProfile(): Promise<User | null> {
  const raw = await getItem(PROFILE_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as User;
  } catch {
    // Written by an older build, or truncated. Same as having no profile.
    return null;
  }
}

/** Token and profile together — what signing out has to erase. */
export async function clearSession(): Promise<void> {
  await Promise.all([removeItem(TOKEN_KEY), removeItem(PROFILE_KEY)]);
}

/**
 * True when the token's own `exp` claim has passed.
 *
 * Only consulted when restoring a session offline. Online this would be
 * redundant — the server rejects an expired token itself — but offline nothing
 * else can catch it, and dropping someone into a dashboard whose every request
 * will 401 the moment signal returns is worse than asking them to log in.
 *
 * A token that cannot be decoded is reported as NOT expired. This is a
 * convenience check, not a security boundary: the signature is verified by the
 * server and cannot be verified here, so anything unreadable is left for the
 * API to reject.
 */
export function isTokenExpired(token: string): boolean {
  try {
    const payload = token.split('.')[1];
    if (!payload) return false;

    // JWT uses base64url; atob expects standard base64.
    const normalised = payload.replace(/-/g, '+').replace(/_/g, '/');
    const padded = normalised.padEnd(Math.ceil(normalised.length / 4) * 4, '=');

    const claims = JSON.parse(atob(padded)) as { exp?: number };
    if (typeof claims.exp !== 'number') return false;

    // `exp` is seconds since the epoch; Date.now() is milliseconds.
    return claims.exp * 1000 <= Date.now();
  } catch {
    return false;
  }
}
