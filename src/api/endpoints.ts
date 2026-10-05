/**
 * One function per backend route, plus the mapping from wire shapes to the
 * domain types in `src/data/types.ts`.
 *
 * The API sends DECIMAL columns as strings ("600.00") so money never rides on
 * a float. Everything is parsed here, at the edge, so no screen has to think
 * about it.
 */

import { request } from '@/api/client';
import { appendFile } from '@/api/upload';
import type {
  AdvanceRequest,
  AdvanceRequestStatus,
  AnalyticsPeriod,
  AnalyticsSeries,
  Attendance,
  AttendanceStatus,
  AutoDeduction,
  BalanceSummary,
  BulkAttendanceMark,
  BulkAttendanceResult,
  CashCategory,
  CashDirection,
  CashEntry,
  CashSummary,
  DeductionInstallment,
  Invoice,
  InvoiceLine,
  InvoicePreview,
  InvoiceStatus,
  LedgerEntry,
  MachineryLog,
  MachineryTotals,
  MachineUsage,
  MaterialReceipt,
  MaterialUnit,
  OutstandingTools,
  PayrollSettlement,
  PayrollSummary,
  PaymentMode,
  PettyCashEntry,
  PettyCashTotals,
  PieceRateLog,
  RainOutResult,
  Site,
  SiteInventoryItem,
  SitePhoto,
  Tool,
  ToolAssignment,
  ToolAssignmentStatus,
  Transaction,
  TransactionType,
  UploadedMedia,
  User,
  UserRole,
  WageType,
  WorkerTrade,
  WorkShift,
  ReconcileReport,
  SiteOverview,
  WageAudit,
  WageIssue,
  WorkerSaveResult,
} from '@/data/types';
import { buildLedgerEntries } from '@/lib/ledger';
import { parseAmount } from '@/lib/money';

// --- wire shapes (exactly what FastAPI returns) ---------------------------

type WireUser = {
  id: number;
  name: string;
  /** Nullable: a worker can be on the crew with no number and no account. */
  phone: string | null;
  role: UserRole;
  daily_wage: string | null;
  trade: WorkerTrade | null;
  wage_type: WageType | null;
  site_id: number | null;
  contractor_id: number | null;
  is_active: boolean;
  /** Absent from servers older than the column, and from cached rows. */
  deactivated_on?: string | null;
  created_at: string;
  updated_at: string;
};

/** A worker as saved, with what the save did to days already marked. */
type WireWorkerSaved = WireUser & {
  days_priced?: number;
  days_repriced?: number;
};

type WireTransaction = {
  id: number;
  worker_id: number;
  type: TransactionType;
  amount: string;
  date: string;
  payment_mode: PaymentMode | null;
  note: string | null;
  audio_note_url: string | null;
  site_id?: number | null;
};

type WireAttendance = {
  id: number;
  worker_id: number;
  date: string;
  status: AttendanceStatus;
  shift: WorkShift | null;
  note: string | null;
  site_id: number | null;
  /** Money as a string, like every DECIMAL; absent from older servers. */
  wage_rate?: string | null;
  is_disputed: boolean;
  audio_note_url: string | null;
};

type WireBalance = {
  total_wages: string;
  total_advances: string;
  total_payments: string;
  balance: string;
};

type WireLedger = {
  worker: WireUser;
  balance: WireBalance;
  transactions: WireTransaction[];
  attendance: WireAttendance[];
};

type WireToken = {
  access_token: string;
  token_type: string;
  expires_in: number;
  user: WireUser;
};

// --- mappers ---------------------------------------------------------------

function toUser(wire: WireUser): User {
  return {
    id: wire.id,
    name: wire.name,
    phone: wire.phone,
    role: wire.role,
    daily_wage: wire.daily_wage === null ? null : parseAmount(wire.daily_wage),
    // A build that predates a trade the server knows about still parses; the
    // badge helper is what decides it has nothing to draw.
    trade: wire.trade ?? null,
    // Defaulted rather than trusted: a row cached by a build that predates
    // the column has no wage_type, and every worker back then was daily.
    wage_type: wire.wage_type ?? 'daily',
    site_id: wire.site_id ?? null,
    contractor_id: wire.contractor_id,
    is_active: wire.is_active,
    deactivated_on: wire.deactivated_on ?? null,
  };
}

function toWorkerSaved(wire: WireWorkerSaved): WorkerSaveResult {
  return {
    worker: toUser(wire),
    daysPriced: wire.days_priced ?? 0,
    daysRepriced: wire.days_repriced ?? 0,
  };
}

function toTransaction(wire: WireTransaction): Transaction {
  return {
    ...wire,
    amount: parseAmount(wire.amount),
    payment_mode: wire.payment_mode ?? null,
    audio_note_url: wire.audio_note_url ?? null,
    site_id: wire.site_id ?? null,
  };
}

function toAttendance(wire: WireAttendance): Attendance {
  // Defaulted rather than trusted: a cached row written by an older build
  // predates these fields entirely.
  return {
    ...wire,
    site_id: wire.site_id ?? null,
    // A string on the wire like every DECIMAL; parsed here, once.
    wage_rate: wire.wage_rate == null ? null : parseAmount(wire.wage_rate),
    // A cached row written before the column existed was a day shift, which
    // is exactly what the backfill decided for the stored rows too.
    shift: wire.shift ?? 'day',
    is_disputed: wire.is_disputed ?? false,
    audio_note_url: wire.audio_note_url ?? null,
  };
}

function toBalance(wire: WireBalance): BalanceSummary {
  return {
    total_wages: parseAmount(wire.total_wages),
    total_advances: parseAmount(wire.total_advances),
    total_payments: parseAmount(wire.total_payments),
    balance: parseAmount(wire.balance),
  };
}

// --- auth ------------------------------------------------------------------

export type Session = { token: string; user: User; expiresIn: number };

function toSession(wire: WireToken): Session {
  return {
    token: wire.access_token,
    user: toUser(wire.user),
    expiresIn: wire.expires_in,
  };
}

export async function login(phone: string, password: string): Promise<Session> {
  const wire = await request<WireToken>('/auth/login', {
    method: 'POST',
    body: { phone: phone.trim(), password },
  });
  return toSession(wire);
}

export async function register(input: {
  name: string;
  phone: string;
  password: string;
  role: UserRole;
  daily_wage?: number | null;
  contractor_id?: number | null;
}): Promise<Session> {
  const wire = await request<WireToken>('/auth/register', {
    method: 'POST',
    body: {
      name: input.name.trim(),
      phone: input.phone.trim(),
      password: input.password,
      role: input.role,
      // The API rejects these outright for contractors, so only send them
      // when they carry a value.
      ...(input.daily_wage != null ? { daily_wage: String(input.daily_wage) } : {}),
      ...(input.contractor_id != null ? { contractor_id: input.contractor_id } : {}),
    },
  });
  return toSession(wire);
}

export async function me(token: string): Promise<User> {
  return toUser(await request<WireUser>('/auth/me', { token }));
}

// --- worker ----------------------------------------------------------------

/** Just enough of a site to name it and point a map at it. */
export type SiteBrief = { id: number; name: string; address: string | null };

/** The worker's own record, with the site they are posted to. */
export type WorkerProfile = User & { site: SiteBrief | null };

/**
 * The worker's own record, including their site.
 *
 * One call answers the three things the dashboard opens with: the id that
 * goes in the QR code, the site name, and the address to hand to Maps.
 */
export async function fetchMyProfile(
  token: string,
  signal?: AbortSignal
): Promise<WorkerProfile> {
  const wire = await request<WireUser & { site: SiteBrief | null }>('/worker/me', {
    token,
    signal,
  });
  return { ...toUser(wire), site: wire.site ?? null };
}

export type WorkerLedger = {
  worker: User;
  balance: BalanceSummary;
  entries: LedgerEntry[];
};

function toLedger(wire: WireLedger): WorkerLedger {
  const transactions = wire.transactions.map(toTransaction);
  const attendance = wire.attendance.map(toAttendance);
  return {
    worker: toUser(wire.worker),
    balance: toBalance(wire.balance),
    entries: buildLedgerEntries(transactions, attendance),
  };
}

export async function fetchMyLedger(token: string, signal?: AbortSignal): Promise<WorkerLedger> {
  return toLedger(await request<WireLedger>('/worker/ledger', { token, signal }));
}

// --- contractor ------------------------------------------------------------

export async function fetchWorkers(
  token: string,
  signal?: AbortSignal,
  options: {
    /** Deactivated workers too - their ledgers are kept, so they can be opened. */
    includeInactive?: boolean;
    /** One site's crew; 0 for the workers posted nowhere. */
    siteId?: number;
  } = {}
): Promise<User[]> {
  const params = new URLSearchParams();
  if (options.includeInactive) params.set('include_inactive', 'true');
  if (options.siteId != null) params.set('site_id', String(options.siteId));
  const query = params.toString();
  const wire = await request<WireUser[]>(`/contractor/workers${query ? `?${query}` : ''}`, {
    token,
    signal,
  });
  return wire.map(toUser);
}

/**
 * The contractor's supervisors, for the picker on the site screen.
 *
 * The same route as the crew above with `role=supervisor`. Admin only — the
 * API refuses a supervisor asking to enumerate the others.
 */
export async function fetchSupervisors(
  token: string,
  signal?: AbortSignal
): Promise<User[]> {
  const wire = await request<WireUser[]>('/contractor/workers?role=supervisor', {
    token,
    signal,
  });
  return wire.map(toUser);
}

export async function fetchWorkerLedger(
  token: string,
  workerId: number,
  signal?: AbortSignal
): Promise<WorkerLedger> {
  return toLedger(
    await request<WireLedger>(`/contractor/workers/${workerId}/ledger`, { token, signal })
  );
}

export async function createTransaction(
  token: string,
  input: {
    worker_id: number;
    type: TransactionType;
    amount: number;
    date: string;
    payment_mode?: PaymentMode | null;
    note?: string | null;
    audio_note_path?: string | null;
    /**
     * Opens an installment plan against this advance, recovering this much
     * per day worked. Advances only — the API rejects it on anything else.
     */
    daily_deduction?: number | null;
    /**
     * The idempotency key. A repeat of a key the server already stored gets
     * the stored row back instead of a second advance - which is what makes
     * the offline queue safe to replay money.
     */
    client_ref?: string | null;
    /** The site this money belongs to. Omitted: where the worker is posted. */
    site_id?: number | null;
  }
): Promise<Transaction> {
  const wire = await request<WireTransaction>('/contractor/transactions', {
    method: 'POST',
    token,
    // Send the amount as a string so the decimal survives the trip exactly.
    body: {
      ...input,
      amount: input.amount.toFixed(2),
      // Omitted rather than null for a wage: the API rejects a payment mode on
      // money that was earned rather than handed over.
      ...(input.payment_mode ? { payment_mode: input.payment_mode } : {}),
      ...(input.audio_note_path ? { audio_note_path: input.audio_note_path } : {}),
      // Omitted rather than null: sending it at all is what opens a plan.
      ...(input.daily_deduction
        ? { daily_deduction: input.daily_deduction.toFixed(2) }
        : {}),
      ...(input.client_ref ? { client_ref: input.client_ref } : {}),
      ...(input.site_id ? { site_id: input.site_id } : {}),
      note: input.note ?? null,
    },
  });
  return toTransaction(wire);
}

/**
 * Undo a mistyped ledger entry.
 *
 * Never queued for offline replay, for the same reason as `logTransaction`:
 * without an idempotency key a retried delete can only be told apart from a
 * fresh one by the 404 it gets back, and the caller wants to know about that.
 *
 * Rejects with a 409 when other rows were built on the entry — an installment
 * plan, an approved advance request, or a piece-rate log. The message names
 * what to unwind first, so surface it rather than swallowing it.
 */
export async function deleteTransaction(
  token: string,
  transactionId: number
): Promise<void> {
  await request<void>(`/contractor/transactions/${transactionId}`, {
    method: 'DELETE',
    token,
  });
}

export async function createAttendance(
  token: string,
  input: {
    worker_id: number;
    date: string;
    status: AttendanceStatus;
    shift?: WorkShift;
    note?: string | null;
    /** Where the day was worked. Omitted: wherever the worker is posted. */
    site_id?: number | null;
  }
): Promise<Attendance> {
  const { site_id, ...rest } = input;
  const wire = await request<WireAttendance>('/contractor/attendance', {
    method: 'POST',
    token,
    body: {
      ...rest,
      shift: input.shift ?? 'day',
      note: input.note ?? null,
      ...(site_id ? { site_id } : {}),
    },
  });
  return toAttendance(wire);
}

/**
 * Correct a day that was already marked.
 *
 * Only the fields sent are changed. Changing the status re-settles that day's
 * installment server-side, so a day corrected to absent gives back the
 * deduction it had taken.
 *
 * A 409 means the worker is already marked for the date the row was moved
 * onto — the server will not merge two days into one.
 */
export async function updateAttendance(
  token: string,
  attendanceId: number,
  changes: {
    date?: string;
    status?: AttendanceStatus;
    shift?: WorkShift;
    note?: string | null;
  }
): Promise<Attendance> {
  const wire = await request<WireAttendance>(`/contractor/attendance/${attendanceId}`, {
    method: 'PATCH',
    token,
    body: changes,
  });
  return toAttendance(wire);
}

/**
 * Unmark a day that should never have been marked at all.
 *
 * Different from `updateAttendance`, which fixes a day that happened and was
 * recorded wrong. This is for the day that did not happen to this worker: the
 * wrong name tapped in the grid. Correcting that to `absent` would still leave
 * them on the roster for a day they were never on, so the row goes instead.
 *
 * The date frees up afterwards - which is the point, because the worker who
 * WAS there still has to be marked, and the unique on (worker, date) was
 * refusing that while the wrong row stood.
 *
 * A 409 means the day paid piece-rate wages and the log has to be removed
 * first; the server will not leave money paid for a day nobody worked.
 */
export async function deleteAttendance(
  token: string,
  attendanceId: number
): Promise<void> {
  await request<void>(`/contractor/attendance/${attendanceId}`, {
    method: 'DELETE',
    token,
  });
}

/**
 * Take a worker off the crew.
 *
 * Deactivates by default; the row and its whole ledger survive, and the
 * worker stays recorded against their site so its reports keep their days.
 * `lastDay` is the last day they worked (default: today) - days up to it can
 * still be marked, days after it are refused by every marking route.
 *
 * `purge` hard deletes and the API refuses it once the worker has any
 * history, so it is only ever the undo for a name typed wrong a minute ago.
 */
export async function deleteWorker(
  token: string,
  workerId: number,
  options: { purge?: boolean; lastDay?: string } = {}
): Promise<void> {
  const params = new URLSearchParams();
  if (options.purge) params.set('purge', 'true');
  if (options.lastDay) params.set('last_day', options.lastDay);
  const query = params.toString();
  await request<void>(`/contractor/workers/${workerId}${query ? `?${query}` : ''}`, {
    method: 'DELETE',
    token,
  });
}

// --- advance requests -------------------------------------------------------

type WireAdvanceRequest = {
  id: number;
  worker_id: number;
  worker_name: string | null;
  amount: string;
  reason: string | null;
  status: AdvanceRequestStatus;
  transaction_id: number | null;
  decided_at: string | null;
  created_at: string;
  audio_note_url: string | null;
};

function toAdvanceRequest(wire: WireAdvanceRequest): AdvanceRequest {
  return {
    ...wire,
    amount: parseAmount(wire.amount),
    worker_name: wire.worker_name ?? null,
    audio_note_url: wire.audio_note_url ?? null,
  };
}

/** The contractor's approvals queue. Pending only, unless asked otherwise. */
export async function fetchAdvanceRequests(
  token: string,
  options: { status?: AdvanceRequestStatus } = {},
  signal?: AbortSignal
): Promise<AdvanceRequest[]> {
  const query = options.status ? `?status=${options.status}` : '';
  const wire = await request<WireAdvanceRequest[]>(
    `/contractor/advance-requests${query}`,
    { token, signal }
  );
  return wire.map(toAdvanceRequest);
}

/**
 * Approve or reject one request.
 *
 * Approving writes the matching ADVANCE transaction server-side, so the
 * worker's balance moves as part of the same call - the caller must refresh.
 */
export async function decideAdvanceRequest(
  token: string,
  requestId: number,
  input: {
    status: Exclude<AdvanceRequestStatus, 'pending'>;
    /** Approve a different figure to the one asked for. Omit to accept it. */
    approved_amount?: number | null;
    /** How it was handed over. Ignored on a rejection - no money moves. */
    payment_mode?: PaymentMode | null;
    note?: string | null;
  }
): Promise<AdvanceRequest> {
  const wire = await request<WireAdvanceRequest>(
    `/contractor/advance-requests/${requestId}`,
    { method: 'PATCH', token, body: input }
  );
  return toAdvanceRequest(wire);
}

/** A worker asking for money before payday. */
export async function createAdvanceRequest(
  token: string,
  input: { amount: number; reason?: string | null; audio_note_path?: string | null }
): Promise<AdvanceRequest> {
  const wire = await request<WireAdvanceRequest>('/worker/advance-requests', {
    method: 'POST',
    token,
    body: { ...input, reason: input.reason?.trim() || null },
  });
  return toAdvanceRequest(wire);
}

/** The signed-in worker's own requests. */
export async function fetchMyAdvanceRequests(
  token: string,
  signal?: AbortSignal
): Promise<AdvanceRequest[]> {
  const wire = await request<WireAdvanceRequest[]>('/worker/advance-requests', {
    token,
    signal,
  });
  return wire.map(toAdvanceRequest);
}

/**
 * A worker flagging one attendance row as wrong.
 *
 * Does not change the status or the balance by itself - it is a "come and
 * look at this" that the contractor clears in person.
 */
export async function disputeAttendance(
  token: string,
  attendanceId: number,
  input: { disputed?: boolean; audio_note_path?: string | null } = {}
): Promise<Attendance> {
  const wire = await request<WireAttendance>(
    `/worker/attendance/${attendanceId}/dispute`,
    { method: 'PATCH', token, body: { disputed: input.disputed ?? true, ...input } }
  );
  return toAttendance(wire);
}

/**
 * Mark a worker present from a scan of their QR code.
 *
 * An idempotent upsert server-side, not a create: a camera fires the same code
 * many times a second and a contractor walking the line will re-scan someone
 * they are unsure about. Neither is an error.
 */
export async function scanAttendance(
  token: string,
  input: { worker_id: number; date?: string; status?: AttendanceStatus; shift?: WorkShift }
): Promise<Attendance> {
  const wire = await request<WireAttendance>('/contractor/attendance/scan', {
    method: 'POST',
    token,
    body: { status: 'present', shift: 'day', ...input },
  });
  return toAttendance(wire);
}

export async function createWorker(
  token: string,
  input: {
    name: string;
    /** Optional. Omitted entirely when absent — a worker with no account. */
    phone?: string | null;
    /** Optional, and useless without a phone: sign-in is by number. */
    password?: string | null;
    daily_wage?: number | null;
    trade?: WorkerTrade | null;
    wage_type?: WageType;
    site_id?: number | null;
  }
): Promise<User> {
  const wire = await request<WireUser>('/contractor/workers', {
    method: 'POST',
    token,
    body: {
      name: input.name.trim(),
      // Omitted rather than sent as null. The schema's `Phone` and `Password`
      // types have a minimum length, so an empty string is a 422 where an
      // absent key is simply "not recorded".
      ...(input.phone?.trim() ? { phone: input.phone.trim() } : {}),
      ...(input.password ? { password: input.password } : {}),
      ...(input.daily_wage != null ? { daily_wage: input.daily_wage.toFixed(2) } : {}),
      ...(input.trade?.trim() ? { trade: input.trade.trim() } : {}),
      // Omitted rather than sent as 'daily': the server defaults it, and one
      // default beats two that could drift apart.
      ...(input.wage_type ? { wage_type: input.wage_type } : {}),
      ...(input.site_id != null ? { site_id: input.site_id } : {}),
    },
  });
  return toUser(wire);
}

/**
 * Change a worker's details — chiefly which site they are posted to.
 *
 * `site_id: null` is sent explicitly to unpost them, so this builds the body
 * from the keys actually present rather than dropping nulls the way the
 * create call does.
 */
/**
 * Save the whole of a worker's edit form.
 *
 * PUT, not PATCH: an absent field here means "empty", which is the only way
 * the form can CLEAR a day rate typed by mistake rather than merely overwrite
 * it. `updateWorker` below stays for the app's one-field writes - posting to
 * a site, deactivating - where "leave everything else alone" is what is
 * meant.
 *
 * Days already worked keep the rate they were worked at; changing the wage
 * here is not a rewrite of the books.
 */
export async function replaceWorker(
  token: string,
  workerId: number,
  details: {
    name: string;
    daily_wage?: number | null;
    trade?: WorkerTrade | null;
    wage_type?: WageType;
    site_id?: number | null;
    is_active?: boolean;
    /**
     * Move days already marked onto the new rate - the fix for a rate typed
     * wrong. Off by default: a raise is not a rewrite of last month.
     */
    reprice_existing?: boolean;
  }
): Promise<WorkerSaveResult> {
  const wire = await request<WireWorkerSaved>(`/contractor/workers/${workerId}`, {
    method: 'PUT',
    token,
    body: {
      name: details.name.trim(),
      // Serialised as a string like every other money field on the wire, and
      // null when there is no rate rather than 0 - which would be a real
      // wage of nothing.
      daily_wage:
        details.daily_wage == null ? null : details.daily_wage.toFixed(2),
      trade: details.trade ?? null,
      wage_type: details.wage_type ?? 'daily',
      // 0 is the API's "not posted anywhere"; null would fail its ge=0 check.
      site_id: details.site_id ?? 0,
      is_active: details.is_active ?? true,
      reprice_existing: details.reprice_existing ?? false,
    },
  });
  return toWorkerSaved(wire);
}

export async function updateWorker(
  token: string,
  workerId: number,
  changes: {
    name?: string;
    daily_wage?: number | null;
    trade?: WorkerTrade | null;
    wage_type?: WageType;
    site_id?: number | null;
    is_active?: boolean;
  }
): Promise<User> {
  const body: Record<string, unknown> = { ...changes };
  if (changes.name != null) body.name = changes.name.trim();
  if (changes.daily_wage != null) body.daily_wage = changes.daily_wage.toFixed(2);
  // The API takes 0 as "no site"; null would be dropped by exclude_unset.
  if ('site_id' in changes) body.site_id = changes.site_id ?? 0;

  const wire = await request<WireWorkerSaved>(`/contractor/workers/${workerId}`, {
    method: 'PATCH',
    token,
    body,
  });
  return toUser(wire);
}

/** Put a deactivated worker back on the crew. Their days can be marked again. */
export async function reactivateWorker(token: string, workerId: number): Promise<User> {
  return updateWorker(token, workerId, { is_active: true });
}

// --- voice entry (Phase 6) -------------------------------------------------

type WireVoiceEntry = {
  worker_id: number | null;
  type: TransactionType;
  amount: string;
  date: string;
  note: string | null;
  confidence: number;
};

type WireVoiceResponse = {
  status: 'recorded' | 'needs_confirmation' | 'not_understood';
  transcript: string;
  message: string;
  created: WireTransaction[];
  pending: WireVoiceEntry[];
  problems: string[];
};

export type VoiceEntryResult = {
  status: 'recorded' | 'needs_confirmation' | 'not_understood';
  transcript: string;
  message: string;
  created: Transaction[];
  pending: {
    worker_id: number | null;
    type: TransactionType;
    amount: number;
    date: string;
    note: string | null;
    confidence: number;
  }[];
  problems: string[];
};

/**
 * Upload a recording to POST /api/voice-entry.
 *
 * The file part is built by `appendFile`: streamed off disk on native, read
 * back out of the recorder's blob: URL on web. Do not read the recording into
 * memory here — a long clip will not fit comfortably.
 */
export async function uploadVoiceEntry(
  token: string,
  recording: { uri: string; name?: string; mimeType?: string },
  options: { workerId?: number | null; language?: string } = {}
): Promise<VoiceEntryResult> {
  const form = new FormData();

  await appendFile(form, 'audio', recording, {
    name: 'recording.m4a',
    type: 'audio/m4a',
  });

  if (options.workerId != null) form.append('worker_id', String(options.workerId));
  form.append('language', options.language ?? 'hi');

  const wire = await request<WireVoiceResponse>('/api/voice-entry', {
    method: 'POST',
    token,
    body: form,
  });

  return {
    status: wire.status,
    transcript: wire.transcript,
    message: wire.message,
    created: wire.created.map(toTransaction),
    pending: wire.pending.map((entry) => ({ ...entry, amount: parseAmount(entry.amount) })),
    problems: wire.problems,
  };
}

// --- cash box: categories, entries, summary, analytics (Phase 5) -----------

type WireCashCategory = {
  id: number;
  name: string;
  direction: CashDirection;
  icon: string | null;
  color: string | null;
  is_default: boolean;
  is_active: boolean;
};

type WireCashEntry = {
  id: number;
  category_id: number | null;
  site_id: number | null;
  direction: CashDirection;
  amount: string;
  date: string;
  note: string | null;
  created_at: string;
  updated_at: string;
  category_name: string | null;
  category_icon: string | null;
  category_color: string | null;
};

type WireCashSummary = {
  cash_in: string;
  wages_paid: string;
  expenses_paid: string;
  total_out: string;
  balance: string;
  wages_earned: string;
  outstanding_payable: string;
  worker_count: number;
  site_id?: number | null;
};

type WireAnalytics = {
  period: AnalyticsPeriod;
  start_date: string;
  end_date: string;
  buckets: {
    start_date: string;
    end_date: string;
    label: string;
    wages_paid: string;
    expenses_paid: string;
    total_out: string;
    cash_in: string;
  }[];
  totals: WireCashSummary;
  by_category: {
    category_id: number | null;
    name: string;
    direction: CashDirection;
    color: string | null;
    icon: string | null;
    total: string;
  }[];
};

function toCashEntry(wire: WireCashEntry): CashEntry {
  return {
    id: wire.id,
    category_id: wire.category_id,
    site_id: wire.site_id,
    direction: wire.direction,
    amount: parseAmount(wire.amount),
    date: wire.date,
    note: wire.note,
    category_name: wire.category_name,
    category_icon: wire.category_icon,
    category_color: wire.category_color,
  };
}

function toSummary(wire: WireCashSummary): CashSummary {
  return {
    cash_in: parseAmount(wire.cash_in),
    wages_paid: parseAmount(wire.wages_paid),
    expenses_paid: parseAmount(wire.expenses_paid),
    total_out: parseAmount(wire.total_out),
    balance: parseAmount(wire.balance),
    wages_earned: parseAmount(wire.wages_earned),
    outstanding_payable: parseAmount(wire.outstanding_payable),
    worker_count: wire.worker_count,
    site_id: wire.site_id ?? null,
  };
}

export async function fetchCategories(
  token: string,
  signal?: AbortSignal
): Promise<CashCategory[]> {
  // The server seeds the starter set on the first call, so a fresh account
  // still comes back with something to pick from.
  return await request<WireCashCategory[]>('/contractor/categories', { token, signal });
}

export async function createCategory(
  token: string,
  input: { name: string; direction: CashDirection; icon?: string | null; color?: string | null }
): Promise<CashCategory> {
  return await request<WireCashCategory>('/contractor/categories', {
    method: 'POST',
    token,
    body: {
      name: input.name.trim(),
      direction: input.direction,
      ...(input.icon ? { icon: input.icon } : {}),
      ...(input.color ? { color: input.color } : {}),
    },
  });
}

export async function updateCategory(
  token: string,
  categoryId: number,
  changes: { name?: string; icon?: string | null; color?: string | null; is_active?: boolean }
): Promise<CashCategory> {
  return await request<WireCashCategory>(`/contractor/categories/${categoryId}`, {
    method: 'PATCH',
    token,
    body: { ...changes, ...(changes.name ? { name: changes.name.trim() } : {}) },
  });
}

/** Deletes an unused category; retires one that already has entries. */
export async function deleteCategory(token: string, categoryId: number): Promise<void> {
  await request<void>(`/contractor/categories/${categoryId}`, { method: 'DELETE', token });
}

export async function fetchCashEntries(
  token: string,
  options: { startDate?: string; endDate?: string; limit?: number; siteId?: number } = {},
  signal?: AbortSignal
): Promise<CashEntry[]> {
  const params = new URLSearchParams();
  if (options.siteId != null) params.set('site_id', String(options.siteId));
  if (options.startDate) params.set('start_date', options.startDate);
  if (options.endDate) params.set('end_date', options.endDate);
  if (options.limit) params.set('limit', String(options.limit));
  const query = params.toString();

  const wire = await request<WireCashEntry[]>(
    `/contractor/cash-entries${query ? `?${query}` : ''}`,
    { token, signal }
  );
  return wire.map(toCashEntry);
}

/**
 * Log one expense or one payment received.
 *
 * `clientRef` is the offline queue key and the server stores it as an
 * idempotency key, so replaying a write whose response was lost returns the
 * row that already exists rather than charging the contractor twice.
 */
export async function createCashEntry(
  token: string,
  input: {
    category_id?: number | null;
    direction?: CashDirection;
    amount: number;
    date: string;
    note?: string | null;
    client_ref?: string | null;
    /** The site this was spent at, or received for. */
    site_id?: number | null;
  }
): Promise<CashEntry> {
  const wire = await request<WireCashEntry>('/contractor/cash-entries', {
    method: 'POST',
    token,
    body: {
      ...(input.category_id != null ? { category_id: input.category_id } : {}),
      ...(input.direction ? { direction: input.direction } : {}),
      // A string keeps the decimal exact all the way to the DECIMAL column.
      amount: input.amount.toFixed(2),
      date: input.date,
      note: input.note ?? null,
      ...(input.client_ref ? { client_ref: input.client_ref } : {}),
      ...(input.site_id ? { site_id: input.site_id } : {}),
    },
  });
  return toCashEntry(wire);
}

export async function deleteCashEntry(token: string, entryId: number): Promise<void> {
  await request<void>(`/contractor/cash-entries/${entryId}`, { method: 'DELETE', token });
}

export async function fetchSummary(
  token: string,
  signal?: AbortSignal,
  options: { siteId?: number } = {}
): Promise<CashSummary> {
  const query = options.siteId != null ? `?site_id=${options.siteId}` : '';
  return toSummary(
    await request<WireCashSummary>(`/contractor/summary${query}`, { token, signal })
  );
}

// --- sites, as the Home screen sees them -------------------------------------

type WireSiteOverview = {
  site_id: number;
  crew_active: number;
  crew_inactive: number;
  marked_today: number;
  worked_today: string;
  wages_earned: string;
  wages_paid: string;
  cash_in: string;
  expenses_paid: string;
  petty_cash: string;
  outstanding_payable: string;
  month_spend: string;
  today: string;
};

/** Every site's card for the site-selection Home screen. Admin only. */
export async function fetchSiteOverviews(
  token: string,
  signal?: AbortSignal,
  options: { includeInactive?: boolean } = {}
): Promise<SiteOverview[]> {
  const query = options.includeInactive ? '?include_inactive=true' : '';
  const wire = await request<WireSiteOverview[]>(`/contractor/sites/overview${query}`, {
    token,
    signal,
  });
  return wire.map((row) => ({
    site_id: row.site_id,
    crew_active: row.crew_active,
    crew_inactive: row.crew_inactive,
    marked_today: row.marked_today,
    worked_today: parseAmount(row.worked_today),
    wages_earned: parseAmount(row.wages_earned),
    wages_paid: parseAmount(row.wages_paid),
    cash_in: parseAmount(row.cash_in),
    expenses_paid: parseAmount(row.expenses_paid),
    petty_cash: parseAmount(row.petty_cash),
    outstanding_payable: parseAmount(row.outstanding_payable),
    month_spend: parseAmount(row.month_spend),
    today: row.today,
  }));
}

// --- does the ledger match the register? ---------------------------------------

type WireWageIssue = Omit<WageIssue, 'expected' | 'actual'> & {
  expected: string | null;
  actual: string | null;
};

export async function fetchWageAudit(token: string, signal?: AbortSignal): Promise<WageAudit> {
  const wire = await request<{
    consistent: boolean;
    counts: WageAudit['counts'];
    issues: WireWageIssue[];
  }>('/contractor/integrity/wages', { token, signal });
  return {
    consistent: wire.consistent,
    counts: wire.counts,
    issues: wire.issues.map((issue) => ({
      ...issue,
      expected: issue.expected == null ? null : parseAmount(issue.expected),
      actual: issue.actual == null ? null : parseAmount(issue.actual),
    })),
  };
}

/**
 * Bring every day's wage in line with the day. `apply: false` reports what
 * would change and writes nothing - show that first.
 */
export async function reconcileWages(
  token: string,
  apply: boolean
): Promise<ReconcileReport> {
  type Wire = Omit<ReconcileReport, 'net_change' | 'by_worker'> & {
    net_change: string;
    by_worker: (Omit<ReconcileReport['by_worker'][number], 'net_change'> & {
      net_change: string;
    })[];
  };
  const wire = await request<Wire>(`/contractor/integrity/wages/reconcile?apply=${apply}`, {
    method: 'POST',
    token,
  });
  return {
    ...wire,
    net_change: parseAmount(wire.net_change),
    by_worker: wire.by_worker.map((row) => ({ ...row, net_change: parseAmount(row.net_change) })),
  };
}

export async function fetchAnalytics(
  token: string,
  period: AnalyticsPeriod,
  signal?: AbortSignal
): Promise<AnalyticsSeries> {
  const wire = await request<WireAnalytics>(`/contractor/analytics?period=${period}`, {
    token,
    signal,
  });

  return {
    period: wire.period,
    start_date: wire.start_date,
    end_date: wire.end_date,
    buckets: wire.buckets.map((bucket) => ({
      ...bucket,
      wages_paid: parseAmount(bucket.wages_paid),
      expenses_paid: parseAmount(bucket.expenses_paid),
      total_out: parseAmount(bucket.total_out),
      cash_in: parseAmount(bucket.cash_in),
    })),
    totals: toSummary(wire.totals),
    by_category: wire.by_category.map((item) => ({
      ...item,
      total: parseAmount(item.total),
    })),
  };
}

// --- payroll settlement (Phase 8) ------------------------------------------

type WirePayrollSummary = {
  worker_id: number;
  worker_name: string;
  start_date: string | null;
  end_date: string;
  total_wages: string;
  total_advances: string;
  total_payments: string;
  window_balance: string;
  net_payable: string;
  days_present: number;
  days_half: number;
  days_absent: number;
  days_rain_out: number;
  days_worked: string;
  emi_advances: string | null;
  installments_recovered: string | null;
  emi_outstanding: string | null;
  lifetime_balance: string;
  can_settle: boolean;
};

type WirePayrollSettlement = {
  summary: WirePayrollSummary;
  transaction: WireTransaction;
  balance_after: string;
};

function toPayrollSummary(wire: WirePayrollSummary): PayrollSummary {
  return {
    worker_id: wire.worker_id,
    worker_name: wire.worker_name,
    start_date: wire.start_date,
    end_date: wire.end_date,
    total_wages: parseAmount(wire.total_wages),
    total_advances: parseAmount(wire.total_advances),
    total_payments: parseAmount(wire.total_payments),
    window_balance: parseAmount(wire.window_balance),
    net_payable: parseAmount(wire.net_payable),
    days_present: wire.days_present,
    days_half: wire.days_half,
    days_absent: wire.days_absent,
    days_rain_out: wire.days_rain_out ?? 0,
    days_worked: parseAmount(wire.days_worked),
    // Zero rather than trusted: a server that predates installment plans
    // sends none of these, and "no plan" is exactly what zero means.
    emi_advances: wire.emi_advances ? parseAmount(wire.emi_advances) : 0,
    installments_recovered: wire.installments_recovered
      ? parseAmount(wire.installments_recovered)
      : 0,
    emi_outstanding: wire.emi_outstanding ? parseAmount(wire.emi_outstanding) : 0,
    lifetime_balance: parseAmount(wire.lifetime_balance),
    can_settle: wire.can_settle,
  };
}

/**
 * What settling this period would pay, without writing anything.
 *
 * Omit both dates for the usual request — "clear everything this worker is
 * owed" — which is what the settlement screen opens with.
 */
export async function fetchPayrollPreview(
  token: string,
  workerId: number,
  options: { startDate?: string | null; endDate?: string | null } = {},
  signal?: AbortSignal
): Promise<PayrollSummary> {
  const params = new URLSearchParams({ worker_id: String(workerId) });
  if (options.startDate) params.set('start_date', options.startDate);
  if (options.endDate) params.set('end_date', options.endDate);

  return toPayrollSummary(
    await request<WirePayrollSummary>(`/payroll/preview?${params.toString()}`, { token, signal })
  );
}

/**
 * Pay off the period and take the worker's balance to zero.
 *
 * Never queued for offline replay: `transactions` has no idempotency key yet,
 * so a retry whose first attempt actually landed would pay a full settlement
 * twice. See the replay-safety note in src/offline/queue.ts.
 */
export async function settlePayroll(
  token: string,
  input: {
    worker_id: number;
    start_date?: string | null;
    end_date?: string | null;
    payment_mode: PaymentMode;
    note?: string | null;
  }
): Promise<PayrollSettlement> {
  const wire = await request<WirePayrollSettlement>('/payroll/settle', {
    method: 'POST',
    token,
    body: {
      worker_id: input.worker_id,
      ...(input.start_date ? { start_date: input.start_date } : {}),
      ...(input.end_date ? { end_date: input.end_date } : {}),
      payment_mode: input.payment_mode,
      note: input.note ?? null,
    },
  });

  return {
    summary: toPayrollSummary(wire.summary),
    transaction: toTransaction(wire.transaction),
    balance_after: parseAmount(wire.balance_after),
  };
}

// --- sites, photos and weather (Phase 9) -----------------------------------

type WireSite = {
  id: number;
  name: string;
  address: string | null;
  is_active: boolean;
  worker_count: number;
  photo_count: number;
  supervisor_id: number | null;
  supervisor_name: string | null;
  created_at: string;
  updated_at: string;
};

function toSite(wire: WireSite): Site {
  return {
    id: wire.id,
    name: wire.name,
    address: wire.address,
    is_active: wire.is_active,
    worker_count: wire.worker_count ?? 0,
    photo_count: wire.photo_count ?? 0,
    supervisor_id: wire.supervisor_id ?? null,
    supervisor_name: wire.supervisor_name ?? null,
  };
}

export async function fetchSites(token: string, signal?: AbortSignal): Promise<Site[]> {
  const wire = await request<WireSite[]>('/contractor/sites', { token, signal });
  return wire.map(toSite);
}

export async function createSite(
  token: string,
  input: { name: string; address?: string | null }
): Promise<Site> {
  const wire = await request<WireSite>('/contractor/sites', {
    method: 'POST',
    token,
    body: { name: input.name.trim(), address: input.address?.trim() || null },
  });
  return toSite(wire);
}

export async function updateSite(
  token: string,
  siteId: number,
  changes: {
    name?: string;
    address?: string | null;
    is_active?: boolean;
    /** Explicit null unassigns; the site goes back to being run by the admin. */
    supervisor_id?: number | null;
  }
): Promise<Site> {
  const wire = await request<WireSite>(`/contractor/sites/${siteId}`, {
    method: 'PATCH',
    token,
    body: { ...changes, ...(changes.name ? { name: changes.name.trim() } : {}) },
  });
  return toSite(wire);
}

/**
 * Take a site off the list.
 *
 * Closes it by default — `is_active` goes false, the site drops out of the
 * pickers, and every photo, receipt, invoice and petty-cash row it carries is
 * kept. `purge` hard deletes, and the API refuses it the moment the site has
 * any history, so it is only ever the undo for a site named wrong a minute
 * ago. Workers posted there are unposted either way, never deleted.
 */
export async function deleteSite(
  token: string,
  siteId: number,
  options: { purge?: boolean } = {}
): Promise<void> {
  const query = options.purge ? '?purge=true' : '';
  await request<void>(`/contractor/sites/${siteId}${query}`, {
    method: 'DELETE',
    token,
  });
}

export async function fetchSitePhotos(
  token: string,
  siteId: number,
  options: { startDate?: string; endDate?: string; limit?: number } = {},
  signal?: AbortSignal
): Promise<SitePhoto[]> {
  const params = new URLSearchParams();
  if (options.startDate) params.set('start_date', options.startDate);
  if (options.endDate) params.set('end_date', options.endDate);
  if (options.limit) params.set('limit', String(options.limit));
  const query = params.toString();

  return request<SitePhoto[]>(
    `/contractor/sites/${siteId}/photos${query ? `?${query}` : ''}`,
    { token, signal }
  );
}

/*
 * REMOVED: uploadSitePhoto / uploadMySitePhoto / deleteSitePhoto.
 *
 * Site photos are stored on the device that took them and are never sent to
 * the server - see src/offline/local-photos.ts. These were left behind with
 * no callers after that change, and a dead upload helper is exactly the thing
 * a later edit reaches for by accident, so it is gone rather than deprecated.
 *
 * The routes still exist server-side and `fetchSitePhotos` / `fetchMySitePhotos`
 * still read them, so photos uploaded before the change remain visible.
 */



/** The feed for the site this worker is posted to. Empty when they are not. */
export async function fetchMySitePhotos(
  token: string,
  signal?: AbortSignal
): Promise<SitePhoto[]> {
  return request<SitePhoto[]>('/worker/site-photos', { token, signal });
}


/** Mark every active worker on a site as rained out for the day. */
export async function markSiteRainedOut(
  token: string,
  siteId: number,
  options: { date?: string; overwrite?: boolean } = {}
): Promise<RainOutResult> {
  const params = new URLSearchParams();
  if (options.date) params.set('date', options.date);
  if (options.overwrite === false) params.set('overwrite', 'false');
  const query = params.toString();

  return request<RainOutResult>(
    `/contractor/sites/${siteId}/rainout${query ? `?${query}` : ''}`,
    { method: 'POST', token }
  );
}

export async function fetchSiteAttendance(
  token: string,
  siteId: number,
  date?: string,
  signal?: AbortSignal
): Promise<Attendance[]> {
  const wire = await request<WireAttendance[]>(
    `/contractor/sites/${siteId}/attendance${date ? `?date=${date}` : ''}`,
    { token, signal }
  );
  return wire.map(toAttendance);
}

/**
 * Store a voice note and get back a path to attach to a form.
 *
 * Two steps on purpose: the recording uploads while the rest of the form is
 * still being filled in, so the slow part is done before Save is tapped.
 */
export async function uploadAudioNote(
  token: string,
  recording: { uri: string; name?: string; mimeType?: string }
): Promise<UploadedMedia> {
  const form = new FormData();
  await appendFile(form, 'audio', recording, { name: 'note.m4a', type: 'audio/m4a' });

  return request<UploadedMedia>('/media/audio-notes', {
    method: 'POST',
    token,
    body: form,
  });
}

// --- site logistics, piece rate and tools (Phase 10) -----------------------
//
// The money fields all arrive as DECIMAL strings and are parsed here, at the
// edge, like everything above. Quantities too: `quantity_in_stock` is a
// NUMERIC(12,3) and comes over as "52.500".

type WirePettyCash = {
  id: number;
  site_id: number;
  amount: string;
  description: string;
  date: string;
  recorded_by: number | null;
  recorded_by_name: string | null;
  created_at: string;
};

function toPettyCash(wire: WirePettyCash): PettyCashEntry {
  return { ...wire, amount: parseAmount(wire.amount) };
}

export async function fetchPettyCash(
  token: string,
  siteId: number,
  options: { startDate?: string; endDate?: string; limit?: number } = {},
  signal?: AbortSignal
): Promise<PettyCashEntry[]> {
  const params = new URLSearchParams();
  if (options.startDate) params.set('start_date', options.startDate);
  if (options.endDate) params.set('end_date', options.endDate);
  if (options.limit) params.set('limit', String(options.limit));
  const query = params.toString();

  const wire = await request<WirePettyCash[]>(
    `/contractor/sites/${siteId}/petty-cash${query ? `?${query}` : ''}`,
    { token, signal }
  );
  return wire.map(toPettyCash);
}

export async function createPettyCash(
  token: string,
  siteId: number,
  input: { amount: number; description: string; date?: string }
): Promise<PettyCashEntry> {
  const wire = await request<WirePettyCash>(`/contractor/sites/${siteId}/petty-cash`, {
    method: 'POST',
    token,
    body: {
      amount: input.amount,
      description: input.description.trim(),
      ...(input.date ? { date: input.date } : {}),
    },
  });
  return toPettyCash(wire);
}

export async function deletePettyCash(
  token: string,
  siteId: number,
  entryId: number
): Promise<void> {
  await request<void>(`/contractor/sites/${siteId}/petty-cash/${entryId}`, {
    method: 'DELETE',
    token,
  });
}

export async function fetchPettyCashTotals(
  token: string,
  siteId: number,
  signal?: AbortSignal
): Promise<PettyCashTotals> {
  const wire = await request<{
    site_id: number;
    total: string;
    period_total: string;
    start_date: string | null;
    end_date: string;
    entry_count: number;
  }>(`/contractor/sites/${siteId}/petty-cash/totals`, { token, signal });

  return {
    ...wire,
    total: parseAmount(wire.total),
    period_total: parseAmount(wire.period_total),
  };
}

// --- piece rate -------------------------------------------------------------

type WirePieceRateLog = {
  id: number;
  worker_id: number;
  worker_name: string | null;
  site_id: number | null;
  work_description: string;
  quantity: string;
  rate: string;
  total_amount: string;
  date: string;
  transaction_id: number | null;
  created_at: string;
};

function toPieceRateLog(wire: WirePieceRateLog): PieceRateLog {
  return {
    ...wire,
    quantity: parseAmount(wire.quantity),
    rate: parseAmount(wire.rate),
    total_amount: parseAmount(wire.total_amount),
  };
}

export async function fetchPieceRateLogs(
  token: string,
  options: {
    workerId?: number;
    siteId?: number;
    startDate?: string;
    endDate?: string;
    limit?: number;
  } = {},
  signal?: AbortSignal
): Promise<PieceRateLog[]> {
  const params = new URLSearchParams();
  if (options.workerId) params.set('worker_id', String(options.workerId));
  if (options.siteId) params.set('site_id', String(options.siteId));
  if (options.startDate) params.set('start_date', options.startDate);
  if (options.endDate) params.set('end_date', options.endDate);
  if (options.limit) params.set('limit', String(options.limit));
  const query = params.toString();

  const wire = await request<WirePieceRateLog[]>(
    `/contractor/piece-rate-logs${query ? `?${query}` : ''}`,
    { token, signal }
  );
  return wire.map(toPieceRateLog);
}

/** Log measured work. The server writes the matching WAGE into the ledger. */
export async function createPieceRateLog(
  token: string,
  input: {
    worker_id: number;
    work_description: string;
    quantity: number;
    rate: number;
    site_id?: number | null;
    date?: string;
    note?: string | null;
  }
): Promise<PieceRateLog> {
  // No total_amount: the server multiplies, so there is no client-supplied
  // figure that could disagree with the two numbers meant to produce it.
  const wire = await request<WirePieceRateLog>('/contractor/piece-rate-logs', {
    method: 'POST',
    token,
    body: { ...input, work_description: input.work_description.trim() },
  });
  return toPieceRateLog(wire);
}

// --- bulk attendance --------------------------------------------------------

type WireInstallment = {
  id: number;
  deduction_id: number;
  worker_id: number;
  amount: string;
  date: string;
};

function toInstallment(wire: WireInstallment): DeductionInstallment {
  return { ...wire, amount: parseAmount(wire.amount) };
}

type WireBulkResult = {
  date: string;
  site_id: number | null;
  created: number;
  updated: number;
  unchanged: number;
  attendance: WireAttendance[];
  piece_rate_logs: WirePieceRateLog[];
  piece_rate_total: string;
  installments: WireInstallment[];
  deductions_applied: string;
};

/**
 * Submit the whole attendance grid as one request.
 *
 * Replay-safe on the server: an already-marked worker is left alone unless
 * `overwrite` is set, a second piece-rate row for the same day is skipped,
 * and installments are guarded by a unique constraint. Retrying a submission
 * whose response was lost therefore changes nothing rather than paying twice.
 */
export async function submitBulkAttendance(
  token: string,
  input: {
    marks: BulkAttendanceMark[];
    date?: string;
    site_id?: number | null;
    overwrite?: boolean;
  }
): Promise<BulkAttendanceResult> {
  const wire = await request<WireBulkResult>('/contractor/attendance/bulk', {
    method: 'POST',
    token,
    body: input,
  });

  return {
    ...wire,
    attendance: wire.attendance.map(toAttendance),
    piece_rate_logs: wire.piece_rate_logs.map(toPieceRateLog),
    piece_rate_total: parseAmount(wire.piece_rate_total),
    installments: wire.installments.map(toInstallment),
    deductions_applied: parseAmount(wire.deductions_applied),
  };
}

// --- installment plans ------------------------------------------------------

type WireDeduction = {
  id: number;
  worker_id: number;
  worker_name: string | null;
  principal_amount: string;
  daily_deduction: string;
  balance_remaining: string;
  recovered_amount: string;
  is_active: boolean;
  transaction_id: number | null;
  note: string | null;
  created_at: string;
};

function toDeduction(wire: WireDeduction): AutoDeduction {
  return {
    ...wire,
    principal_amount: parseAmount(wire.principal_amount),
    daily_deduction: parseAmount(wire.daily_deduction),
    balance_remaining: parseAmount(wire.balance_remaining),
    recovered_amount: parseAmount(wire.recovered_amount),
  };
}

export async function fetchDeductions(
  token: string,
  options: { workerId?: number; activeOnly?: boolean } = {},
  signal?: AbortSignal
): Promise<AutoDeduction[]> {
  const params = new URLSearchParams();
  if (options.workerId) params.set('worker_id', String(options.workerId));
  if (options.activeOnly === false) params.set('active_only', 'false');
  const query = params.toString();

  const wire = await request<WireDeduction[]>(
    `/contractor/deductions${query ? `?${query}` : ''}`,
    { token, signal }
  );
  return wire.map(toDeduction);
}

/**
 * Open a plan against a debt that did not come through this app.
 *
 * The usual route is the "recover in installments" switch on an advance,
 * which opens the plan and links it to the ADVANCE row in one go. This is for
 * a debt agreed off the books, and the server deliberately links no
 * transaction to it.
 *
 * 409 when the worker already has a running plan — two plans would take two
 * deductions a day and neither would be the figure that was agreed.
 */
export async function createDeduction(
  token: string,
  input: {
    worker_id: number;
    principal_amount: number;
    daily_deduction: number;
    note?: string | null;
  }
): Promise<AutoDeduction> {
  const wire = await request<WireDeduction>('/contractor/deductions', {
    method: 'POST',
    token,
    body: { ...input, note: input.note?.trim() || null },
  });
  return toDeduction(wire);
}

/**
 * Change the daily rate, or stop collecting.
 *
 * `principal_amount` is not editable: it is what was actually handed over,
 * and changing it after installments have been taken would leave
 * `balance_remaining` describing a debt that never existed.
 */
export async function updateDeduction(
  token: string,
  deductionId: number,
  changes: { daily_deduction?: number; is_active?: boolean; note?: string | null }
): Promise<AutoDeduction> {
  const wire = await request<WireDeduction>(`/contractor/deductions/${deductionId}`, {
    method: 'PATCH',
    token,
    body: changes,
  });
  return toDeduction(wire);
}

/** Stop collecting and write the remainder off. */
export async function closeDeduction(
  token: string,
  deductionId: number
): Promise<AutoDeduction> {
  return updateDeduction(token, deductionId, { is_active: false });
}

/**
 * Every deduction actually taken off this plan, oldest first.
 *
 * The answer to "which days did you take ₹200 off me?", which the rollup on
 * the plan row can never give.
 */
export async function fetchInstallments(
  token: string,
  deductionId: number,
  signal?: AbortSignal
): Promise<DeductionInstallment[]> {
  const wire = await request<WireInstallment[]>(
    `/contractor/deductions/${deductionId}/installments`,
    { token, signal }
  );
  return wire.map(toInstallment);
}

/**
 * Re-derive `balance_remaining` from the installments behind it.
 *
 * A repair hatch, not part of the normal flow — the rollup is maintained on
 * every write. It exists because the rollup is derived data, and derived data
 * should always have a way back to the rows it came from.
 */
export async function recomputeDeduction(
  token: string,
  deductionId: number
): Promise<AutoDeduction> {
  const wire = await request<WireDeduction>(
    `/contractor/deductions/${deductionId}/recompute`,
    { method: 'POST', token }
  );
  return toDeduction(wire);
}

// --- tools ------------------------------------------------------------------

type WireToolAssignment = {
  id: number;
  tool_id: number;
  tool_name: string | null;
  site_id: number | null;
  worker_id: number;
  worker_name: string | null;
  checkout_time: string;
  return_time: string | null;
  status: ToolAssignmentStatus;
  note: string | null;
};

type WireTool = {
  id: number;
  site_id: number;
  name: string;
  inventory_count: number;
  notes: string | null;
  is_active: boolean;
  out_count: number;
  available_count: number;
  assignments: WireToolAssignment[];
};

// Tools carry no money, so these three pass the wire shape straight through
// rather than mapping it — there is nothing to parse.

export async function fetchTools(
  token: string,
  siteId: number,
  signal?: AbortSignal
): Promise<Tool[]> {
  return request<WireTool[]>(`/contractor/sites/${siteId}/tools`, { token, signal });
}

export async function createTool(
  token: string,
  siteId: number,
  input: { name: string; inventory_count?: number; notes?: string | null }
): Promise<Tool> {
  return request<WireTool>(`/contractor/sites/${siteId}/tools`, {
    method: 'POST',
    token,
    body: { ...input, name: input.name.trim() },
  });
}

export async function deleteTool(
  token: string,
  siteId: number,
  toolId: number
): Promise<void> {
  await request<void>(`/contractor/sites/${siteId}/tools/${toolId}`, {
    method: 'DELETE',
    token,
  });
}

export async function assignTool(
  token: string,
  siteId: number,
  toolId: number,
  input: { worker_id: number; note?: string | null }
): Promise<ToolAssignment> {
  return request<WireToolAssignment>(
    `/contractor/sites/${siteId}/tools/${toolId}/assign`,
    { method: 'POST', token, body: input }
  );
}

/** Book a tool back in, or write it off as lost. */
export async function returnTool(
  token: string,
  assignmentId: number,
  status: Extract<ToolAssignmentStatus, 'returned' | 'lost'> = 'returned',
  note?: string | null
): Promise<ToolAssignment> {
  return request<WireToolAssignment>(`/contractor/tool-assignments/${assignmentId}`, {
    method: 'PATCH',
    token,
    body: { status, ...(note ? { note } : {}) },
  });
}

/** What is still out across every site — backs the dashboard warning badge. */
export async function fetchOutstandingTools(
  token: string,
  signal?: AbortSignal
): Promise<OutstandingTools> {
  return request<OutstandingTools>('/contractor/tools/outstanding', { token, signal });
}

// --- material GRN -----------------------------------------------------------

type WireInventoryItem = {
  id: number;
  site_id: number;
  item_name: string;
  quantity_in_stock: string;
  unit: MaterialUnit;
  updated_at: string;
};

type WireMaterialReceipt = {
  id: number;
  site_id: number;
  item_name: string;
  quantity_received: string;
  unit: MaterialUnit;
  date: string;
  supplier: string | null;
  note: string | null;
  received_by: number | null;
  received_by_name: string | null;
  created_at: string;
  challan_image_url: string | null;
  quantity_in_stock: string | null;
};

function toReceipt(wire: WireMaterialReceipt): MaterialReceipt {
  return {
    ...wire,
    quantity_received: parseAmount(wire.quantity_received),
    quantity_in_stock:
      wire.quantity_in_stock === null ? null : parseAmount(wire.quantity_in_stock),
  };
}

export async function fetchSiteInventory(
  token: string,
  siteId: number,
  signal?: AbortSignal
): Promise<SiteInventoryItem[]> {
  const wire = await request<WireInventoryItem[]>(
    `/contractor/sites/${siteId}/inventory`,
    { token, signal }
  );
  return wire.map((row) => ({
    ...row,
    quantity_in_stock: parseAmount(row.quantity_in_stock),
  }));
}

export async function fetchMaterialReceipts(
  token: string,
  siteId: number,
  options: { limit?: number } = {},
  signal?: AbortSignal
): Promise<MaterialReceipt[]> {
  const query = options.limit ? `?limit=${options.limit}` : '';
  const wire = await request<WireMaterialReceipt[]>(
    `/contractor/sites/${siteId}/material-receipts${query}`,
    { token, signal }
  );
  return wire.map(toReceipt);
}

/**
 * Record a delivery and add it to site stock, in one server-side transaction.
 *
 * Multipart because the challan photo travels with it. As with the site photo
 * upload, the file part goes through `appendFile` so the same call works on
 * both runtimes; on native it streams off disk rather than reading a camera
 * JPEG into memory.
 */
export async function receiveMaterial(
  token: string,
  siteId: number,
  input: {
    item_name: string;
    quantity_received: number;
    unit: MaterialUnit;
    date?: string;
    supplier?: string | null;
    note?: string | null;
  },
  challan?: { uri: string; name?: string; mimeType?: string } | null
): Promise<MaterialReceipt> {
  const form = new FormData();
  form.append('item_name', input.item_name.trim());
  form.append('quantity_received', String(input.quantity_received));
  form.append('unit', input.unit);
  if (input.date) form.append('date', input.date);
  if (input.supplier) form.append('supplier', input.supplier.trim());
  if (input.note) form.append('note', input.note.trim());

  if (challan) {
    await appendFile(form, 'challan', challan, { name: 'challan.jpg', type: 'image/jpeg' });
  }

  return toReceipt(
    await request<WireMaterialReceipt>(
      `/contractor/sites/${siteId}/material-receipts`,
      { method: 'POST', token, body: form }
    )
  );
}

// --- machinery and diesel (Phase 11) ----------------------------------------

type WireMachineryLog = {
  id: number;
  site_id: number;
  machine_name: string;
  hours_operated: string;
  diesel_litres: string;
  fuel_cost: string;
  date: string;
  note: string | null;
  logged_by: number | null;
  logged_by_name: string | null;
  created_at: string;
  receipt_image_url: string | null;
};

type WireMachineUsage = {
  machine_name: string;
  hours_operated: string;
  diesel_litres: string;
  fuel_cost: string;
  log_count: number;
};

type WireMachineryTotals = {
  site_id: number;
  start_date: string | null;
  end_date: string;
  hours_operated: string;
  diesel_litres: string;
  fuel_cost: string;
  log_count: number;
  by_machine: WireMachineUsage[];
};

function toMachineryLog(wire: WireMachineryLog): MachineryLog {
  return {
    ...wire,
    hours_operated: parseAmount(wire.hours_operated),
    diesel_litres: parseAmount(wire.diesel_litres),
    fuel_cost: parseAmount(wire.fuel_cost),
  };
}

function toMachineUsage(wire: WireMachineUsage): MachineUsage {
  return {
    ...wire,
    hours_operated: parseAmount(wire.hours_operated),
    diesel_litres: parseAmount(wire.diesel_litres),
    fuel_cost: parseAmount(wire.fuel_cost),
  };
}

export async function fetchMachineryLogs(
  token: string,
  siteId: number,
  options: { startDate?: string; endDate?: string; limit?: number } = {},
  signal?: AbortSignal
): Promise<MachineryLog[]> {
  const params = new URLSearchParams();
  if (options.startDate) params.set('start_date', options.startDate);
  if (options.endDate) params.set('end_date', options.endDate);
  if (options.limit) params.set('limit', String(options.limit));
  const query = params.toString();

  const wire = await request<WireMachineryLog[]>(
    `/contractor/sites/${siteId}/machinery${query ? `?${query}` : ''}`,
    { token, signal }
  );
  return wire.map(toMachineryLog);
}

/**
 * What the plant on this site ran and burned over a window.
 *
 * A separate call rather than a sum over the list: the list is capped by
 * `limit`, and a site with three hundred logs would otherwise show a header
 * figure that totalled only the hundred it drew.
 */
export async function fetchMachineryTotals(
  token: string,
  siteId: number,
  options: { startDate?: string; endDate?: string } = {},
  signal?: AbortSignal
): Promise<MachineryTotals> {
  const params = new URLSearchParams();
  if (options.startDate) params.set('start_date', options.startDate);
  if (options.endDate) params.set('end_date', options.endDate);
  const query = params.toString();

  const wire = await request<WireMachineryTotals>(
    `/contractor/sites/${siteId}/machinery/totals${query ? `?${query}` : ''}`,
    { token, signal }
  );
  return {
    ...wire,
    hours_operated: parseAmount(wire.hours_operated),
    diesel_litres: parseAmount(wire.diesel_litres),
    fuel_cost: parseAmount(wire.fuel_cost),
    by_machine: wire.by_machine.map(toMachineUsage),
  };
}

/**
 * Log one machine's day, with the photographed diesel receipt.
 *
 * Multipart because the receipt travels with it. As with the challan upload,
 * the file part goes through `appendFile`, which streams off disk on native
 * rather than reading a camera JPEG into memory.
 */
export async function createMachineryLog(
  token: string,
  siteId: number,
  input: {
    machine_name: string;
    hours_operated?: number;
    diesel_litres?: number;
    fuel_cost?: number;
    date?: string;
    note?: string | null;
  },
  receipt?: { uri: string; name?: string; mimeType?: string } | null
): Promise<MachineryLog> {
  const form = new FormData();
  form.append('machine_name', input.machine_name.trim());
  form.append('hours_operated', String(input.hours_operated ?? 0));
  form.append('diesel_litres', String(input.diesel_litres ?? 0));
  form.append('fuel_cost', String(input.fuel_cost ?? 0));
  if (input.date) form.append('date', input.date);
  if (input.note) form.append('note', input.note.trim());

  if (receipt) {
    await appendFile(form, 'receipt', receipt, {
      name: 'diesel-receipt.jpg',
      type: 'image/jpeg',
    });
  }

  return toMachineryLog(
    await request<WireMachineryLog>(`/contractor/sites/${siteId}/machinery`, {
      method: 'POST',
      token,
      body: form,
    })
  );
}

export async function deleteMachineryLog(
  token: string,
  siteId: number,
  logId: number
): Promise<void> {
  await request<void>(`/contractor/sites/${siteId}/machinery/${logId}`, {
    method: 'DELETE',
    token,
  });
}

// --- client invoices (Phase 11) ---------------------------------------------

type WireInvoiceLine = {
  kind: InvoiceLine['kind'];
  label: string;
  quantity: string | null;
  unit: string | null;
  rate: string | null;
  amount: string;
};

type WireInvoicePreview = {
  site_id: number;
  site_name: string;
  start_date: string | null;
  end_date: string;
  piece_rate_total: string;
  materials_total: string;
  machinery_total: string;
  suggested_total: string;
  lines: WireInvoiceLine[];
  material_receipt_count: number;
};

type WireInvoice = {
  id: number;
  site_id: number;
  site_name: string | null;
  client_name: string;
  total_amount: string;
  status: InvoiceStatus;
  note: string | null;
  created_at: string;
  updated_at: string;
  pdf_url: string | null;
};

function toInvoice(wire: WireInvoice): Invoice {
  return { ...wire, total_amount: parseAmount(wire.total_amount) };
}

/**
 * What a site cost over a window, as billable lines.
 *
 * Reads only — nothing is written, so the dates can be moved around and the
 * figure watched before anything is committed to.
 */
export async function fetchInvoicePreview(
  token: string,
  siteId: number,
  options: { startDate?: string; endDate?: string } = {},
  signal?: AbortSignal
): Promise<InvoicePreview> {
  const params = new URLSearchParams({ site_id: String(siteId) });
  if (options.startDate) params.set('start_date', options.startDate);
  if (options.endDate) params.set('end_date', options.endDate);

  const wire = await request<WireInvoicePreview>(
    `/contractor/invoices/preview?${params.toString()}`,
    { token, signal }
  );
  return {
    ...wire,
    piece_rate_total: parseAmount(wire.piece_rate_total),
    materials_total: parseAmount(wire.materials_total),
    machinery_total: parseAmount(wire.machinery_total),
    suggested_total: parseAmount(wire.suggested_total),
    lines: wire.lines.map((line) => ({
      ...line,
      quantity: line.quantity === null ? null : parseAmount(line.quantity),
      rate: line.rate === null ? null : parseAmount(line.rate),
      amount: parseAmount(line.amount),
    })),
  };
}

export async function fetchInvoices(
  token: string,
  options: { siteId?: number; status?: InvoiceStatus; limit?: number } = {},
  signal?: AbortSignal
): Promise<Invoice[]> {
  const params = new URLSearchParams();
  if (options.siteId) params.set('site_id', String(options.siteId));
  if (options.status) params.set('status', options.status);
  if (options.limit) params.set('limit', String(options.limit));
  const query = params.toString();

  const wire = await request<WireInvoice[]>(
    `/contractor/invoices${query ? `?${query}` : ''}`,
    { token, signal }
  );
  return wire.map(toInvoice);
}

/**
 * Raise a bill against a site.
 *
 * `total_amount` is what the client is actually being asked for, seeded from
 * the preview and then typed over — the server takes it as given rather than
 * recomputing it. An invoice carries markup, retention and whatever was
 * agreed on the phone, none of which this app models.
 */
export async function createInvoice(
  token: string,
  input: {
    site_id: number;
    client_name: string;
    total_amount: number;
    status?: InvoiceStatus;
    note?: string | null;
  }
): Promise<Invoice> {
  return toInvoice(
    await request<WireInvoice>('/contractor/invoices', {
      method: 'POST',
      token,
      body: {
        site_id: input.site_id,
        client_name: input.client_name.trim(),
        total_amount: String(input.total_amount),
        ...(input.status ? { status: input.status } : {}),
        ...(input.note ? { note: input.note.trim() } : {}),
      },
    })
  );
}

/**
 * Move an invoice along, or correct a draft.
 *
 * The API refuses an amount or client change once the invoice has been sent —
 * the client is holding paper with a number on it. Void it and raise another.
 */
export async function updateInvoice(
  token: string,
  invoiceId: number,
  changes: {
    client_name?: string;
    total_amount?: number;
    status?: InvoiceStatus;
    note?: string | null;
  }
): Promise<Invoice> {
  return toInvoice(
    await request<WireInvoice>(`/contractor/invoices/${invoiceId}`, {
      method: 'PATCH',
      token,
      body: {
        ...changes,
        ...(changes.client_name ? { client_name: changes.client_name.trim() } : {}),
        ...(changes.total_amount === undefined
          ? {}
          : { total_amount: String(changes.total_amount) }),
      },
    })
  );
}

export async function deleteInvoice(token: string, invoiceId: number): Promise<void> {
  await request<void>(`/contractor/invoices/${invoiceId}`, { method: 'DELETE', token });
}
