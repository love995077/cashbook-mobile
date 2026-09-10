/**
 * Mirrors the FastAPI schemas in `app/schemas/`. When the real API is wired up
 * in the next phase these types should not need to change.
 *
 * One deliberate difference: the API sends money as DECIMAL strings ("600.00")
 * to avoid float rounding. The mock keeps plain numbers; `parseAmount` in
 * `src/lib/money.ts` is the single place that will absorb that difference.
 */

/**
 * Who someone is, and therefore what they may do.
 *
 * `contractor` was renamed to `admin` in Phase 11 and `supervisor` added. The
 * API sends and accepts the new values; nothing on the wire says "contractor"
 * any more. The word survives only in UI copy, where it is the term the user
 * actually recognises.
 */
export type UserRole = 'worker' | 'admin' | 'supervisor';

/** Runs the business: the whole crew, every site, and all the money. */
export function isAdmin(role: UserRole | undefined): boolean {
  return role === 'admin';
}

/**
 * May open a site screen at all.
 *
 * A supervisor runs one site and never sees project finances, so this is the
 * test for site tooling — attendance, tools, material — and NOT for anything
 * on the money side, which checks `isAdmin`.
 */
export function canRunSites(role: UserRole | undefined): boolean {
  return role === 'admin' || role === 'supervisor';
}
/**
 * `rain_out` is not a flavour of `absent`. The worker turned up and could not
 * work, which is a different argument about pay and a different number when
 * the contractor renegotiates the schedule. Every Record<AttendanceStatus, …>
 * in the app must handle it, and TypeScript enforces that.
 */
export type AttendanceStatus = 'present' | 'half_day' | 'absent' | 'rain_out';
export type TransactionType = 'wage' | 'advance' | 'payment';

/**
 * The posts the app ships icons and colours for — see lib/trades.ts.
 *
 * Mirrors the `WorkerTrade` enum in app/models/enums.py, which is now a
 * catalogue rather than a constraint. These are the suggestions offered when
 * adding a worker, not the set of legal answers.
 */
export type KnownWorkerTrade =
  | 'mason'
  | 'electrician'
  | 'plumber'
  | 'carpenter'
  | 'painter'
  | 'welder'
  | 'bar_bender'
  | 'plasterer'
  | 'tiler'
  | 'operator'
  | 'driver'
  | 'supervisor'
  | 'general_labour';

/**
 * A worker's post on site. Free text.
 *
 * `users.trade` is a VARCHAR, so this is `string` and not a union: a crew
 * turns up with posts no list anticipated, and the app must render whatever
 * the server sends rather than only the thirteen it knows.
 *
 * The server normalises on write — lowercased, spaces and hyphens folded to
 * underscores — so a value that arrives here is already in the form
 * `tradeInfo` looks up, and `postLabel` in lib/trades.ts turns anything
 * unrecognised back into readable text.
 *
 * Typed as an alias rather than replaced outright so the intent still reads at
 * every use site, and `KnownWorkerTrade` stays available where the catalogue
 * itself is meant.
 */
export type WorkerTrade = string;

/** How money physically changed hands. Null on a wage — nothing moved yet. */
export type PaymentMode = 'cash' | 'upi' | 'bank_transfer';

export type User = {
  id: number;
  name: string;
  /**
   * Null when none was recorded. A worker can be booked onto the crew with a
   * name alone; they simply have no way to sign in until a number and a PIN
   * are set. Contractors always have one — they registered with it.
   */
  phone: string | null;
  role: UserRole;
  daily_wage: number | null;
  /** Their post on site. Null when it was never recorded. */
  trade: WorkerTrade | null;
  /**
   * How they are paid. Drives which control the attendance grid draws for
   * them — see `WageType` below. Never null: every worker predating the
   * column was being paid by the day.
   */
  wage_type: WageType;
  /** Which site they are currently posted to; null when unposted. */
  site_id: number | null;
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
  /** Null on a wage, and on anything logged before Phase 8. */
  payment_mode: PaymentMode | null;
  note: string | null;
  /** Playable link for an attached voice note; null when there is none. */
  audio_note_url: string | null;
};

/**
 * Day or night.
 *
 * Deliberately separate from AttendanceStatus: status says how MUCH of a day
 * was worked (a half day is 0.5), shift says WHEN. Both are paid at the same
 * standard daily rate.
 */
export type WorkShift = 'day' | 'night';

export type AdvanceRequestStatus = 'pending' | 'approved' | 'rejected';

/** A worker asking for money before payday, and the contractor's answer. */
export type AdvanceRequest = {
  id: number;
  worker_id: number;
  worker_name: string | null;
  amount: number;
  reason: string | null;
  status: AdvanceRequestStatus;
  /** The ledger row an approval created. */
  transaction_id: number | null;
  decided_at: string | null;
  created_at: string;
  audio_note_url: string | null;
};

export type Attendance = {
  id: number;
  worker_id: number;
  /** ISO date, YYYY-MM-DD. */
  date: string;
  status: AttendanceStatus;
  shift: WorkShift;
  note: string | null;
  site_id: number | null;
  /** Raised by the worker when the row does not match the day they worked. */
  is_disputed: boolean;
  /** The worker's spoken explanation of a dispute, if they recorded one. */
  audio_note_url: string | null;
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

// --- the contractor's own cash box (Phase 5) -------------------------------
//
// Worker wages are `Transaction`s above and always belong to a worker.
// Everything else the contractor handles - the advance the site owner pays in,
// the diesel, the scaffolding rental - is a `CashEntry` filed under a
// `CashCategory` the contractor can rename or add to.

export type CashDirection = 'in' | 'out';

export type CashCategory = {
  id: number;
  name: string;
  direction: CashDirection;
  /** Ionicons glyph name, chosen by the server so both ends agree. */
  icon: string | null;
  color: string | null;
  /** Part of the starter set every contractor is seeded with. */
  is_default: boolean;
  is_active: boolean;
};

export type CashEntry = {
  id: number;
  category_id: number | null;
  site_id: number | null;
  direction: CashDirection;
  amount: number;
  /** ISO date, YYYY-MM-DD. */
  date: string;
  note: string | null;
  /** Flattened off the category so a row renders without a second lookup. */
  category_name: string | null;
  category_icon: string | null;
  category_color: string | null;
};

/** The three numbers on the Home screen. */
export type CashSummary = {
  cash_in: number;
  /** Cash that actually reached workers: advances given + payments settled. */
  wages_paid: number;
  /** Materials, fuel, transport, rentals. */
  expenses_paid: number;
  total_out: number;
  /** cash_in - total_out. */
  balance: number;
  /** Wages accrued, paid or not. Not part of `balance`. */
  wages_earned: number;
  /** Still owed to the crew, all time. Not part of `balance` either. */
  outstanding_payable: number;
  worker_count: number;
};

export type AnalyticsPeriod = 'day' | 'week' | 'month';

/** One bar in the analytics chart. */
export type AnalyticsBucket = {
  start_date: string;
  end_date: string;
  label: string;
  wages_paid: number;
  expenses_paid: number;
  total_out: number;
  cash_in: number;
};

export type CategoryTotal = {
  category_id: number | null;
  name: string;
  direction: CashDirection;
  color: string | null;
  icon: string | null;
  total: number;
};

export type AnalyticsSeries = {
  period: AnalyticsPeriod;
  start_date: string;
  end_date: string;
  buckets: AnalyticsBucket[];
  totals: CashSummary;
  by_category: CategoryTotal[];
};

// --- payroll settlement (Phase 8) ------------------------------------------

/**
 * What a worker is owed over a period, from GET /payroll/preview.
 *
 * `window_balance` is the period taken on its own; `net_payable` is that
 * capped at what the worker is owed across their whole history. They differ
 * when an earlier settlement fell outside the requested dates — the wages show
 * up, the payment that already cleared them does not. Always show and pay
 * `net_payable`; `window_balance` is only there to explain the gap.
 */
export type PayrollSummary = {
  worker_id: number;
  worker_name: string;
  /** Null means the window covers the worker's whole history. */
  start_date: string | null;
  end_date: string;

  total_wages: number;
  total_advances: number;
  total_payments: number;
  window_balance: number;
  net_payable: number;

  days_present: number;
  days_half: number;
  days_absent: number;
  /** Days the crew turned up and the weather sent them home. */
  days_rain_out: number;
  /** present + half/2. Rain-outs do not count. */
  days_worked: number;

  /**
   * Installment plans. The advance is still counted in `total_advances` and
   * `window_balance` — that is what was handed over, and the worker's own
   * screen must agree. `net_payable` is the figure that knows about the
   * arrangement: window_balance + emi_advances - installments_recovered.
   */
  emi_advances: number;
  installments_recovered: number;
  /** Still to be recovered, all time. The debt carried into next period. */
  emi_outstanding: number;

  lifetime_balance: number;
  can_settle: boolean;
};

export type PayrollSettlement = {
  summary: PayrollSummary;
  /** The clearing entry that was written. */
  transaction: Transaction;
  balance_after: number;
};

// --- sites, photos and weather (Phase 9) -----------------------------------

export type Site = {
  id: number;
  name: string;
  /** What the app hands to Google Maps for directions. */
  address: string | null;
  is_active: boolean;
  /** Active workers posted here. */
  worker_count: number;
  photo_count: number;
  /**
   * The supervisor running this site day to day; null when the admin runs it
   * themselves. A supervisor's own site list contains only sites where this
   * is them — see `canRunSites` above.
   */
  supervisor_id: number | null;
  supervisor_name: string | null;
};

export type SitePhoto = {
  id: number;
  site_id: number;
  /** The day the photo is ABOUT, which is not always the day it was uploaded. */
  date: string;
  description: string | null;
  uploaded_by: number | null;
  uploader_name: string | null;
  content_type: string | null;
  size_bytes: number | null;
  created_at: string;
  /** Absolute or app-relative link to the image itself. */
  url: string;
};

/**
 * What a site-wide rain-out actually changed.
 *
 * Split three ways so the confirmation can say "12 marked, 3 changed from
 * present" rather than a flat count that hides the overwrite.
 */
export type RainOutResult = {
  site_id: number;
  site_name: string;
  date: string;
  created: number;
  updated: number;
  unchanged: number;
  worker_ids: number[];
};

/**
 * A stored voice note, from POST /media/audio-notes.
 *
 * `path` is what gets attached to an advance request, transaction or dispute;
 * treat it as opaque, the server checks it was uploaded by this account.
 * `url` is for playing it back.
 */
export type UploadedMedia = {
  path: string;
  url: string;
  content_type: string;
  size_bytes: number;
};

// --- site logistics, piece rate and tools (Phase 10) -----------------------

/**
 * How a worker's earnings are calculated. Mirrors `wage_type` in
 * app/models/enums.py.
 *
 * The attendance grid branches on this: 'daily' gets the P/A/H toggle,
 * 'piece_rate' gets a quantity and a rate, because a present/absent mark
 * says nothing about what a tiler earned.
 */
export type WageType = 'daily' | 'piece_rate';

/** Where a tool that left the store has got to. */
export type ToolAssignmentStatus = 'out' | 'returned' | 'lost';

/** Small cash spent at a site — fares, tea, a packet of nails. */
export type PettyCashEntry = {
  id: number;
  site_id: number;
  amount: number;
  /** Required, unlike most notes: an unlabelled ₹200 is unaccountable later. */
  description: string;
  /** ISO date, YYYY-MM-DD. */
  date: string;
  recorded_by: number | null;
  recorded_by_name: string | null;
  created_at: string;
};

export type PettyCashTotals = {
  site_id: number;
  /** Every entry for the site, all time. */
  total: number;
  /** Narrowed to the requested window. */
  period_total: number;
  start_date: string | null;
  end_date: string;
  entry_count: number;
};

/**
 * Work paid by output. Every log also writes a WAGE into the worker's ledger
 * server-side, so piece work shows up in the balance and in payroll.
 */
export type PieceRateLog = {
  id: number;
  worker_id: number;
  worker_name: string | null;
  site_id: number | null;
  work_description: string;
  quantity: number;
  rate: number;
  /** quantity x rate, computed by the server. */
  total_amount: number;
  date: string;
  /** The WAGE row this log wrote. */
  transaction_id: number | null;
  created_at: string;
};

/**
 * An advance being recovered a little at a time.
 *
 * The advance is still subtracted from the ledger balance in full — that is
 * what was handed over. What the plan changes is `net_payable` on the payroll
 * preview, which holds back only the installments actually recovered. The gap
 * between the two is `balance_remaining`.
 */
export type AutoDeduction = {
  id: number;
  worker_id: number;
  worker_name: string | null;
  principal_amount: number;
  daily_deduction: number;
  balance_remaining: number;
  /** principal - remaining. */
  recovered_amount: number;
  is_active: boolean;
  transaction_id: number | null;
  note: string | null;
  created_at: string;
};

export type DeductionInstallment = {
  id: number;
  deduction_id: number;
  worker_id: number;
  amount: number;
  date: string;
};

/** One row of the attendance grid, on the way to POST /contractor/attendance/bulk. */
export type BulkAttendanceMark = {
  worker_id: number;
  /** Daily workers. Piece-rate rows default to present server-side. */
  status?: AttendanceStatus;
  note?: string | null;
  /** Piece-rate workers. Both or neither. */
  quantity?: number;
  rate?: number;
  work_description?: string;
  /** Day or night. Per row: a crew can be split across both on one date. */
  shift?: WorkShift;
};

export type BulkAttendanceResult = {
  date: string;
  site_id: number | null;
  created: number;
  updated: number;
  unchanged: number;
  attendance: Attendance[];
  piece_rate_logs: PieceRateLog[];
  piece_rate_total: number;
  installments: DeductionInstallment[];
  deductions_applied: number;
};

export type Tool = {
  id: number;
  site_id: number;
  name: string;
  /** How many the site holds in total, not how many are on the shelf. */
  inventory_count: number;
  notes: string | null;
  is_active: boolean;
  out_count: number;
  /** inventory_count - out_count, floored at zero. */
  available_count: number;
  /** The open checkouts, so a row expands without a second request. */
  assignments: ToolAssignment[];
};

export type ToolAssignment = {
  id: number;
  tool_id: number;
  tool_name: string | null;
  site_id: number | null;
  worker_id: number;
  worker_name: string | null;
  /** ISO datetime — a tool out at 9am and back at 4pm is the point. */
  checkout_time: string;
  return_time: string | null;
  status: ToolAssignmentStatus;
  note: string | null;
};

/** What is still out across every site, for the dashboard badge. */
export type OutstandingTools = {
  out_count: number;
  /** Of those, checked out before today. A tool taken this morning is fine. */
  overdue_count: number;
  assignments: ToolAssignment[];
};

/** How a material is counted. Mirrors `material_unit` in app/models/enums.py. */
export type MaterialUnit =
  | 'bag'
  | 'ton'
  | 'kg'
  | 'litre'
  | 'piece'
  | 'cubic_feet'
  | 'cubic_metre'
  | 'brass'
  | 'square_feet'
  | 'running_feet';

export type SiteInventoryItem = {
  id: number;
  site_id: number;
  item_name: string;
  quantity_in_stock: number;
  unit: MaterialUnit;
  updated_at: string;
};

/** One delivery accepted at a site — the Goods Receipt Note. */
export type MaterialReceipt = {
  id: number;
  site_id: number;
  item_name: string;
  quantity_received: number;
  unit: MaterialUnit;
  date: string;
  supplier: string | null;
  note: string | null;
  received_by: number | null;
  received_by_name: string | null;
  created_at: string;
  /** Link to the photographed challan; null when it was recorded without one. */
  challan_image_url: string | null;
  /** Stock for this item AFTER the delivery was applied. */
  quantity_in_stock: number | null;
};

// --- machinery, diesel and client invoices (Phase 11) ----------------------

/**
 * One machine, one day, on one site.
 *
 * `fuel_cost` is recorded rather than derived from the litres: the rate
 * changes between deliveries and between pumps, and what the site actually
 * holds is a receipt with a number on it. The litres sit beside it because a
 * rising bill is either the machine or the market, and only the litres
 * separate the two.
 */
export type MachineryLog = {
  id: number;
  site_id: number;
  /** Free text — a contractor hires whatever is available that week. */
  machine_name: string;
  hours_operated: number;
  diesel_litres: number;
  fuel_cost: number;
  /** ISO date, YYYY-MM-DD. */
  date: string;
  note: string | null;
  logged_by: number | null;
  logged_by_name: string | null;
  created_at: string;
  /** Link to the photographed diesel receipt; null when logged without one. */
  receipt_image_url: string | null;
};

/** One machine's share of a period. */
export type MachineUsage = {
  machine_name: string;
  hours_operated: number;
  diesel_litres: number;
  fuel_cost: number;
  log_count: number;
};

export type MachineryTotals = {
  site_id: number;
  start_date: string | null;
  end_date: string;
  hours_operated: number;
  diesel_litres: number;
  fuel_cost: number;
  log_count: number;
  by_machine: MachineUsage[];
};

/**
 * Where a client bill has got to.
 *
 * `void` rather than a delete once it has been sent, because an invoice the
 * client has seen is a thing they remember and will ask about.
 */
export type InvoiceStatus = 'draft' | 'sent' | 'paid' | 'void';

/** One row of the preview: a thing that was done or bought, and its cost. */
export type InvoiceLine = {
  kind: 'piece_rate' | 'materials' | 'machinery';
  label: string;
  quantity: number | null;
  unit: string | null;
  rate: number | null;
  amount: number;
};

/**
 * What one site cost over a window, from GET /contractor/invoices/preview.
 *
 * `suggested_total` seeds the amount field and is not an authority: an
 * invoice carries markup, retention and whatever was agreed on the phone,
 * none of which this app models. The admin types over it.
 *
 * The three subtotals can overlap — diesel logged against a machine may also
 * have been filed as a site expense — so they are shown apart rather than
 * silently added twice.
 */
export type InvoicePreview = {
  site_id: number;
  site_name: string;
  start_date: string | null;
  end_date: string;
  piece_rate_total: number;
  materials_total: number;
  machinery_total: number;
  suggested_total: number;
  lines: InvoiceLine[];
  /** Deliveries accepted in the window. Quantities only — a GRN has no cost. */
  material_receipt_count: number;
};

export type Invoice = {
  id: number;
  site_id: number;
  site_name: string | null;
  client_name: string;
  /** What the client was actually billed, frozen when the invoice was raised. */
  total_amount: number;
  status: InvoiceStatus;
  note: string | null;
  created_at: string;
  updated_at: string;
  /** Null until a PDF has been built. */
  pdf_url: string | null;
};
