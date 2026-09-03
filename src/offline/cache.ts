/**
 * Last-known dashboard state, persisted so the app has something to show
 * before the network answers — or at all, if it never does.
 *
 * AsyncStorage rather than expo-sqlite: what is stored is one JSON blob per
 * user, read whole and written whole. There are no queries to run, so a
 * database would be machinery without a purpose. If the ledger ever grows to
 * the point where partial reads or per-row updates matter, SQLite is the
 * upgrade path.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';

import type { WorkerLedger } from '@/api/endpoints';
import type { BalanceSummary, User } from '@/data/types';

/** Bump when the cached shape changes; older payloads are then ignored. */
const CACHE_VERSION = 1;

const keyFor = (userId: number) => `cashbook.cache.v${CACHE_VERSION}.user.${userId}`;

export type CachedDashboard = {
  version: number;
  /** When this was written, so the UI can say how stale it is. */
  cachedAt: number;
  workers: (User & { balance: BalanceSummary })[];
  ledgers: WorkerLedger[];
  myLedger: WorkerLedger | null;
};

export async function readCache(userId: number): Promise<CachedDashboard | null> {
  try {
    const raw = await AsyncStorage.getItem(keyFor(userId));
    if (!raw) return null;

    const parsed = JSON.parse(raw) as CachedDashboard;
    // A payload from an older build may not match the current types.
    if (parsed?.version !== CACHE_VERSION) return null;
    return parsed;
  } catch {
    // Corrupt or unreadable cache is the same as no cache — never a crash on
    // launch.
    return null;
  }
}

export async function writeCache(
  userId: number,
  data: Omit<CachedDashboard, 'version' | 'cachedAt'>
): Promise<void> {
  try {
    const payload: CachedDashboard = { ...data, version: CACHE_VERSION, cachedAt: Date.now() };
    await AsyncStorage.setItem(keyFor(userId), JSON.stringify(payload));
  } catch {
    // A full disk should not break the app; the next load just goes to network.
  }
}

/** Called on sign-out — one user's ledger must not be visible to the next. */
export async function clearCache(userId: number): Promise<void> {
  try {
    await AsyncStorage.removeItem(keyFor(userId));
  } catch {
    // Already gone.
  }
}
