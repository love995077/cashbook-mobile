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
 *   Transactions are SAFE now, and were not. There is no natural key — two
 *   identical advances on the same day are a legitimate thing to record — so
 *   a replay used to create a second row and charge the worker twice. Since
 *   `transactions.client_ref` exists (a nullable UNIQUE column, exactly like
 *   `cash_entries.client_ref`), `POST /contractor/transactions` returns the
 *   stored row when a key repeats, so a replay is a no-op no matter how the
 *   first attempt ended.
 *
 *   Cash entries (general expenses) are SAFE, by the same mechanism.
 *
 * THE KEY MUST BE THE SAME ON EVERY ATTEMPT
 * -----------------------------------------
 * The store mints the `clientRef` BEFORE the first online attempt and hands
 * the same one to `enqueue` if that attempt fails on the network. The
 * ambiguous case - a request that arrived, committed, and lost its response
 * to a timeout - is then replayed under the key the server already has, and
 * deduplicated. A fresh key per attempt would defeat the whole thing.
 *
 * Payroll settlement is still never queued: it is computed from the balance
 * at the moment it is sent, and replaying it hours later would settle a
 * different figure.
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

/** The server deduplicates transactions on clientRef - see the note above. */
export const TRANSACTION_RETRY_IS_SAFE = true;

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
    /** Where the day was worked. Absent on items queued by older builds. */
    site_id?: number | null;
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
    site_id?: number | null;
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
    site_id?: number | null;
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
  item: QueuedAttendance | QueuedTransaction | QueuedCashEntry,
  /** The key the first (failed) attempt already used - see the note above. */
  clientRef: string = makeClientRef()
): Promise<QueuedItem[]> {
  const queued: QueuedItem = {
    ...item,
    clientRef,
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
