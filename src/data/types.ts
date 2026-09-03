/**
 * Mirrors the FastAPI schemas in `app/schemas/`. When the real API is wired up
 * in the next phase these types should not need to change.
 *
 * One deliberate difference: the API sends money as DECIMAL strings ("600.00")
 * to avoid float rounding. The mock keeps plain numbers; `parseAmount` in
 * `src/lib/money.ts` is the single place that will absorb that difference.
 */

export type UserRole = 'worker' | 'contractor';
export type AttendanceStatus = 'present' | 'half_day' | 'absent';
export type TransactionType = 'wage' | 'advance' | 'payment';

export type User = {
  id: number;
  name: string;
  phone: string;
  role: UserRole;
  daily_wage: number | null;
  contractor_id: number | null;
  is_active: boolean;
};

export type Transaction = {
  id: number;
  worker_id: number;
  type: TransactionType;
  amount: number;
  /** ISO date, YYYY-MM-DD. */
  date: string;
  note: string | null;
};

export type Attendance = {
  id: number;
  worker_id: number;
  /** ISO date, YYYY-MM-DD. */
  date: string;
  status: AttendanceStatus;
  note: string | null;
};

export type BalanceSummary = {
  total_wages: number;
  total_advances: number;
  total_payments: number;
  /** wages - advances - payments; positive means the contractor still owes. */
  balance: number;
};

/** One row in the worker's history — attendance and cash, interleaved. */
export type LedgerEntry =
  | { kind: 'transaction'; date: string; id: number; transaction: Transaction }
  | { kind: 'attendance'; date: string; id: number; attendance: Attendance };
