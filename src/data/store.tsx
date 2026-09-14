/**
 * Loads everything the screens render, from cache first and the API second.
 *
 * On open: the last-known dashboard is painted from AsyncStorage immediately,
 * then a network refresh replaces it. A cold start with no connection still
 * shows the ledger as it was.
 *
 * Writes while offline go to a durable queue (`src/offline/queue.ts`) and are
 * pushed when NetInfo reports the connection back. Read the replay-safety note
 * in that file before changing how the queue drains.
 *
 * What gets fetched depends on the signed-in role:
 *   contractor -> GET /contractor/workers, then that worker's ledger for each
 *   worker     -> GET /worker/ledger
 *
 * KNOWN COST: the contractor view is N+1 requests (one list + one ledger per
 * worker) because `GET /contractor/workers` returns UserRead without a
 * balance. Fine for a crew of a dozen, wasteful beyond that. The fix is on the
 * backend — have the list endpoint include each worker's BalanceSummary.
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';

import { ApiError } from '@/api/client';
import {
  assignTool as assignToolRequest,
  closeDeduction as closeDeductionRequest,
  createAttendance,
  createCashEntry,
  createCategory,
  createAdvanceRequest as createAdvanceRequestRequest,
  createDeduction as createDeductionRequest,
  createPettyCash,
  createInvoice as createInvoiceRequest,
  createMachineryLog,
  createPieceRateLog,
  createTool,
  createTransaction,
  createWorker,
  deleteCashEntry,
  deleteCategory,
  deleteMachineryLog,
  deletePettyCash,
  deleteTool,
  deleteTransaction as deleteTransactionRequest,
  deleteWorker as deleteWorkerRequest,
  decideAdvanceRequest as decideAdvanceRequestRequest,
  disputeAttendance as disputeAttendanceRequest,
  fetchAdvanceRequests,
  fetchCashEntries,
  fetchCategories,
  fetchDeductions,
  fetchInstallments,
  fetchInvoicePreview,
  fetchInvoices,
  fetchMachineryLogs,
  fetchMachineryTotals,
  fetchMaterialReceipts,
  fetchMyAdvanceRequests,
  fetchMyLedger,
  fetchMyProfile,
  fetchMySitePhotos,
  fetchOutstandingTools,
  fetchPayrollPreview,
  fetchPettyCash,
  fetchPettyCashTotals,
  fetchPieceRateLogs,
  fetchSiteInventory,
  fetchSitePhotos,
  fetchSites,
  fetchSupervisors,
  fetchSummary,
  fetchTools,
  fetchWorkerLedger,
  fetchWorkers,
  recomputeDeduction as recomputeDeductionRequest,
  receiveMaterial as receiveMaterialRequest,
  updateInvoice as updateInvoiceRequest,
  returnTool as returnToolRequest,
  scanAttendance as scanAttendanceRequest,
  submitBulkAttendance as submitBulkAttendanceRequest,
  createSite as createSiteRequest,
  deleteSite as deleteSiteRequest,
  deleteSitePhoto as deleteSitePhotoRequest,
  updateAttendance as updateAttendanceRequest,
  markSiteRainedOut as markSiteRainedOutRequest,
  settlePayroll as settlePayrollRequest,
  updateCategory,
  updateDeduction as updateDeductionRequest,
  updateSite as updateSiteRequest,
  updateWorker as updateWorkerRequest,
  uploadMySitePhoto as uploadMySitePhotoRequest,
  uploadSitePhoto as uploadSitePhotoRequest,
  type WorkerLedger,
  type WorkerProfile,
} from '@/api/endpoints';
import { useAuth } from '@/auth/auth-context';
import { canRunSites, isAdmin } from '@/data/types';
import type {
  AdvanceRequest,
  AdvanceRequestStatus,
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
  InvoicePreview,
  InvoiceStatus,
  MachineryLog,
  MachineryTotals,
  MaterialReceipt,
  MaterialUnit,
  OutstandingTools,
  PaymentMode,
  PayrollSettlement,
  PayrollSummary,
  PettyCashEntry,
  PettyCashTotals,
  PieceRateLog,
  RainOutResult,
  Site,
  SiteInventoryItem,
  SitePhoto,
  Tool,
  ToolAssignment,
  User,
  WageType,
  WorkerTrade,
  WorkShift,
} from '@/data/types';
import { clearCache, readCache, writeCache } from '@/offline/cache';
import { flushQueue } from '@/offline/flush';
import {
  clearQueue,
  enqueue,
  readQueue,
  replaceQueue,
  type QueuedItem,
} from '@/offline/queue';
import { useNetworkStatus } from '@/offline/use-network-status';

export type WorkerWithBalance = User & { balance: BalanceSummary };

/** How many recent cash entries the Home screen keeps around. */
const CASH_ENTRY_LIMIT = 100;

type StoreValue = {
  workers: WorkerWithBalance[];
  myLedger: WorkerLedger | null;

  /** The jobs this contractor is running. Empty for a signed-in worker. */
  sites: Site[];

  /**
   * Tools still checked out, across every site. Null until the first load.
   *
   * Held in the store rather than fetched per screen because the dashboard
   * badge reads it on every open, and it is one small request.
   */
  outstandingTools: OutstandingTools | null;

  /** The contractor cash box. Empty for a signed-in worker. */
  summary: CashSummary | null;
  categories: CashCategory[];
  cashEntries: CashEntry[];

  /** First load with nothing to show — not set when the cache had something. */
  loading: boolean;
  refreshing: boolean;
  error: string | null;
  /** When the on-screen data was last written to cache; null if never. */
  cachedAt: number | null;
  /** True when showing cache because the network could not be reached. */
  isStale: boolean;

  isOnline: boolean;
  pending: QueuedItem[];
  syncing: boolean;
  /** Queued writes that were abandoned; call dismissFailures to clear. */
  failures: QueuedItem[];
  dismissFailures: () => void;

  getLedger: (workerId: number) => WorkerLedger | undefined;
  getAttendanceOn: (workerId: number, date: string) => Attendance | undefined;
  refresh: () => Promise<void>;
  giveAdvance: (input: {
    worker_id: number;
    amount: number;
    date: string;
    payment_mode?: PaymentMode | null;
    audio_note_path?: string | null;
    note?: string | null;
    /**
     * Open an installment plan against this advance, recovering this much per
     * day worked. Sending it makes the write require a connection — see the
     * note on the implementation.
     */
    daily_deduction?: number | null;
  }) => Promise<void>;
  markAttendance: (input: {
    worker_id: number;
    date: string;
    status: AttendanceStatus;
    shift?: WorkShift;
    note?: string | null;
  }) => Promise<void>;

  /** Mark a worker present from a QR scan. Idempotent server-side. */
  scanAttendance: (workerId: number) => Promise<Attendance>;

  /** Take a worker off the crew. Deactivates; the ledger survives. */
  removeWorker: (workerId: number, options?: { purge?: boolean }) => Promise<void>;

  /** Undo a mistyped wage, advance or payment. Needs a connection. */
  deleteTransaction: (transactionId: number) => Promise<void>;

  // Advance requests. The contractor's queue and the worker's own list.
  getAdvanceRequests: (
    options?: { status?: AdvanceRequestStatus },
    signal?: AbortSignal
  ) => Promise<AdvanceRequest[]>;
  getMyAdvanceRequests: (signal?: AbortSignal) => Promise<AdvanceRequest[]>;
  /** The signed-in worker's own record, including their posted site. */
  getMyProfile: (signal?: AbortSignal) => Promise<WorkerProfile>;
  /** The photo feed for the site this worker is posted to. */
  getMySitePhotos: (signal?: AbortSignal) => Promise<SitePhoto[]>;
  /** Post a snap to their own site. The server decides which site that is. */
  addMySitePhoto: (
    photo: { uri: string; name?: string; mimeType?: string },
    fields?: { date?: string; description?: string | null }
  ) => Promise<SitePhoto>;
  requestAdvance: (input: {
    amount: number;
    reason?: string | null;
    audio_note_path?: string | null;
  }) => Promise<AdvanceRequest>;
  /** Approving writes the ADVANCE row, so the whole dashboard refreshes. */
  decideAdvanceRequest: (
    requestId: number,
    input: {
      status: 'approved' | 'rejected';
      approved_amount?: number | null;
      payment_mode?: PaymentMode | null;
      note?: string | null;
    }
  ) => Promise<AdvanceRequest>;
  /** A worker flagging one attendance row as wrong. */
  disputeAttendance: (
    attendanceId: number,
    input?: { disputed?: boolean; audio_note_path?: string | null }
  ) => Promise<Attendance>;
  /** Only `name` is required; see `AddWorkerModal` for why. */
  addWorker: (input: {
    name: string;
    phone?: string | null;
    password?: string | null;
    daily_wage?: number | null;
    trade?: WorkerTrade | null;
    wage_type?: WageType;
    site_id?: number | null;
  }) => Promise<void>;

  /** Submit the whole attendance grid at once. Needs a connection. */
  submitBulkAttendance: (input: {
    marks: BulkAttendanceMark[];
    date?: string;
    site_id?: number | null;
    overwrite?: boolean;
  }) => Promise<BulkAttendanceResult>;

  /** Log measured piece work. The server writes the matching wage. */
  addPieceRateLog: (input: {
    worker_id: number;
    work_description: string;
    quantity: number;
    rate: number;
    site_id?: number | null;
    date?: string;
    note?: string | null;
  }) => Promise<PieceRateLog>;

  /** Measured work already logged. Read per screen, like the photo feed. */
  getPieceRateLogs: (
    options?: { workerId?: number; siteId?: number; limit?: number },
    signal?: AbortSignal
  ) => Promise<PieceRateLog[]>;

  // Installment plans. Read per screen; the only figure the dashboard needs
  // is already on the payroll preview.
  getDeductions: (
    options?: { workerId?: number; activeOnly?: boolean },
    signal?: AbortSignal
  ) => Promise<AutoDeduction[]>;
  createDeduction: (input: {
    worker_id: number;
    principal_amount: number;
    daily_deduction: number;
    note?: string | null;
  }) => Promise<AutoDeduction>;
  /** Change the daily rate. `principal_amount` is deliberately not editable. */
  updateDeduction: (
    deductionId: number,
    changes: { daily_deduction?: number; note?: string | null }
  ) => Promise<AutoDeduction>;
  closeDeduction: (deductionId: number) => Promise<void>;
  getInstallments: (
    deductionId: number,
    signal?: AbortSignal
  ) => Promise<DeductionInstallment[]>;
  /** Repair hatch: re-derive the rollup from the installments behind it. */
  recomputeDeduction: (deductionId: number) => Promise<AutoDeduction>;

  // Petty cash. Fetched per site screen rather than held in the store.
  getPettyCash: (siteId: number, signal?: AbortSignal) => Promise<PettyCashEntry[]>;
  getPettyCashTotals: (siteId: number, signal?: AbortSignal) => Promise<PettyCashTotals>;
  addPettyCash: (
    siteId: number,
    input: { amount: number; description: string; date?: string }
  ) => Promise<PettyCashEntry>;
  removePettyCash: (siteId: number, entryId: number) => Promise<void>;

  // Tools.
  getTools: (siteId: number, signal?: AbortSignal) => Promise<Tool[]>;
  addTool: (
    siteId: number,
    input: { name: string; inventory_count?: number; notes?: string | null }
  ) => Promise<Tool>;
  removeTool: (siteId: number, toolId: number) => Promise<void>;
  assignTool: (siteId: number, toolId: number, workerId: number) => Promise<ToolAssignment>;
  returnTool: (assignmentId: number, status?: 'returned' | 'lost') => Promise<ToolAssignment>;

  // Material GRN.
  getSiteInventory: (siteId: number, signal?: AbortSignal) => Promise<SiteInventoryItem[]>;
  getMaterialReceipts: (siteId: number, signal?: AbortSignal) => Promise<MaterialReceipt[]>;
  receiveMaterial: (
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
  ) => Promise<MaterialReceipt>;

  /**
   * The contractor's supervisors, for the assignment picker on a site.
   *
   * Fetched on demand rather than held: it is a short list, read on one
   * screen, and the API refuses a supervisor asking for it at all.
   */
  getSupervisors: (signal?: AbortSignal) => Promise<User[]>;

  // Machinery and diesel. Per site, like petty cash and stock — the Home
  // screen never shows it, so a contractor with six sites should not pay for
  // five of them on every refresh.
  getMachineryLogs: (siteId: number, signal?: AbortSignal) => Promise<MachineryLog[]>;
  getMachineryTotals: (siteId: number, signal?: AbortSignal) => Promise<MachineryTotals>;
  addMachineryLog: (
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
  ) => Promise<MachineryLog>;
  removeMachineryLog: (siteId: number, logId: number) => Promise<void>;

  // Client invoices. Admin only — the API refuses a supervisor outright.
  getInvoices: (
    options?: { siteId?: number; status?: InvoiceStatus },
    signal?: AbortSignal
  ) => Promise<Invoice[]>;
  /** What a site cost over a window. Reads only — writes nothing. */
  getInvoicePreview: (
    siteId: number,
    options?: { startDate?: string; endDate?: string },
    signal?: AbortSignal
  ) => Promise<InvoicePreview>;
  addInvoice: (input: {
    site_id: number;
    client_name: string;
    total_amount: number;
    status?: InvoiceStatus;
    note?: string | null;
  }) => Promise<Invoice>;
  editInvoice: (
    invoiceId: number,
    changes: {
      client_name?: string;
      total_amount?: number;
      status?: InvoiceStatus;
      note?: string | null;
    }
  ) => Promise<Invoice>;

  /** What settling a period would pay. Reads only - writes nothing. */
  previewPayroll: (
    workerId: number,
    range?: { startDate?: string | null; endDate?: string | null },
    signal?: AbortSignal
  ) => Promise<PayrollSummary>;
  addSite: (input: { name: string; address?: string | null }) => Promise<Site>;
  /** Post a worker to a site, or pass null to take them off one. */
  assignWorkerToSite: (workerId: number, siteId: number | null) => Promise<void>;
  editSite: (
    siteId: number,
    changes: {
      name?: string;
      address?: string | null;
      is_active?: boolean;
      /** Explicit null unassigns; the site goes back to being run by the admin. */
      supervisor_id?: number | null;
    }
  ) => Promise<void>;

  /**
   * Take a site off the list. Closes it by default, keeping its history;
   * `purge` hard deletes and the API refuses that once anything is on record.
   */
  removeSite: (siteId: number, options?: { purge?: boolean }) => Promise<void>;

  /**
   * Correct a day already marked. Needs a connection — see the implementation.
   */
  editAttendance: (
    attendanceId: number,
    changes: {
      date?: string;
      status?: AttendanceStatus;
      shift?: WorkShift;
      note?: string | null;
    }
  ) => Promise<Attendance>;

  /** A site's photo feed. Fetched per screen rather than held in the store. */
  getSitePhotos: (siteId: number, signal?: AbortSignal) => Promise<SitePhoto[]>;
  addSitePhoto: (
    siteId: number,
    photo: { uri: string; name?: string; mimeType?: string },
    fields?: { date?: string; description?: string | null }
  ) => Promise<SitePhoto>;
  removeSitePhoto: (siteId: number, photoId: number) => Promise<void>;

  /** Mark a whole site rained out for the day. Needs a connection. */
  markRainOut: (siteId: number, options?: { date?: string }) => Promise<RainOutResult>;

  /** Pay a period off and clear the balance. Needs a connection. */
  settlePayroll: (input: {
    worker_id: number;
    start_date?: string | null;
    end_date?: string | null;
    payment_mode: PaymentMode;
    note?: string | null;
  }) => Promise<PayrollSettlement>;

  /** Log a general expense or a payment received. Queues when offline. */
  addCashEntry: (input: {
    category_id: number | null;
    direction: CashDirection;
    amount: number;
    date: string;
    note?: string | null;
  }) => Promise<void>;
  removeCashEntry: (entryId: number) => Promise<void>;

  addCategory: (input: {
    name: string;
    direction: CashDirection;
    icon?: string | null;
    color?: string | null;
  }) => Promise<void>;
  renameCategory: (categoryId: number, name: string) => Promise<void>;
  removeCategory: (categoryId: number) => Promise<void>;
};

const StoreContext = createContext<StoreValue | null>(null);

export function StoreProvider({ children }: { children: ReactNode }) {
  const { token, user, handleUnauthorized } = useAuth();
  const { isOnline } = useNetworkStatus();

  const [workers, setWorkers] = useState<WorkerWithBalance[]>([]);
  const [ledgers, setLedgers] = useState<Map<number, WorkerLedger>>(new Map());
  const [myLedger, setMyLedger] = useState<WorkerLedger | null>(null);
  const [sites, setSites] = useState<Site[]>([]);
  const [outstandingTools, setOutstandingTools] = useState<OutstandingTools | null>(null);
  const [summary, setSummary] = useState<CashSummary | null>(null);
  const [categories, setCategories] = useState<CashCategory[]>([]);
  const [cashEntries, setCashEntries] = useState<CashEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [cachedAt, setCachedAt] = useState<number | null>(null);
  const [isStale, setIsStale] = useState(false);

  const [pending, setPending] = useState<QueuedItem[]>([]);
  const [failures, setFailures] = useState<QueuedItem[]>([]);
  const [syncing, setSyncing] = useState(false);

  const abortRef = useRef<AbortController | null>(null);
  // Guards against two flushes overlapping (reconnect + manual refresh).
  const flushingRef = useRef(false);

  const reset = useCallback(() => {
    setWorkers([]);
    setLedgers(new Map());
    setMyLedger(null);
    setSites([]);
    setOutstandingTools(null);
    setSummary(null);
    setCategories([]);
    setCashEntries([]);
    setError(null);
    setCachedAt(null);
    setIsStale(false);
    setPending([]);
    setFailures([]);
  }, []);

  const describeError = useCallback(
    (caught: unknown): string => {
      if (caught instanceof ApiError) {
        if (caught.isUnauthorized) {
          handleUnauthorized();
          return 'Your session has expired. Please log in again.';
        }
        return caught.message;
      }
      return 'Something went wrong. Please try again.';
    },
    [handleUnauthorized]
  );

  /** Push whatever is queued, then report what is left. */
  const drain = useCallback(async (): Promise<boolean> => {
    if (!token || !user || flushingRef.current) return false;

    const queued = await readQueue(user.id);
    if (queued.length === 0) return false;

    flushingRef.current = true;
    setSyncing(true);
    try {
      const result = await flushQueue(token, queued);
      await replaceQueue(user.id, result.remaining);
      setPending(result.remaining);
      if (result.failed.length) setFailures((current) => [...current, ...result.failed]);
      return result.synced > 0;
    } finally {
      flushingRef.current = false;
      setSyncing(false);
    }
  }, [token, user]);

  const load = useCallback(
    async (mode: 'initial' | 'refresh') => {
      if (!token || !user) return;

      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;

      if (mode === 'refresh') setRefreshing(true);
      setError(null);

      try {
        if (canRunSites(user.role) && !isAdmin(user.role)) {
          // --- supervisor ---------------------------------------------------
          //
          // A narrower load than the admin one below, and narrower on
          // purpose: the cash box, the categories and every worker ledger are
          // admin-only server-side, so asking for them here would not just
          // waste requests, it would 403 and take the whole dashboard down
          // with it. What a supervisor needs is their site, their crew and
          // what is still checked out.
          const [crew, freshSites, freshTools] = await Promise.all([
            fetchWorkers(token, controller.signal),
            fetchSites(token, controller.signal),
            fetchOutstandingTools(token, controller.signal),
          ]);
          if (controller.signal.aborted) return;

          // Zeroed rather than fetched: `GET /workers/{id}/ledger` is admin
          // only, and a supervisor has no screen that shows a balance. The
          // attendance grid is the only thing that reads this list for them.
          const withoutBalances = crew.map((worker) => ({
            ...worker,
            balance: {
              total_wages: 0,
              total_advances: 0,
              total_payments: 0,
              balance: 0,
            },
          }));

          setWorkers(withoutBalances);
          setSites(freshSites);
          setOutstandingTools(freshTools);
          setLedgers(new Map());
          setSummary(null);
          setCategories([]);
          setCashEntries([]);
          await writeCache(user.id, {
            workers: withoutBalances,
            ledgers: [],
            myLedger: null,
            summary: null,
            categories: [],
            cashEntries: [],
          });
        } else if (canRunSites(user.role)) {
          // The cash box does not depend on the crew, so it goes out at the
          // same time rather than after it.
          const [crew, cashBox] = await Promise.all([
            fetchWorkers(token, controller.signal),
            Promise.all([
              fetchSummary(token, controller.signal),
              fetchCategories(token, controller.signal),
              fetchCashEntries(token, { limit: CASH_ENTRY_LIMIT }, controller.signal),
              // Sites do not depend on the crew either, so they go out in the
              // same wave rather than adding a round trip after it.
              fetchSites(token, controller.signal),
              // The dashboard's end-of-shift tool badge. One small request,
              // in the same wave rather than after it.
              fetchOutstandingTools(token, controller.signal),
            ]),
          ]);
          const crewLedgers = await Promise.all(
            crew.map((worker) => fetchWorkerLedger(token, worker.id, controller.signal))
          );
          if (controller.signal.aborted) return;

          const [freshSummary, freshCategories, freshEntries, freshSites, freshTools] =
            cashBox;
          const withBalances = crew.map((worker, index) => ({
            ...worker,
            balance: crewLedgers[index].balance,
          }));
          setLedgers(new Map(crewLedgers.map((ledger) => [ledger.worker.id, ledger])));
          setWorkers(withBalances);
          setSummary(freshSummary);
          setCategories(freshCategories);
          setCashEntries(freshEntries);
          setSites(freshSites);
          setOutstandingTools(freshTools);
          await writeCache(user.id, {
            workers: withBalances,
            ledgers: crewLedgers,
            myLedger: null,
            summary: freshSummary,
            categories: freshCategories,
            cashEntries: freshEntries,
          });
        } else {
          const ledger = await fetchMyLedger(token, controller.signal);
          if (controller.signal.aborted) return;
          setMyLedger(ledger);
          await writeCache(user.id, {
            workers: [],
            ledgers: [],
            myLedger: ledger,
            summary: null,
            categories: [],
            cashEntries: [],
          });
        }

        setCachedAt(Date.now());
        setIsStale(false);
      } catch (caught) {
        if (controller.signal.aborted) return;
        setError(describeError(caught));
        // Anything already on screen came from cache and is now known-stale.
        if (caught instanceof ApiError && caught.isNetworkError) setIsStale(true);
      } finally {
        if (!controller.signal.aborted) {
          setLoading(false);
          setRefreshing(false);
        }
      }
    },
    [token, user, describeError]
  );

  // Sign-in: paint the cache, then go to the network. Sign-out: forget both.
  useEffect(() => {
    if (!token || !user) {
      abortRef.current?.abort();
      // Dropping one user's data the moment their session ends is the whole
      // job of this branch, and it has to happen in a render the signed-out
      // user can no longer see. The lint rule cannot tell this apart from an
      // ordinary derived-state cascade.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      reset();
      return;
    }

    let active = true;

    (async () => {
      setLoading(true);

      const [cached, queued] = await Promise.all([readCache(user.id), readQueue(user.id)]);
      if (!active) return;

      if (cached) {
        setWorkers(cached.workers);
        setLedgers(new Map(cached.ledgers.map((ledger) => [ledger.worker.id, ledger])));
        setMyLedger(cached.myLedger);
        setSummary(cached.summary);
        setCategories(cached.categories);
        setCashEntries(cached.cashEntries);
        setCachedAt(cached.cachedAt);
        // Something is on screen, so the network round trip is no longer
        // blocking — drop the spinner now.
        setLoading(false);
      }
      setPending(queued);

      await drain();
      if (!active) return;
      await load('initial');
    })();

    return () => {
      active = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, user?.id, user?.role]);

  // Reconnected: push what was queued, then pull fresh data.
  useEffect(() => {
    if (!isOnline || !token || !user) return;

    (async () => {
      const sentSomething = await drain();
      if (sentSomething || isStale) await load('refresh');
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOnline, token, user?.id]);

  useEffect(() => () => abortRef.current?.abort(), []);

  const refresh = useCallback(async () => {
    await drain();
    await load('refresh');
  }, [drain, load]);

  const getLedger = useCallback(
    (workerId: number) => (myLedger?.worker.id === workerId ? myLedger : ledgers.get(workerId)),
    [ledgers, myLedger]
  );

  const getAttendanceOn = useCallback(
    (workerId: number, date: string) => {
      // A queued mark has not reached the server, but the contractor did make
      // it — showing the row as unmarked would invite a duplicate.
      const queued = pending.find(
        (item) =>
          item.kind === 'attendance' &&
          item.payload.worker_id === workerId &&
          item.payload.date === date
      );
      if (queued && queued.kind === 'attendance') {
        return {
          id: -1, // local-only; never collides with a server id
          worker_id: workerId,
          date,
          status: queued.payload.status,
          shift: queued.payload.shift ?? 'day',
          note: queued.payload.note ?? null,
          // Nothing has reached the server yet, so there is nothing to know
          // about a site, a dispute or a recording.
          site_id: null,
          is_disputed: false,
          audio_note_url: null,
        } satisfies Attendance;
      }

      const ledger = ledgers.get(workerId) ?? (myLedger?.worker.id === workerId ? myLedger : null);
      const entry = ledger?.entries.find(
        (candidate) => candidate.kind === 'attendance' && candidate.date === date
      );
      return entry?.kind === 'attendance' ? entry.attendance : undefined;
    },
    [ledgers, myLedger, pending]
  );

  const requireSession = useCallback((): { token: string; userId: number } => {
    if (!token || !user) throw new ApiError('You are not signed in', 401);
    return { token, userId: user.id };
  }, [token, user]);

  /**
   * Try the network; if the device is offline, queue it instead.
   *
   * A queued write resolves successfully — from the contractor's point of view
   * the entry is recorded, and the sync banner tracks the rest.
   */
  const writeOrQueue = useCallback(
    async (
      item: Parameters<typeof enqueue>[1],
      send: (token: string) => Promise<unknown>
    ): Promise<void> => {
      const { token: authToken, userId } = requireSession();

      if (!isOnline) {
        setPending(await enqueue(userId, item));
        return;
      }

      try {
        await send(authToken);
      } catch (caught) {
        // Went offline between the check and the request.
        if (caught instanceof ApiError && caught.isNetworkError) {
          setPending(await enqueue(userId, item));
          return;
        }
        throw caught;
      }

      await load('refresh');
    },
    [requireSession, isOnline, load]
  );

  /**
   * An ordinary advance queues offline. One with an installment plan does not.
   *
   * The server refuses a second active plan against a worker, so a queued
   * replay whose first attempt actually landed would come back 409 — and
   * `transactions` has no idempotency key to tell the two apart. Rather than
   * guess, the EMI switch is disabled offline and this throws if it somehow
   * gets through.
   */
  const giveAdvance = useCallback(
    async (input: {
      worker_id: number;
      amount: number;
      date: string;
      payment_mode?: PaymentMode | null;
      audio_note_path?: string | null;
      note?: string | null;
      daily_deduction?: number | null;
    }) => {
      const payload = { ...input, type: 'advance' as const };

      if (input.daily_deduction) {
        const { token: authToken } = requireSession();
        if (!isOnline) {
          throw new ApiError(
            'Recovering an advance in installments needs a connection. Save it without installments, or try again once you are back online.',
            0,
            true
          );
        }
        await createTransaction(authToken, payload);
        await load('refresh');
        return;
      }

      await writeOrQueue({ kind: 'transaction', payload }, (authToken) =>
        createTransaction(authToken, payload)
      );
    },
    [writeOrQueue, requireSession, isOnline, load]
  );

  const markAttendance = useCallback(
    async (input: {
      worker_id: number;
      date: string;
      status: AttendanceStatus;
      shift?: WorkShift;
      note?: string | null;
    }) => {
      await writeOrQueue({ kind: 'attendance', payload: input }, (authToken) =>
        createAttendance(authToken, input)
      );
    },
    [writeOrQueue]
  );

  const scanAttendance = useCallback(
    async (workerId: number) => {
      const { token: authToken } = requireSession();
      const marked = await scanAttendanceRequest(authToken, { worker_id: workerId });
      // Deliberately no refresh: the scanner marks a whole crew in a burst and
      // a dashboard reload per scan would fight the camera for the main
      // thread. The grid catches up when the screen is left.
      return marked;
    },
    [requireSession]
  );

  /**
   * Take a worker off the crew.
   *
   * Needs a connection: the crew list is rebuilt from the server response, and
   * a queued removal would leave a worker on screen who the contractor
   * believes is gone - the one state worse than an error.
   */
  const removeWorker = useCallback(
    async (workerId: number, options: { purge?: boolean } = {}) => {
      const { token: authToken } = requireSession();
      await deleteWorkerRequest(authToken, workerId, options);
      await load('refresh');
    },
    [requireSession, load]
  );

  /**
   * Undo a mistyped ledger entry.
   *
   * REFETCHES RATHER THAN PATCHING THE ROW OUT
   * ------------------------------------------
   * Dropping the entry from local state would clear the list instantly and
   * leave every derived figure stale: the worker's balance, the crew's
   * outstanding total and the cash summary on Home are all computed
   * server-side, and an advance removed here moves all three. `load('refresh')`
   * is one round trip that brings back a consistent set, which is worth more
   * than the frame it costs.
   *
   * Never queued offline, for the reason `TRANSACTION_RETRY_IS_SAFE` is false:
   * a transaction has no idempotency key, so a replayed delete cannot be told
   * apart from a fresh one. Failing loudly while offline is the honest answer.
   */
  const deleteTransaction = useCallback(
    async (transactionId: number) => {
      const { token: authToken } = requireSession();
      await deleteTransactionRequest(authToken, transactionId);
      await load('refresh');
    },
    [requireSession, load]
  );

  // --- advance requests -----------------------------------------------------

  const getAdvanceRequests = useCallback(
    async (options: { status?: AdvanceRequestStatus } = {}, signal?: AbortSignal) => {
      const { token: authToken } = requireSession();
      return fetchAdvanceRequests(authToken, options, signal);
    },
    [requireSession]
  );

  const getMyAdvanceRequests = useCallback(
    async (signal?: AbortSignal) => {
      const { token: authToken } = requireSession();
      return fetchMyAdvanceRequests(authToken, signal);
    },
    [requireSession]
  );

  const getMyProfile = useCallback(
    async (signal?: AbortSignal) => {
      const { token: authToken } = requireSession();
      return fetchMyProfile(authToken, signal);
    },
    [requireSession]
  );

  const getMySitePhotos = useCallback(
    async (signal?: AbortSignal) => {
      const { token: authToken } = requireSession();
      return fetchMySitePhotos(authToken, signal);
    },
    [requireSession]
  );

  const addMySitePhoto = useCallback(
    async (
      photo: { uri: string; name?: string; mimeType?: string },
      fields: { date?: string; description?: string | null } = {}
    ) => {
      const { token: authToken } = requireSession();
      // Not queueable: the bytes live in a cache directory the OS is free to
      // clear, so a photo held for later may not exist by the time it drains.
      return uploadMySitePhotoRequest(authToken, photo, fields);
    },
    [requireSession]
  );

  const requestAdvance = useCallback(
    async (input: {
      amount: number;
      reason?: string | null;
      audio_note_path?: string | null;
    }) => {
      const { token: authToken } = requireSession();
      // Nothing reaches the ledger until it is approved, so no refresh here.
      return createAdvanceRequestRequest(authToken, input);
    },
    [requireSession]
  );

  const decideAdvanceRequest = useCallback(
    async (
      requestId: number,
      input: {
        status: 'approved' | 'rejected';
        approved_amount?: number | null;
        payment_mode?: PaymentMode | null;
        note?: string | null;
      }
    ) => {
      const { token: authToken } = requireSession();
      const decided = await decideAdvanceRequestRequest(authToken, requestId, input);
      // An approval writes the ADVANCE row server-side, so the balance moved.
      if (input.status === 'approved') await load('refresh');
      return decided;
    },
    [requireSession, load]
  );

  const disputeAttendance = useCallback(
    async (
      attendanceId: number,
      input: { disputed?: boolean; audio_note_path?: string | null } = {}
    ) => {
      const { token: authToken } = requireSession();
      const updated = await disputeAttendanceRequest(authToken, attendanceId, input);
      // The flag renders off the ledger the dashboard already holds.
      await load('refresh');
      return updated;
    },
    [requireSession, load]
  );

  // Deliberately not queueable: a worker needs a server-assigned id before any
  // entry can reference them, so this one requires a connection.
  const addWorker = useCallback(
    async (input: {
      name: string;
      phone?: string | null;
      password?: string | null;
      daily_wage?: number | null;
      trade?: WorkerTrade | null;
      wage_type?: WageType;
      site_id?: number | null;
    }) => {
      const { token: authToken } = requireSession();
      await createWorker(authToken, input);
      await load('refresh');
    },
    [requireSession, load]
  );

  // Sites are not queueable: a photo or a rain-out has to reference a
  // server-assigned site id, so creating one needs a connection.
  const addSite = useCallback(
    async (input: { name: string; address?: string | null }) => {
      const { token: authToken } = requireSession();
      const created = await createSiteRequest(authToken, input);
      // On screen now; the picker is usually the next thing tapped.
      setSites((current) => [...current, created]);
      await load('refresh');
      return created;
    },
    [requireSession, load]
  );

  const assignWorkerToSite = useCallback(
    async (workerId: number, siteId: number | null) => {
      const { token: authToken } = requireSession();
      await updateWorkerRequest(authToken, workerId, { site_id: siteId });
      // Both the crew list and every site's worker_count move, so this
      // takes the full refresh rather than patching two places by hand.
      await load('refresh');
    },
    [requireSession, load]
  );

  const editSite = useCallback(
    async (
      siteId: number,
      changes: {
      name?: string;
      address?: string | null;
      is_active?: boolean;
      /** Explicit null unassigns; the site goes back to being run by the admin. */
      supervisor_id?: number | null;
    }
    ) => {
      const { token: authToken } = requireSession();
      const updated = await updateSiteRequest(authToken, siteId, changes);
      setSites((current) => current.map((site) => (site.id === siteId ? updated : site)));
    },
    [requireSession]
  );

  /**
   * Take a site off the list.
   *
   * Not queueable, for the same reason removing a worker is not: the list is
   * rebuilt from the server's answer, and a queued deletion would leave a site
   * on screen the contractor believes is gone.
   *
   * The full refresh rather than a local filter is deliberate — closing a site
   * unassigns its supervisor, and purging one unposts its crew, so `workers`
   * moves as well as `sites`.
   */
  const removeSite = useCallback(
    async (siteId: number, options: { purge?: boolean } = {}) => {
      const { token: authToken } = requireSession();
      await deleteSiteRequest(authToken, siteId, options);
      await load('refresh');
    },
    [requireSession, load]
  );

  /**
   * Correct a day already marked.
   *
   * Not queueable. A correction is a statement about a row that already exists
   * on the server, and replaying one later would land on whatever the day
   * looks like by then — including a row somebody else has since fixed.
   *
   * Takes the full refresh because the grid reads attendance out of each
   * worker's ledger, and a status change can hand back an installment, which
   * moves their balance too.
   */
  const editAttendance = useCallback(
    async (
      attendanceId: number,
      changes: {
        date?: string;
        status?: AttendanceStatus;
        shift?: WorkShift;
        note?: string | null;
      }
    ) => {
      const { token: authToken } = requireSession();
      const updated = await updateAttendanceRequest(authToken, attendanceId, changes);
      await load('refresh');
      return updated;
    },
    [requireSession, load]
  );

  const getSitePhotos = useCallback(
    async (siteId: number, signal?: AbortSignal) => {
      const { token: authToken } = requireSession();
      return fetchSitePhotos(authToken, siteId, {}, signal);
    },
    [requireSession]
  );

  const addSitePhoto = useCallback(
    async (
      siteId: number,
      photo: { uri: string; name?: string; mimeType?: string },
      fields: { date?: string; description?: string | null } = {}
    ) => {
      const { token: authToken } = requireSession();
      const created = await uploadSitePhotoRequest(authToken, siteId, photo, fields);
      // Only the photo_count moves, so this refreshes the site list rather
      // than the whole dashboard.
      setSites((current) =>
        current.map((site) =>
          site.id === siteId ? { ...site, photo_count: site.photo_count + 1 } : site
        )
      );
      return created;
    },
    [requireSession]
  );

  const removeSitePhoto = useCallback(
    async (siteId: number, photoId: number) => {
      const { token: authToken } = requireSession();
      await deleteSitePhotoRequest(authToken, siteId, photoId);
      setSites((current) =>
        current.map((site) =>
          site.id === siteId
            ? { ...site, photo_count: Math.max(site.photo_count - 1, 0) }
            : site
        )
      );
    },
    [requireSession]
  );

  /**
   * Not queueable, for the same reason a settlement is not: this writes one
   * attendance row per worker on the site, and a replay would silently
   * overwrite whatever was marked in between. The button is disabled offline.
   */
  const markRainOut = useCallback(
    async (siteId: number, options: { date?: string } = {}) => {
      const { token: authToken } = requireSession();
      const result = await markSiteRainedOutRequest(authToken, siteId, options);
      // The grid reads attendance out of each worker's ledger, so the whole
      // dashboard has to come back for the new marks to show.
      await load('refresh');
      return result;
    },
    [requireSession, load]
  );

  const previewPayroll = useCallback(
    async (
      workerId: number,
      range: { startDate?: string | null; endDate?: string | null } = {},
      signal?: AbortSignal
    ) => {
      const { token: authToken } = requireSession();
      return fetchPayrollPreview(authToken, workerId, range, signal);
    },
    [requireSession]
  );

  /**
   * Deliberately not queueable, and the one write in this store that says so
   * out loud. A settlement is the largest single amount the app ever sends;
   * `transactions` has no idempotency key, so a replay whose first attempt
   * actually landed would pay a full period twice. Offline, the contractor is
   * told to wait rather than having it silently deferred.
   */
  const settlePayroll = useCallback(
    async (input: {
      worker_id: number;
      start_date?: string | null;
      end_date?: string | null;
      payment_mode: PaymentMode;
      note?: string | null;
    }) => {
      const { token: authToken } = requireSession();
      const settlement = await settlePayrollRequest(authToken, input);
      await load('refresh');
      return settlement;
    },
    [requireSession, load]
  );

  const addCashEntry = useCallback(
    async (input: {
      category_id: number | null;
      direction: CashDirection;
      amount: number;
      date: string;
      note?: string | null;
    }) => {
      await writeOrQueue({ kind: 'cash', payload: input }, (authToken) =>
        // No clientRef on the online path: the entry is only queued if the
        // request never left the device, and the queue supplies its own key
        // when it later replays.
        createCashEntry(authToken, input)
      );
    },
    [writeOrQueue]
  );

  const removeCashEntry = useCallback(
    async (entryId: number) => {
      const { token: authToken } = requireSession();
      await deleteCashEntry(authToken, entryId);
      await load('refresh');
    },
    [requireSession, load]
  );

  // Categories are not queueable: an entry has to reference a server-assigned
  // category id, so creating one needs a connection.
  const addCategory = useCallback(
    async (input: {
      name: string;
      direction: CashDirection;
      icon?: string | null;
      color?: string | null;
    }) => {
      const { token: authToken } = requireSession();
      const created = await createCategory(authToken, input);
      // Put it on screen now; the picker is usually the next thing tapped.
      setCategories((current) => [...current, created]);
      await load('refresh');
    },
    [requireSession, load]
  );

  const renameCategory = useCallback(
    async (categoryId: number, name: string) => {
      const { token: authToken } = requireSession();
      const updated = await updateCategory(authToken, categoryId, { name });
      setCategories((current) =>
        current.map((category) => (category.id === categoryId ? updated : category))
      );
      await load('refresh');
    },
    [requireSession, load]
  );

  const removeCategory = useCallback(
    async (categoryId: number) => {
      const { token: authToken } = requireSession();
      await deleteCategory(authToken, categoryId);
      setCategories((current) => current.filter((category) => category.id !== categoryId));
      await load('refresh');
    },
    [requireSession, load]
  );

  /**
   * Submit the whole attendance grid at once.
   *
   * Not queueable, for the same reason a rain-out is not: it writes a row per
   * worker, plus wages and installments, and a replay would land against
   * whatever the day looks like by then rather than what was on screen. The
   * server is replay-safe (see submitBulkAttendance in api/endpoints.ts), but
   * the button is disabled offline rather than deferring silently.
   */
  const submitBulkAttendance = useCallback(
    async (input: {
      marks: BulkAttendanceMark[];
      date?: string;
      site_id?: number | null;
      overwrite?: boolean;
    }) => {
      const { token: authToken } = requireSession();
      const result = await submitBulkAttendanceRequest(authToken, input);
      // The grid reads attendance out of each worker's ledger, and piece work
      // moves their balance, so the whole dashboard has to come back.
      await load('refresh');
      return result;
    },
    [requireSession, load]
  );

  const addPieceRateLog = useCallback(
    async (input: {
      worker_id: number;
      work_description: string;
      quantity: number;
      rate: number;
      site_id?: number | null;
      date?: string;
      note?: string | null;
    }) => {
      const { token: authToken } = requireSession();
      const created = await createPieceRateLog(authToken, input);
      // It wrote a wage, so the worker's balance moved.
      await load('refresh');
      return created;
    },
    [requireSession, load]
  );

  const getPieceRateLogs = useCallback(
    async (
      options: { workerId?: number; siteId?: number; limit?: number } = {},
      signal?: AbortSignal
    ) => {
      const { token: authToken } = requireSession();
      return fetchPieceRateLogs(authToken, options, signal);
    },
    [requireSession]
  );

  const getDeductions = useCallback(
    async (
      options: { workerId?: number; activeOnly?: boolean } = {},
      signal?: AbortSignal
    ) => {
      const { token: authToken } = requireSession();
      return fetchDeductions(authToken, options, signal);
    },
    [requireSession]
  );

  const createDeduction = useCallback(
    async (input: {
      worker_id: number;
      principal_amount: number;
      daily_deduction: number;
      note?: string | null;
    }) => {
      const { token: authToken } = requireSession();
      const created = await createDeductionRequest(authToken, input);
      // Payroll stops holding the whole principal against the current period
      // the moment a plan exists, so every payable figure on screen moves.
      await load('refresh');
      return created;
    },
    [requireSession, load]
  );

  const updateDeduction = useCallback(
    async (
      deductionId: number,
      changes: { daily_deduction?: number; note?: string | null }
    ) => {
      const { token: authToken } = requireSession();
      const updated = await updateDeductionRequest(authToken, deductionId, changes);
      // A changed rate changes what tomorrow's attendance recovers, which the
      // payroll preview on the dashboard is already showing.
      await load('refresh');
      return updated;
    },
    [requireSession, load]
  );

  const closeDeduction = useCallback(
    async (deductionId: number) => {
      const { token: authToken } = requireSession();
      await closeDeductionRequest(authToken, deductionId);
      // Closing a plan stops payroll adding the unrecovered principal back,
      // so every payable figure on screen moves.
      await load('refresh');
    },
    [requireSession, load]
  );

  const getInstallments = useCallback(
    async (deductionId: number, signal?: AbortSignal) => {
      const { token: authToken } = requireSession();
      return fetchInstallments(authToken, deductionId, signal);
    },
    [requireSession]
  );

  const recomputeDeduction = useCallback(
    async (deductionId: number) => {
      const { token: authToken } = requireSession();
      const repaired = await recomputeDeductionRequest(authToken, deductionId);
      await load('refresh');
      return repaired;
    },
    [requireSession, load]
  );

  // --- petty cash -----------------------------------------------------------
  //
  // Fetched per site screen rather than held in the store, like the photo
  // feed: the Home screen never shows it, and a contractor with six sites
  // should not pay for five of them on every refresh.

  const getPettyCash = useCallback(
    async (siteId: number, signal?: AbortSignal) => {
      const { token: authToken } = requireSession();
      return fetchPettyCash(authToken, siteId, {}, signal);
    },
    [requireSession]
  );

  const getPettyCashTotals = useCallback(
    async (siteId: number, signal?: AbortSignal) => {
      const { token: authToken } = requireSession();
      return fetchPettyCashTotals(authToken, siteId, signal);
    },
    [requireSession]
  );

  const addPettyCash = useCallback(
    async (
      siteId: number,
      input: { amount: number; description: string; date?: string }
    ) => {
      const { token: authToken } = requireSession();
      return createPettyCash(authToken, siteId, input);
    },
    [requireSession]
  );

  const removePettyCash = useCallback(
    async (siteId: number, entryId: number) => {
      const { token: authToken } = requireSession();
      await deletePettyCash(authToken, siteId, entryId);
    },
    [requireSession]
  );

  // --- tools ----------------------------------------------------------------

  const getTools = useCallback(
    async (siteId: number, signal?: AbortSignal) => {
      const { token: authToken } = requireSession();
      return fetchTools(authToken, siteId, signal);
    },
    [requireSession]
  );

  const addTool = useCallback(
    async (
      siteId: number,
      input: { name: string; inventory_count?: number; notes?: string | null }
    ) => {
      const { token: authToken } = requireSession();
      return createTool(authToken, siteId, input);
    },
    [requireSession]
  );

  const removeTool = useCallback(
    async (siteId: number, toolId: number) => {
      const { token: authToken } = requireSession();
      await deleteTool(authToken, siteId, toolId);
    },
    [requireSession]
  );

  /** Refreshes the dashboard badge, which is the whole point of tracking this. */
  const refreshOutstandingTools = useCallback(async () => {
    const { token: authToken } = requireSession();
    setOutstandingTools(await fetchOutstandingTools(authToken));
  }, [requireSession]);

  const assignTool = useCallback(
    async (siteId: number, toolId: number, workerId: number) => {
      const { token: authToken } = requireSession();
      const assignment = await assignToolRequest(authToken, siteId, toolId, {
        worker_id: workerId,
      });
      await refreshOutstandingTools();
      return assignment;
    },
    [requireSession, refreshOutstandingTools]
  );

  const returnTool = useCallback(
    async (assignmentId: number, status: 'returned' | 'lost' = 'returned') => {
      const { token: authToken } = requireSession();
      const assignment = await returnToolRequest(authToken, assignmentId, status);
      await refreshOutstandingTools();
      return assignment;
    },
    [requireSession, refreshOutstandingTools]
  );

  // --- material GRN ---------------------------------------------------------

  const getSiteInventory = useCallback(
    async (siteId: number, signal?: AbortSignal) => {
      const { token: authToken } = requireSession();
      return fetchSiteInventory(authToken, siteId, signal);
    },
    [requireSession]
  );

  const getMaterialReceipts = useCallback(
    async (siteId: number, signal?: AbortSignal) => {
      const { token: authToken } = requireSession();
      return fetchMaterialReceipts(authToken, siteId, {}, signal);
    },
    [requireSession]
  );

  const receiveMaterial = useCallback(
    async (
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
    ) => {
      const { token: authToken } = requireSession();
      // The response carries the stock AFTER the delivery, so the caller can
      // confirm "40 bags now" without refetching the inventory list.
      return receiveMaterialRequest(authToken, siteId, input, challan);
    },
    [requireSession]
  );

  const getSupervisors = useCallback(
    async (signal?: AbortSignal) => {
      const { token: authToken } = requireSession();
      return fetchSupervisors(authToken, signal);
    },
    [requireSession]
  );

  // --- machinery and diesel -------------------------------------------------

  const getMachineryLogs = useCallback(
    async (siteId: number, signal?: AbortSignal) => {
      const { token: authToken } = requireSession();
      return fetchMachineryLogs(authToken, siteId, {}, signal);
    },
    [requireSession]
  );

  const getMachineryTotals = useCallback(
    async (siteId: number, signal?: AbortSignal) => {
      const { token: authToken } = requireSession();
      return fetchMachineryTotals(authToken, siteId, {}, signal);
    },
    [requireSession]
  );

  const addMachineryLog = useCallback(
    async (
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
    ) => {
      const { token: authToken } = requireSession();
      return createMachineryLog(authToken, siteId, input, receipt);
    },
    [requireSession]
  );

  const removeMachineryLog = useCallback(
    async (siteId: number, logId: number) => {
      const { token: authToken } = requireSession();
      await deleteMachineryLog(authToken, siteId, logId);
    },
    [requireSession]
  );

  // --- client invoices ------------------------------------------------------

  const getInvoices = useCallback(
    async (
      options: { siteId?: number; status?: InvoiceStatus } = {},
      signal?: AbortSignal
    ) => {
      const { token: authToken } = requireSession();
      return fetchInvoices(authToken, options, signal);
    },
    [requireSession]
  );

  const getInvoicePreview = useCallback(
    async (
      siteId: number,
      options: { startDate?: string; endDate?: string } = {},
      signal?: AbortSignal
    ) => {
      const { token: authToken } = requireSession();
      return fetchInvoicePreview(authToken, siteId, options, signal);
    },
    [requireSession]
  );

  const addInvoice = useCallback(
    async (input: {
      site_id: number;
      client_name: string;
      total_amount: number;
      status?: InvoiceStatus;
      note?: string | null;
    }) => {
      const { token: authToken } = requireSession();
      return createInvoiceRequest(authToken, input);
    },
    [requireSession]
  );

  const editInvoice = useCallback(
    async (
      invoiceId: number,
      changes: {
        client_name?: string;
        total_amount?: number;
        status?: InvoiceStatus;
        note?: string | null;
      }
    ) => {
      const { token: authToken } = requireSession();
      return updateInvoiceRequest(authToken, invoiceId, changes);
    },
    [requireSession]
  );

  const dismissFailures = useCallback(() => setFailures([]), []);

  // Signing out must not leave one user's ledger readable by the next.
  const previousUserId = useRef<number | null>(null);
  useEffect(() => {
    if (user) {
      previousUserId.current = user.id;
      return;
    }
    const stale = previousUserId.current;
    previousUserId.current = null;
    if (stale != null) {
      void clearCache(stale);
      void clearQueue(stale);
    }
  }, [user]);

  const value = useMemo<StoreValue>(
    () => ({
      workers,
      myLedger,
      sites,
      summary,
      categories,
      cashEntries,
      loading,
      refreshing,
      error,
      cachedAt,
      isStale,
      isOnline,
      pending,
      syncing,
      failures,
      dismissFailures,
      getLedger,
      getAttendanceOn,
      refresh,
      giveAdvance,
      markAttendance,
      addWorker,
      scanAttendance,
      removeWorker,
      deleteTransaction,
      getAdvanceRequests,
      getMyAdvanceRequests,
      getMyProfile,
      getMySitePhotos,
      addMySitePhoto,
      requestAdvance,
      decideAdvanceRequest,
      disputeAttendance,
      addSite,
      assignWorkerToSite,
      editSite,
      removeSite,
      editAttendance,
      getSitePhotos,
      addSitePhoto,
      removeSitePhoto,
      markRainOut,
      previewPayroll,
      settlePayroll,
      addCashEntry,
      removeCashEntry,
      addCategory,
      renameCategory,
      removeCategory,
      outstandingTools,
      submitBulkAttendance,
      addPieceRateLog,
      getPieceRateLogs,
      getDeductions,
      createDeduction,
      updateDeduction,
      closeDeduction,
      getInstallments,
      recomputeDeduction,
      getPettyCash,
      getPettyCashTotals,
      addPettyCash,
      removePettyCash,
      getTools,
      addTool,
      removeTool,
      assignTool,
      returnTool,
      getSiteInventory,
      getMaterialReceipts,
      receiveMaterial,
      getSupervisors,
      getMachineryLogs,
      getMachineryTotals,
      addMachineryLog,
      removeMachineryLog,
      getInvoices,
      getInvoicePreview,
      addInvoice,
      editInvoice,
    }),
    [
      workers,
      myLedger,
      sites,
      summary,
      categories,
      cashEntries,
      loading,
      refreshing,
      error,
      cachedAt,
      isStale,
      isOnline,
      pending,
      syncing,
      failures,
      dismissFailures,
      getLedger,
      getAttendanceOn,
      refresh,
      giveAdvance,
      markAttendance,
      addWorker,
      scanAttendance,
      removeWorker,
      deleteTransaction,
      getAdvanceRequests,
      getMyAdvanceRequests,
      getMyProfile,
      getMySitePhotos,
      addMySitePhoto,
      requestAdvance,
      decideAdvanceRequest,
      disputeAttendance,
      addSite,
      assignWorkerToSite,
      editSite,
      removeSite,
      editAttendance,
      getSitePhotos,
      addSitePhoto,
      removeSitePhoto,
      markRainOut,
      previewPayroll,
      settlePayroll,
      addCashEntry,
      removeCashEntry,
      addCategory,
      renameCategory,
      removeCategory,
      outstandingTools,
      submitBulkAttendance,
      addPieceRateLog,
      getPieceRateLogs,
      getDeductions,
      createDeduction,
      updateDeduction,
      closeDeduction,
      getInstallments,
      recomputeDeduction,
      getPettyCash,
      getPettyCashTotals,
      addPettyCash,
      removePettyCash,
      getTools,
      addTool,
      removeTool,
      assignTool,
      returnTool,
      getSiteInventory,
      getMaterialReceipts,
      receiveMaterial,
      getSupervisors,
      getMachineryLogs,
      getMachineryTotals,
      addMachineryLog,
      removeMachineryLog,
      getInvoices,
      getInvoicePreview,
      addInvoice,
      editInvoice,
    ]
  );

  return <StoreContext.Provider value={value}>{children}</StoreContext.Provider>;
}

export function useStore(): StoreValue {
  const value = useContext(StoreContext);
  if (!value) throw new Error('useStore must be used inside <StoreProvider>');
  return value;
}
