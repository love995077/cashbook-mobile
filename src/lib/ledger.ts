import type { Attendance, LedgerEntry, Transaction } from '@/data/types';

/**
 * Interleave cash and attendance into one history, newest first.
 *
 * Balances are NOT computed here — `calculate_balance` in
 * `app/services/ledger.py` is the single source of truth, and every response
 * that carries rows also carries the balance the server derived from them.
 * Recomputing client-side would only create a second answer that can drift.
 */
export function buildLedgerEntries(
  transactions: Transaction[],
  attendance: Attendance[]
): LedgerEntry[] {
  const entries: LedgerEntry[] = [
    ...transactions.map(
      (transaction): LedgerEntry => ({
        kind: 'transaction',
        date: transaction.date,
        id: transaction.id,
        transaction,
      })
    ),
    ...attendance.map(
      (record): LedgerEntry => ({
        kind: 'attendance',
        date: record.date,
        id: record.id,
        attendance: record,
      })
    ),
  ];

  return entries.sort((a, b) => {
    if (a.date !== b.date) return a.date < b.date ? 1 : -1;
    // Same day: cash first, then attendance, then newest id.
    if (a.kind !== b.kind) return a.kind === 'transaction' ? -1 : 1;
    return b.id - a.id;
  });
}
