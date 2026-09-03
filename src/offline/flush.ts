/**
 * Drains the offline queue against the API.
 *
 * The rules for each outcome are the whole point of this file — see the replay
 * safety note in `queue.ts` before loosening any of them.
 */

import { ApiError } from '@/api/client';
import { createAttendance, createTransaction } from '@/api/endpoints';
import { TRANSACTION_RETRY_IS_SAFE, type QueuedItem } from '@/offline/queue';

export type FlushResult = {
  /** Items still to send — kept in order. */
  remaining: QueuedItem[];
  synced: number;
  /** Items abandoned, with the reason, for the UI to surface. */
  failed: QueuedItem[];
  /** True when the queue stopped early because the network is still down. */
  stoppedOffline: boolean;
};

export async function flushQueue(token: string, items: QueuedItem[]): Promise<FlushResult> {
  const remaining: QueuedItem[] = [];
  const failed: QueuedItem[] = [];
  let synced = 0;
  let stoppedOffline = false;

  for (const [index, item] of items.entries()) {
    if (stoppedOffline) {
      // Still offline — everything after this keeps its place in the queue.
      remaining.push(item);
      continue;
    }

    const attempted: QueuedItem = { ...item, attempts: item.attempts + 1 };

    try {
      if (attempted.kind === 'attendance') {
        await createAttendance(token, attempted.payload);
      } else {
        await createTransaction(token, attempted.payload);
      }
      synced += 1;
      continue;
    } catch (caught) {
      if (!(caught instanceof ApiError)) {
        failed.push({ ...attempted, failure: 'Something went wrong sending this entry.' });
        continue;
      }

      // Never reached the server: safe to retry anything, later.
      if (caught.isNetworkError) {
        if (attempted.kind === 'transaction' && !TRANSACTION_RETRY_IS_SAFE && attempted.attempts > 1) {
          // A second network failure on a money entry is where the ambiguity
          // bites: it may have committed on the first attempt with the reply
          // lost. Stop guessing and let the contractor decide.
          failed.push({
            ...attempted,
            failure:
              'Could not confirm this entry reached the server. Check the ledger before adding it again.',
          });
          continue;
        }
        remaining.push(attempted);
        stoppedOffline = true;
        // Preserve order for everything after this one.
        for (const later of items.slice(index + 1)) remaining.push(later);
        break;
      }

      // The server already has this attendance for that date. The unique index
      // did its job — the entry is recorded, so drop it.
      if (attempted.kind === 'attendance' && caught.status === 409) {
        synced += 1;
        continue;
      }

      // Session died. Keep the queue intact; it flushes after the next login.
      if (caught.isUnauthorized) {
        remaining.push(attempted);
        for (const later of items.slice(index + 1)) remaining.push(later);
        stoppedOffline = true;
        break;
      }

      // Server-side trouble: worth another try later.
      if (caught.status >= 500) {
        remaining.push(attempted);
        continue;
      }

      // 400/403/404/422 — the request itself is wrong (worker deleted, bad
      // amount). Retrying cannot fix it.
      failed.push({ ...attempted, failure: caught.message });
    }
  }

  return { remaining, synced, failed, stoppedOffline };
}
