import { useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { PaymentModePicker } from '@/components/payment-mode-picker';
import { ThemedText } from '@/components/themed-text';
import { TradeBadge } from '@/components/trade-badge';
import { Button, Card, Field } from '@/components/ui-kit';
import { ErrorState } from '@/components/load-state';
import { MaxContentWidth, Radius, Spacing } from '@/constants/theme';
import { useStore } from '@/data/store';
import type { PaymentMode, PayrollSummary } from '@/data/types';
import { useTheme } from '@/hooks/use-theme';
import {
  CURRENCY,
  formatDate,
  formatDays,
  formatMoney,
  formatPaymentMode,
} from '@/lib/money';

/**
 * Settle a worker's payroll: show what they are owed, take a payment mode,
 * and clear the balance to zero.
 *
 * The period is the worker's whole unsettled history, not a month picker. That
 * is the request a contractor actually makes — "clear Ramesh" — and anything
 * narrower is served by the API's date parameters without a UI for choosing
 * them badly. The figure comes from GET /payroll/preview so the number on
 * screen is the number the server will write; nothing is computed here.
 *
 * Two states worth reading the code for:
 *   - `can_settle` false: the button is disabled with the reason spelled out,
 *     rather than letting the contractor tap into a 409.
 *   - offline: settlement is the one write this app refuses to queue. See the
 *     note on `settlePayroll` in src/data/store.tsx.
 */
export default function SettlePayrollScreen() {
  const theme = useTheme();
  const router = useRouter();
  const params = useLocalSearchParams<{ id?: string }>();
  const workerId = Number(params.id);

  const { workers, previewPayroll, settlePayroll, isOnline } = useStore();
  const worker = workers.find((candidate) => candidate.id === workerId);

  const [summary, setSummary] = useState<PayrollSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [paymentMode, setPaymentMode] = useState<PaymentMode>('cash');
  const [note, setNote] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState<{ amount: number; mode: PaymentMode } | null>(null);

  const abortRef = useRef<AbortController | null>(null);

  /**
   * Fetch the figures. Takes its own controller and touches no state before
   * the first await, so the mount effect below can call it without setting
   * state synchronously in an effect body.
   */
  const load = useCallback(
    async (controller: AbortController) => {
      try {
        const next = await previewPayroll(workerId, {}, controller.signal);
        if (!controller.signal.aborted) setSummary(next);
      } catch (caught) {
        if (!controller.signal.aborted) setError((caught as Error).message);
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    },
    [workerId, previewPayroll]
  );

  /** Re-read from an event handler, with the spinner and a cleared error. */
  const reload = useCallback(() => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setLoading(true);
    setError(null);
    return load(controller);
  }, [load]);

  useEffect(() => {
    // `loading` already starts true, so the first read needs no state change
    // on the way in - which is what keeps this effect free of a synchronous
    // setState.
    if (!Number.isFinite(workerId)) return;
    const controller = new AbortController();
    abortRef.current = controller;
    // The rule cannot see that every setState inside `load` happens after an
    // await and behind an `aborted` guard, so none of them run during this
    // effect and none can cascade a render.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load(controller);
    return () => controller.abort();
  }, [load, workerId]);

  async function confirm() {
    if (!summary?.can_settle) return;
    setSubmitting(true);
    setError(null);
    try {
      const settlement = await settlePayroll({
        worker_id: workerId,
        payment_mode: paymentMode,
        note: note.trim() || null,
      });
      setDone({ amount: settlement.transaction.amount, mode: paymentMode });
    } catch (caught) {
      // Stay on the screen: the balance may have moved under us (a wage logged
      // on another device), and re-reading it is more useful than a dead end.
      setError((caught as Error).message);
      void reload();
    } finally {
      setSubmitting(false);
    }
  }

  if (!Number.isFinite(workerId)) {
    return (
      <SafeAreaView style={[styles.screen, { backgroundColor: theme.background }]}>
        <ErrorState message="That worker link is not valid." onRetry={() => router.back()} />
      </SafeAreaView>
    );
  }

  const name = worker?.name ?? summary?.worker_name ?? 'Worker';

  return (
    <SafeAreaView style={[styles.screen, { backgroundColor: theme.background }]}>
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <View style={styles.titleBar}>
          <ThemedText type="smallBold">Settle payroll</ThemedText>
          <Pressable
            accessibilityRole="button"
            onPress={() => router.back()}
            hitSlop={12}
            disabled={submitting}
            style={({ pressed }) => pressed && { opacity: 0.6 }}>
            <ThemedText type="smallBold" style={{ color: theme.tint }}>
              {done ? 'Done' : 'Cancel'}
            </ThemedText>
          </Pressable>
        </View>

        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          <View style={styles.workerBlock}>
            <ThemedText type="subtitle" numberOfLines={1}>
              {name}
            </ThemedText>
            <TradeBadge trade={worker?.trade} />
          </View>

          {loading && !summary ? (
            <View style={styles.loading}>
              <ActivityIndicator color={theme.tint} />
            </View>
          ) : null}

          {done ? (
            <Card style={[styles.doneCard, { borderColor: theme.positive }]}>
              <ThemedText type="smallBold" style={{ color: theme.positive }}>
                Paid {CURRENCY}
                {formatMoney(done.amount)} by {formatPaymentMode(done.mode)}
              </ThemedText>
              <ThemedText type="small" themeColor="textSecondary">
                {name}&apos;s balance is now clear. The payment is in their ledger and on their
                own screen.
              </ThemedText>
              <Button title="Back to worker" onPress={() => router.back()} />
            </Card>
          ) : null}

          {summary && !done ? (
            <>
              <Card style={styles.breakdown}>
                <ThemedText type="smallBold" themeColor="textSecondary">
                  {summary.start_date
                    ? `${formatDate(summary.start_date)} — ${formatDate(summary.end_date)}`
                    : `EVERYTHING UP TO ${formatDate(summary.end_date).toUpperCase()}`}
                </ThemedText>

                <Line
                  label={`Wages earned · ${formatDays(summary.days_worked)}`}
                  value={summary.total_wages}
                />
                <Line label="Less advances taken" value={-summary.total_advances} />

                {/* An advance on an installment plan was subtracted in full on
                    the line above — that is what the ledger says, and the
                    worker's own screen agrees. It is not DUE in full this
                    period, so it goes back on here and the installments
                    actually recovered come off instead. Without both lines the
                    breakdown would not add up to the total below. */}
                {summary.emi_advances > 0 ? (
                  <Line
                    label="Advance on installments · not due yet"
                    value={summary.emi_advances}
                  />
                ) : null}
                {summary.installments_recovered > 0 ? (
                  <Line
                    label="Less installments recovered"
                    value={-summary.installments_recovered}
                  />
                ) : null}

                <Line label="Less already paid" value={-summary.total_payments} />

                <View style={[styles.rule, { backgroundColor: theme.border }]} />

                <View style={styles.totalRow}>
                  <ThemedText type="smallBold">To pay now</ThemedText>
                  <ThemedText
                    style={[
                      styles.total,
                      { color: summary.can_settle ? theme.positive : theme.textSecondary },
                    ]}>
                    {CURRENCY}
                    {formatMoney(Math.max(summary.net_payable, 0))}
                  </ThemedText>
                </View>

                <ThemedText type="small" themeColor="textSecondary">
                  {summary.days_present} full · {summary.days_half} half · {summary.days_absent}{' '}
                  absent
                </ThemedText>
              </Card>

              {/* What the worker still owes, carried into the next period.
                  Stated plainly: they will ask why the advance is still there,
                  and the contractor should be able to answer. */}
              {summary.emi_outstanding > 0 ? (
                <ThemedText type="small" themeColor="textSecondary">
                  {CURRENCY}
                  {formatMoney(summary.emi_outstanding)} of advances is still being recovered in
                  daily installments, and carries over to the next period.
                </ThemedText>
              ) : null}

              {/* The window and the lifetime figure only diverge when an
                  earlier settlement fell outside these dates. Saying so beats
                  a number that looks wrong for no visible reason. */}
              {summary.window_balance > summary.net_payable ? (
                <ThemedText type="small" style={{ color: theme.warning }}>
                  {CURRENCY}
                  {formatMoney(summary.window_balance)} of wages fall in this period, but{' '}
                  {CURRENCY}
                  {formatMoney(summary.window_balance - summary.net_payable)} of it has already
                  been settled.
                </ThemedText>
              ) : null}

              {summary.can_settle ? (
                <>
                  <PaymentModePicker
                    value={paymentMode}
                    onChange={setPaymentMode}
                    disabled={submitting}
                  />

                  <Field
                    label="Note (optional)"
                    value={note}
                    onChangeText={setNote}
                    placeholder="Reference number, or what it covers"
                    maxLength={255}
                    returnKeyType="done"
                  />
                </>
              ) : (
                <ThemedText type="small" themeColor="textSecondary">
                  {summary.net_payable < 0
                    ? `${name} has taken ${CURRENCY}${formatMoney(
                        Math.abs(summary.net_payable)
                      )} more than they have earned. Log their wages first.`
                    : `${name} has nothing outstanding. There is nothing to settle.`}
                </ThemedText>
              )}

              {!isOnline ? (
                <ThemedText type="small" style={{ color: theme.warning }}>
                  You are offline. A settlement is the one entry this app will not save for
                  later — sending it twice would pay the whole period twice — so this needs a
                  connection.
                </ThemedText>
              ) : null}

              {error ? (
                <ThemedText type="small" style={{ color: theme.negative }}>
                  {error}
                </ThemedText>
              ) : null}

              <Button
                title={
                  summary.can_settle
                    ? `Pay ${CURRENCY}${formatMoney(summary.net_payable)} by ${formatPaymentMode(
                        paymentMode
                      )}`
                    : 'Nothing to settle'
                }
                onPress={() => void confirm()}
                loading={submitting}
                disabled={!summary.can_settle || !isOnline}
              />
            </>
          ) : null}

          {error && !summary ? <ErrorState message={error} onRetry={() => void reload()} /> : null}
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

/** One line of the breakdown. Negatives are shown as deductions, not minuses. */
function Line({ label, value }: { label: string; value: number }) {
  const theme = useTheme();
  const negative = value < 0;

  return (
    <View style={styles.line}>
      <ThemedText type="small" themeColor="textSecondary" numberOfLines={1} style={styles.lineLabel}>
        {label}
      </ThemedText>
      <ThemedText type="small" style={{ color: negative ? theme.warning : theme.text }}>
        {negative ? '−' : ''}
        {CURRENCY}
        {formatMoney(Math.abs(value))}
      </ThemedText>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
  },
  flex: {
    flex: 1,
  },
  titleBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.three,
  },
  content: {
    gap: Spacing.three,
    paddingHorizontal: Spacing.three,
    paddingBottom: Spacing.five,
    maxWidth: MaxContentWidth,
    width: '100%',
    alignSelf: 'center',
  },
  workerBlock: {
    gap: Spacing.two,
  },
  loading: {
    paddingVertical: Spacing.five,
  },
  breakdown: {
    gap: Spacing.two,
  },
  line: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.three,
  },
  lineLabel: {
    flexShrink: 1,
  },
  rule: {
    height: StyleSheet.hairlineWidth,
    marginVertical: Spacing.one,
  },
  totalRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  total: {
    fontSize: 26,
    lineHeight: 32,
    fontWeight: '700',
  },
  doneCard: {
    gap: Spacing.three,
    borderWidth: 1,
    borderRadius: Radius.large,
  },
});
