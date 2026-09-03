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
  createAttendance,
  createTransaction,
  createWorker,
  fetchMyLedger,
  fetchWorkerLedger,
  fetchWorkers,
  type WorkerLedger,
} from '@/api/endpoints';
import { useAuth } from '@/auth/auth-context';
import type { Attendance, AttendanceStatus, BalanceSummary, User } from '@/data/types';
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

type StoreValue = {
  workers: WorkerWithBalance[];
  myLedger: WorkerLedger | null;

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
    note?: string | null;
  }) => Promise<void>;
  markAttendance: (input: {
    worker_id: number;
    date: string;
    status: AttendanceStatus;
    note?: string | null;
  }) => Promise<void>;
  addWorker: (input: {
    name: string;
    phone: string;
    password: string;
    daily_wage?: number | null;
  }) => Promise<void>;
};

const StoreContext = createContext<StoreValue | null>(null);

export function StoreProvider({ children }: { children: ReactNode }) {
  const { token, user, handleUnauthorized } = useAuth();
  const { isOnline } = useNetworkStatus();

  const [workers, setWorkers] = useState<WorkerWithBalance[]>([]);
  const [ledgers, setLedgers] = useState<Map<number, WorkerLedger>>(new Map());
  const [myLedger, setMyLedger] = useState<WorkerLedger | null>(null);
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
        if (user.role === 'contractor') {
          const crew = await fetchWorkers(token, controller.signal);
          const crewLedgers = await Promise.all(
            crew.map((worker) => fetchWorkerLedger(token, worker.id, controller.signal))
          );
          if (controller.signal.aborted) return;

          const withBalances = crew.map((worker, index) => ({
            ...worker,
            balance: crewLedgers[index].balance,
          }));
          setLedgers(new Map(crewLedgers.map((ledger) => [ledger.worker.id, ledger])));
          setWorkers(withBalances);
          await writeCache(user.id, {
            workers: withBalances,
            ledgers: crewLedgers,
            myLedger: null,
          });
        } else {
          const ledger = await fetchMyLedger(token, controller.signal);
          if (controller.signal.aborted) return;
          setMyLedger(ledger);
          await writeCache(user.id, { workers: [], ledgers: [], myLedger: ledger });
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
          note: queued.payload.note ?? null,
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

  const giveAdvance = useCallback(
    async (input: { worker_id: number; amount: number; date: string; note?: string | null }) => {
      const payload = { ...input, type: 'advance' as const };
      await writeOrQueue({ kind: 'transaction', payload }, (authToken) =>
        createTransaction(authToken, payload)
      );
    },
    [writeOrQueue]
  );

  const markAttendance = useCallback(
    async (input: {
      worker_id: number;
      date: string;
      status: AttendanceStatus;
      note?: string | null;
    }) => {
      await writeOrQueue({ kind: 'attendance', payload: input }, (authToken) =>
        createAttendance(authToken, input)
      );
    },
    [writeOrQueue]
  );

  // Deliberately not queueable: a worker needs a server-assigned id before any
  // entry can reference them, so this one requires a connection.
  const addWorker = useCallback(
    async (input: { name: string; phone: string; password: string; daily_wage?: number | null }) => {
      const { token: authToken } = requireSession();
      await createWorker(authToken, input);
      await load('refresh');
    },
    [requireSession, load]
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
    }),
    [
      workers,
      myLedger,
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
    ]
  );

  return <StoreContext.Provider value={value}>{children}</StoreContext.Provider>;
}

export function useStore(): StoreValue {
  const value = useContext(StoreContext);
  if (!value) throw new Error('useStore must be used inside <StoreProvider>');
  return value;
}
