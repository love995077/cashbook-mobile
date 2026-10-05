import { useRouter } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ErrorState, LoadingState } from '@/components/load-state';
import { ScreenHeader } from '@/components/screen-header';
import { ThemedText } from '@/components/themed-text';
import { Button, Card } from '@/components/ui-kit';
import { MaxContentWidth, Spacing } from '@/constants/theme';
import { useStore } from '@/data/store';
import type { ReconcileReport, WageAudit, WageIssue } from '@/data/types';
import { useTheme } from '@/hooks/use-theme';
import { confirm, notify } from '@/lib/dialog';
import { CURRENCY, formatDate, formatMoney } from '@/lib/money';

const KIND_LABELS: Record<WageIssue['kind'], string> = {
  unpriced: 'Marked while the worker had no day rate',
  missing_wage: 'Day worked, but no wage recorded',
  wrong_amount: 'Wage does not match the day rate',
  wrong_date: 'Wage dated on a different day',
  wrong_site: 'Wage filed under another site',
  stray_wage: 'Wage on a day that earns nothing',
  bad_link: 'Wage linked to the wrong entry',
};

/**
 * Does the ledger match the register?
 *
 * Every balance in the app is built from WAGE entries, and every day marked
 * present or half must have exactly the wage its rate says. This screen asks
 * the server to check every day (GET /contractor/integrity/wages) and says so
 * in one line, or lists what disagrees.
 *
 * FIXING IS SHOWN BEFORE IT IS DONE
 * ---------------------------------
 * Days marked before attendance earned wages have none. "Fix" first runs the
 * reconcile as a dry run and shows, per worker, how much their balance would
 * move; only "Apply" writes. A wage typed by hand for the same day and amount
 * is linked rather than doubled - the server does that, see
 * app/services/integrity.py.
 */
export default function LedgerCheckScreen() {
  const theme = useTheme();
  const router = useRouter();
  const { getWageAudit, reconcileWages, isOnline } = useStore();
  const [audit, setAudit] = useState<WageAudit | null>(null);
  const [preview, setPreview] = useState<ReconcileReport | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [version, setVersion] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    void (async () => {
      try {
        const fresh = await getWageAudit(controller.signal);
        if (!controller.signal.aborted) {
          setAudit(fresh);
          setError(null);
        }
      } catch (caught) {
        if (!controller.signal.aborted) setError((caught as Error).message);
      }
    })();
    return () => controller.abort();
  }, [getWageAudit, version]);

  const reload = useCallback(() => setVersion((current) => current + 1), []);

  async function runPreview() {
    setBusy(true);
    try {
      setPreview(await reconcileWages(false));
    } catch (caught) {
      notify('Could not check', (caught as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function apply() {
    if (!preview) return;
    const ok = await confirm({
      title: 'Apply these changes?',
      message:
        `${preview.wages_created} wages will be added and ${preview.wages_corrected} corrected. ` +
        `The crew's earnings move by ${CURRENCY}${formatMoney(preview.net_change)} in total.`,
      confirmLabel: 'Apply',
      destructive: true,
    });
    if (!ok) return;
    setBusy(true);
    try {
      await reconcileWages(true);
      setPreview(null);
      reload();
      notify('Books updated', 'Every day now has the wage its rate says.');
    } catch (caught) {
      notify('Could not apply', (caught as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const fixable = audit ? audit.issues.filter((issue) => issue.kind !== 'unpriced').length : 0;
  const unpriced = audit?.counts.unpriced ?? 0;

  return (
    <SafeAreaView style={[styles.screen, { backgroundColor: theme.background }]}>
      <ScreenHeader title="Check the books" onBack={() => router.back()} />
      {!audit && error ? (
        <ErrorState message={error} onRetry={reload} />
      ) : !audit ? (
        <LoadingState label="Checking every day against its wage…" />
      ) : (
        <ScrollView contentContainerStyle={styles.content}>
          <Card style={styles.card}>
            <ThemedText
              type="subtitle"
              style={{ color: fixable === 0 ? theme.positive : theme.warning }}>
              {fixable === 0 ? 'The ledger matches attendance' : `${fixable} days need fixing`}
            </ThemedText>
            <ThemedText type="small" themeColor="textSecondary">
              Every day marked present or half earns exactly its day rate, on that day, under
              that site - and a day absent or rained out earns nothing.
            </ThemedText>
            {unpriced > 0 ? (
              <ThemedText type="small" style={{ color: theme.warning }}>
                {unpriced} {unpriced === 1 ? 'day was' : 'days were'} marked for workers with no
                day rate. They earn as soon as a rate is set on the worker.
              </ThemedText>
            ) : null}
          </Card>

          {audit.issues.slice(0, 50).map((issue) => (
            <View key={issue.attendance_id} style={styles.issue}>
              <ThemedText type="smallBold">
                {issue.worker_name} · {formatDate(issue.date)}
              </ThemedText>
              <ThemedText type="small" themeColor="textSecondary">
                {KIND_LABELS[issue.kind]}
                {issue.expected != null
                  ? ` · should be ${CURRENCY}${formatMoney(issue.expected)}`
                  : ''}
                {issue.actual != null ? `, is ${CURRENCY}${formatMoney(issue.actual)}` : ''}
              </ThemedText>
            </View>
          ))}

          {preview ? (
            <Card style={styles.card}>
              <ThemedText type="smallBold">What fixing would do</ThemedText>
              <ThemedText type="small" themeColor="textSecondary">
                {preview.wages_created} wages added, {preview.wages_adopted} typed-in wages
                linked (not doubled), {preview.wages_corrected} corrected,{' '}
                {preview.wages_removed} removed. Earnings move by {CURRENCY}
                {formatMoney(preview.net_change)}.
              </ThemedText>
              {preview.by_worker.map((row) => (
                <ThemedText key={row.worker_id} type="small">
                  {row.worker_name}: {row.net_change >= 0 ? '+' : '-'}
                  {CURRENCY}
                  {formatMoney(Math.abs(row.net_change))}
                </ThemedText>
              ))}
              <Button title="Apply" onPress={() => void apply()} loading={busy} disabled={!isOnline} />
              <Button title="Not now" variant="ghost" onPress={() => setPreview(null)} />
            </Card>
          ) : fixable > 0 || unpriced > 0 ? (
            <Button
              title="Show what fixing would change"
              onPress={() => void runPreview()}
              loading={busy}
              disabled={!isOnline}
            />
          ) : null}
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
  },
  content: {
    gap: Spacing.three,
    padding: Spacing.three,
    maxWidth: MaxContentWidth,
    width: '100%',
    alignSelf: 'center',
  },
  card: {
    gap: Spacing.two,
  },
  issue: {
    gap: 1,
  },
});
