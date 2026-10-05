import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { CashEntryRow } from '@/components/cash-entry-row';
import { PettyCashTab } from '@/components/petty-cash-tab';
import { ThemedText } from '@/components/themed-text';
import { Button, Card, EmptyState } from '@/components/ui-kit';
import { Spacing } from '@/constants/theme';
import { useStore } from '@/data/store';
import type { CashEntry, CashSummary } from '@/data/types';
import { useTheme } from '@/hooks/use-theme';
import { CURRENCY, formatMoney } from '@/lib/money';

/**
 * One site's money, fetched for the screen rather than held in the store.
 *
 * Every figure is the server's site-scoped summary (`GET /contractor/summary
 * ?site_id=`): wages by the site stamped on each row, so a worker moved away
 * or deactivated still counts here for the days they worked here; "still
 * owed" by who is posted here now. Admin only - it is money.
 *
 * `version` re-fetches when the caller knows something changed (a day was
 * marked, an expense was added) without this component having to know how.
 */
function useSiteSummary(siteId: number, version: number) {
  const { getSiteSummary, isOnline } = useStore();
  const [summary, setSummary] = useState<CashSummary | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    void (async () => {
      try {
        const fresh = await getSiteSummary(siteId, controller.signal);
        if (!controller.signal.aborted) {
          setSummary(fresh);
          setError(null);
        }
      } catch (caught) {
        if (!controller.signal.aborted) setError((caught as Error).message);
      }
    })();
    return () => controller.abort();
  }, [getSiteSummary, siteId, version, isOnline]);

  return { summary, error };
}

/** Earned, paid and still owed for this site's labour - the Labour tab's strip. */
export function SiteLabourMoney({ siteId, version }: { siteId: number; version: number }) {
  const theme = useTheme();
  const { summary, error } = useSiteSummary(siteId, version);

  if (error && !summary) {
    return (
      <ThemedText type="small" style={{ color: theme.negative }}>
        {error}
      </ThemedText>
    );
  }

  return (
    <Card style={styles.strip}>
      <Figure label="Wages earned" value={summary?.wages_earned} color={theme.text} />
      <Figure label="Paid out" value={summary?.wages_paid} color={theme.text} />
      <Figure
        label="Still owed"
        value={summary?.outstanding_payable}
        color={(summary?.outstanding_payable ?? 0) > 0 ? theme.warning : theme.text}
      />
    </Card>
  );
}

/**
 * The Expenses tab: what came in and went out for this site, every entry
 * filed under it, and its petty cash.
 */
export function SiteExpenses({ siteId, version }: { siteId: number; version: number }) {
  const theme = useTheme();
  const router = useRouter();
  const { getSiteCashEntries, isOnline } = useStore();
  const { summary } = useSiteSummary(siteId, version);
  const [entries, setEntries] = useState<CashEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    void (async () => {
      try {
        const rows = await getSiteCashEntries(siteId, controller.signal);
        if (!controller.signal.aborted) {
          setEntries(rows);
          setError(null);
        }
      } catch (caught) {
        if (!controller.signal.aborted) setError((caught as Error).message);
      }
    })();
    return () => controller.abort();
  }, [getSiteCashEntries, siteId, version, isOnline]);

  return (
    <View style={styles.stack}>
      <Card style={styles.strip}>
        <Figure label="Received" value={summary?.cash_in} color={theme.positive} />
        <Figure label="Spent" value={summary?.expenses_paid} color={theme.negative} />
        <Figure label="Wages paid" value={summary?.wages_paid} color={theme.text} />
      </Card>

      <Button
        title="+ Add expense for this site"
        onPress={() =>
          router.push({ pathname: '/(contractor)/new-expense', params: { siteId: String(siteId) } })
        }
      />

      <ThemedText type="smallBold" themeColor="textSecondary" style={styles.label}>
        EXPENSES AND RECEIPTS
      </ThemedText>
      {error && !entries ? (
        <ThemedText type="small" style={{ color: theme.negative }}>
          {error}
        </ThemedText>
      ) : null}
      <Card style={styles.list}>
        {entries === null ? (
          <ThemedText type="small" themeColor="textSecondary" style={styles.pad}>
            Loading…
          </ThemedText>
        ) : entries.length === 0 ? (
          <EmptyState
            title="Nothing filed under this site"
            message="Expenses added from here are filed under this site and show in its report."
          />
        ) : (
          entries.map((entry, index) => (
            <View key={entry.id}>
              {index > 0 ? (
                <View style={[styles.separator, { backgroundColor: theme.border }]} />
              ) : null}
              <CashEntryRow entry={entry} />
            </View>
          ))
        )}
      </Card>

      <ThemedText type="smallBold" themeColor="textSecondary" style={styles.label}>
        PETTY CASH
      </ThemedText>
      <PettyCashTab siteId={siteId} />
    </View>
  );
}

function Figure({ label, value, color }: { label: string; value?: number; color: string }) {
  return (
    <View style={styles.figure}>
      <ThemedText type="small" themeColor="textSecondary">
        {label}
      </ThemedText>
      <ThemedText type="smallBold" style={{ color }} numberOfLines={1}>
        {value == null ? '—' : `${CURRENCY}${formatMoney(value)}`}
      </ThemedText>
    </View>
  );
}

const styles = StyleSheet.create({
  stack: {
    gap: Spacing.three,
  },
  strip: {
    flexDirection: 'row',
    gap: Spacing.two,
  },
  figure: {
    flex: 1,
    gap: 1,
  },
  label: {
    letterSpacing: 0.5,
  },
  list: {
    padding: 0,
    paddingVertical: Spacing.one,
    overflow: 'hidden',
  },
  pad: {
    padding: Spacing.three,
  },
  separator: {
    height: StyleSheet.hairlineWidth,
    marginLeft: Spacing.three + 40 + Spacing.three,
  },
});
