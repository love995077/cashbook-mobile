/**
 * The analytics series for one period, from cache first and the API second.
 *
 * It is kept out of `StoreProvider` on purpose: only one screen wants it, it
 * is refetched whenever the filter changes, and holding three periods in the
 * global store would mean four requests on every dashboard refresh instead of
 * one on demand.
 *
 * The cache is per user and per period, so switching the filter offline still
 * shows the last chart you saw for that filter rather than an empty state.
 *
 * Everything the screen reads is derived from one `result` object that carries
 * the period it belongs to. Switching filters therefore reports "loading" for
 * the new period immediately, without an effect having to clear state first -
 * that would render once with the old period's bars under the new label.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import { useCallback, useEffect, useRef, useState } from 'react';

import { ApiError } from '@/api/client';
import { fetchAnalytics } from '@/api/endpoints';
import { useAuth } from '@/auth/auth-context';
import type { AnalyticsPeriod, AnalyticsSeries } from '@/data/types';

const CACHE_VERSION = 1;

const keyFor = (userId: number, period: AnalyticsPeriod) =>
  `cashbook.analytics.v${CACHE_VERSION}.user.${userId}.${period}`;

type Cached = { cachedAt: number; series: AnalyticsSeries };

type Result = {
  /** Which filter this result belongs to; stale ones are ignored. */
  period: AnalyticsPeriod;
  series: AnalyticsSeries | null;
  error: string | null;
  isStale: boolean;
  cachedAt: number | null;
};

export type AnalyticsState = {
  series: AnalyticsSeries | null;
  loading: boolean;
  refreshing: boolean;
  error: string | null;
  /** True when what is on screen came from cache after a failed fetch. */
  isStale: boolean;
  cachedAt: number | null;
  refresh: () => Promise<void>;
};

export function useAnalytics(period: AnalyticsPeriod): AnalyticsState {
  const { token, user, handleUnauthorized } = useAuth();

  const [result, setResult] = useState<Result | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  const load = useCallback(
    async (mode: 'initial' | 'refresh') => {
      if (!token || !user) return;

      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;

      if (mode === 'refresh') setRefreshing(true);

      try {
        const fresh = await fetchAnalytics(token, period, controller.signal);
        if (controller.signal.aborted) return;

        const cachedAt = Date.now();
        setResult({ period, series: fresh, error: null, isStale: false, cachedAt });
        await AsyncStorage.setItem(
          keyFor(user.id, period),
          JSON.stringify({ cachedAt, series: fresh } satisfies Cached)
        );
      } catch (caught) {
        if (controller.signal.aborted) return;

        const isApi = caught instanceof ApiError;
        if (isApi && caught.isUnauthorized) handleUnauthorized();

        // Keep whatever is already on screen for this period; a failed refresh
        // should not blank a chart the contractor is reading.
        setResult((current) => ({
          period,
          series: current?.period === period ? current.series : null,
          error: isApi ? caught.message : 'Could not load your analytics.',
          isStale: isApi && caught.isNetworkError,
          cachedAt: current?.period === period ? current.cachedAt : null,
        }));
      } finally {
        if (!controller.signal.aborted) setRefreshing(false);
      }
    },
    [token, user, period, handleUnauthorized]
  );

  useEffect(() => {
    if (!token || !user) return;

    let active = true;

    (async () => {
      try {
        const raw = await AsyncStorage.getItem(keyFor(user.id, period));
        if (!active) return;
        if (raw) {
          const parsed = JSON.parse(raw) as Cached;
          // Paint the cached chart so the network round trip is not blocking.
          if (parsed?.series) {
            setResult({
              period,
              series: parsed.series,
              error: null,
              isStale: false,
              cachedAt: parsed.cachedAt,
            });
          }
        }
      } catch {
        // A corrupt cache is the same as no cache.
      }

      if (!active) return;
      await load('initial');
    })();

    return () => {
      active = false;
    };
    // `load` is recreated whenever these change, so depending on it as well
    // would refetch on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, user?.id, period]);

  useEffect(() => () => abortRef.current?.abort(), []);

  const refresh = useCallback(() => load('refresh'), [load]);

  // A result for a different period is another filter's answer, so it counts
  // as nothing loaded yet.
  const current = result?.period === period ? result : null;

  return {
    series: current?.series ?? null,
    loading: current === null && !!token && !!user,
    refreshing,
    error: current?.error ?? null,
    isStale: current?.isStale ?? false,
    cachedAt: current?.cachedAt ?? null,
    refresh,
  };
}
