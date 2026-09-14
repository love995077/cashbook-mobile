/**
 * Durable queue of writes made while offline.
 *
 * Items are appended as the user works, persisted immediately, and drained in
 * order once the connection returns.
 *
 * ---------------------------------------------------------------------------
 * REPLAY SAFETY — read this before changing the flush rules
 * ---------------------------------------------------------------------------
 * Retrying a write that already succeeded is the hazard in any offline queue.
 * The two kinds here are not equally exposed:
 *
 *   Attendance is SAFE. The server has a unique index on (worker_id, date), so
 *   a replay comes back 409 and the flusher treats that as "already recorded"
 *   and drops the item. The database is the dedupe.
 *
 *   Transactions are NOT. There is no natural key — two identical advances on
 *   the same day are a legitimate thing to record — so a replay creates a
 *   second row and the worker is charged twice.
 *
 *   Cash entries (general expenses) are SAFE, and are the model for the fix:
 *   `POST /contractor/cash-entries` stores the `clientRef` below in a UNIQUE
 *   column and returns the existing row when it repeats, so a replay is a
 *   no-op no matter how the first attempt ended.
 *
 * The mitigation for transactions is to retry only when the request failed
 * before reaching the server. That covers the common case (airplane mode, no
 * signal) but NOT the ambiguous one: a request that arrived, committed, and
 * whose response was lost to a timeout is indistinguishable from one that
 * never landed.
 *
 * The same fix belongs on `transactions`: accept the `clientRef` as an
 * idempotency key, store it in a nullable UNIQUE column, and return the
 * existing row instead of inserting when it repeats - exactly what
 * `cash_entries.client_ref` already does. Until then,
 * `TRANSACTION_RETRY_IS_SAFE` stays false and ambiguous transaction failures
 * are surfaced to the user rather than retried silently.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';

import type {
  AttendanceStatus,
  CashDirection,
  PaymentMode,
  TransactionType,
  WorkShift,
} from '@/data/types';

const QUEUE_VERSION = 1;
const keyFor = (userId: number) => `cashbook.queue.v${QUEUE_VERSION}.user.${userId}`;

/** Flip to true only once the server deduplicates on clientRef. */
export const TRANSACTION_RETRY_IS_SAFE = false;

/** Cash entries already deduplicate server-side, so a replay is harmless. */
export const CASH_RETRY_IS_SAFE = true;

export type QueuedAttendance = {
  kind: 'attendance';
  payload: {
    worker_id: number;
    date: string;
    status: AttendanceStatus;
    // Optional so a queue item written by an older build still replays; the
    // API defaults it to a day shift, same as the column's backfill.
    shift?: WorkShift;
    note?: string | null;
  };
};

export type QueuedTransaction = {
  kind: 'transaction';
  payload: {
    worker_id: number;
    type: TransactionType;
    amount: number;
    date: string;
    /** Optional so items queued by an older build still replay. */
    payment_mode?: PaymentMode | null;
    note?: string | null;
  };
};

export type QueuedCashEntry = {
  kind: 'cash';
  payload: {
    category_id: number | null;
    direction: CashDirection;
    amount: number;
    date: string;
    note?: string | null;
  };
};

export type QueuedItem = (QueuedAttendance | QueuedTransaction | QueuedCashEntry) & {
  /** Local id, and the idempotency key the server should eventually honour. */
  clientRef: string;
  createdAt: number;
  attempts: number;
  /** Set when a flush gave up on this item; kept so the UI can explain why. */
  failure?: string;
};

/**
 * Hermes has no crypto.randomUUID, and a queue key does not need to be
 * cryptographically strong — only unique on this device.
 */
export function makeClientRef(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

export async function readQueue(userId: number): Promise<QueuedItem[]> {
  try {
    const raw = await AsyncStorage.getItem(keyFor(userId));
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as QueuedItem[]) : [];
  } catch {
    return [];
  }
}

async function writeQueue(userId: number, items: QueuedItem[]): Promise<void> {
  try {
    await AsyncStorage.setItem(keyFor(userId), JSON.stringify(items));
  } catch {
    // Nothing useful to do — the item stays in memory for this session.
  }
}

export async function enqueue(
  userId: number,
  item: QueuedAttendance | QueuedTransaction | QueuedCashEntry
): Promise<QueuedItem[]> {
  const queued: QueuedItem = {
    ...item,
    clientRef: makeClientRef(),
    createdAt: Date.now(),
    attempts: 0,
  };
  const next = [...(await readQueue(userId)), queued];
  await writeQueue(userId, next);
  return next;
}

export async function replaceQueue(userId: number, items: QueuedItem[]): Promise<void> {
  await writeQueue(userId, items);
}

export async function clearQueue(userId: number): Promise<void> {
  try {
    await AsyncStorage.removeItem(keyFor(userId));
  } catch {
    // Already gone.
  }
}
