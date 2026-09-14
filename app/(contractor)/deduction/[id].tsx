import { useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ErrorState } from '@/components/load-state';
import { ScreenHeader } from '@/components/screen-header';
import { ThemedText } from '@/components/themed-text';
import { Badge, Button, Card, EmptyState, Field } from '@/components/ui-kit';
import { MaxContentWidth, Spacing } from '@/constants/theme';
import { useStore } from '@/data/store';
import type { AutoDeduction, DeductionInstallment } from '@/data/types';
import { useTheme } from '@/hooks/use-theme';
import { confirm, notify } from '@/lib/dialog';
import { CURRENCY, formatMoney, formatRelativeDate } from '@/lib/money';

/**
 * One installment plan, and every deduction actually taken off it.
 *
 * The answer to "which days did you take ₹200 off me?", which the rollup on
 * the plan row can never give — and the reason installments are their own
 * dated rows rather than a running total.
 *
 * `Re-check the total` re-derives `balance_remaining` from the installments
 * below it. It is a repair hatch, not part of the normal flow: the rollup is
 * maintained on every write, but derived data should always have a way back
 * to the rows it came from.
 */
export default function DeductionDetailScreen() {
  const theme = useTheme();
  const router = useRouter();
  const params = useLocalSearchParams<{ id?: string }>();
  const deductionId = Number(params.id);

  const { getDeductions, getInstallments, updateDeduction, recomputeDeduction, isOnline } =
    useStore();

  const [plan, setPlan] = useState<AutoDeduction | null>(null);
  const [installments, setInstallments] = useState<DeductionInstallment[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [editingRate, setEditingRate] = useState(false);
  const [rate, setRate] = useState('');

  const load = useCallback(
    async (controller?: AbortController) => {
      try {
        // No GET for a single plan, so the list is filtered client-side.
        // `activeOnly: false` matters — a closed plan still has a history
        // worth reading, and is exactly what someone arrives here to check.
        const [plans, rows] = await Promise.all([
          getDeductions({ activeOnly: false }, controller?.signal),
          getInstallments(deductionId, controller?.signal),
        ]);
        if (controller?.signal.aborted) return;
        setPlan(plans.find((candidate) => candidate.id === deductionId) ?? null);
        setInstallments(rows);
        setError(null);
      } catch (caught) {
        if (!controller?.signal.aborted) setError((caught as Error).message);
      } finally {
        if (!controller?.signal.aborted) setLoading(false);
      }
    },
    [getDeductions, getInstallments, deductionId]
  );

  useEffect(() => {
    if (!Number.isFinite(deductionId)) return;
    const controller = new AbortController();
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load(controller);
    return () => controller.abort();
  }, [load, deductionId]);

  async function saveRate() {
    if (!plan) return;
    setError(null);

    const parsed = Number.parseFloat(rate);
    if (!Number.isFinite(parsed) || parsed <= 0) {
      setError('How much should come off each day?');
      return;
    }
    if (parsed > plan.balance_remaining) {
      // The API refuses this too; catching it here keeps the reason specific.
      setError(
        `The daily amount cannot be larger than the ${CURRENCY}${formatMoney(
          plan.balance_remaining
        )} still to recover`
      );
      return;
    }

    setBusy(true);
    try {
      const updated = await updateDeduction(plan.id, { daily_deduction: parsed });
      setPlan(updated);
      setEditingRate(false);
    } catch (caught) {
      setError((caught as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function confirmRecompute() {
    const ok = await confirm({
      title: 'Re-check the total?',
      message:
        'Adds up every installment below and rewrites the amount still owing from them. Nothing is collected and no wage moves.',
      confirmLabel: 'Re-check',
    });
    if (!ok) return;

    setBusy(true);
    setError(null);
    try {
      setPlan(await recomputeDeduction(deductionId));
    } catch (caught) {
      const message = (caught as Error).message;
      setError(message);
      notify('Could not re-check the total', message);
    } finally {
      setBusy(false);
    }
  }

  if (!Number.isFinite(deductionId)) {
    return (
      <SafeAreaView style={[styles.screen, { backgroundColor: theme.background }]}>
        <ErrorState message="That plan link is not valid." onRetry={() => router.back()} />
      </SafeAreaView>
    );
  }

  const name = plan?.worker_name ?? 'This worker';
  const takenTotal = installments.reduce((sum, row) => sum + row.amount, 0);

  return (
    <SafeAreaView style={[styles.screen, { backgroundColor: theme.background }]} edges={['top']}>
      <ScreenHeader
        title={plan?.worker_name ?? 'Installments'}
        subtitle={
          plan
            ? `${CURRENCY}${formatMoney(plan.balance_remaining)} of ${CURRENCY}${formatMoney(
                plan.principal_amount
              )} left`
            : undefined
        }
        onBack={() => router.back()}
      />

      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          {error ? (
            <ThemedText type="small" style={{ color: theme.negative }}>
              {error}
            </ThemedText>
          ) : null}

          {loading ? (
            <ActivityIndicator color={theme.tint} style={styles.loading} />
          ) : !plan ? (
            <EmptyState
              title="Plan not found"
              message="It may have been removed along with the worker."
            />
          ) : (
            <>
              <Card style={styles.summaryCard}>
                <View style={styles.summaryHead}>
                  <ThemedText type="smallBold">
                    {CURRENCY}
                    {formatMoney(plan.daily_deduction)} a day worked
                  </ThemedText>
                  {plan.is_active ? (
                    <Badge label="Collecting" color={theme.tint} />
                  ) : (
                    <Badge label="Closed" color={theme.textSecondary} />
                  )}
                </View>

                <View style={styles.figures}>
                  <View style={styles.figure}>
                    <ThemedText type="small" themeColor="textSecondary">
                      Recovered
                    </ThemedText>
                    <ThemedText type="smallBold" style={{ color: theme.positive }}>
                      {CURRENCY}
                      {formatMoney(plan.recovered_amount)}
                    </ThemedText>
                  </View>
                  <View style={styles.figure}>
                    <ThemedText type="small" themeColor="textSecondary">
                      Still owing
                    </ThemedText>
                    <ThemedText type="smallBold">
                      {CURRENCY}
                      {formatMoney(plan.balance_remaining)}
                    </ThemedText>
                  </View>
                  <View style={styles.figure}>
                    <ThemedText type="small" themeColor="textSecondary">
                      Days taken
                    </ThemedText>
                    <ThemedText type="smallBold">{installments.length}</ThemedText>
                  </View>
                </View>

                {plan.note ? (
                  <ThemedText type="small" themeColor="textSecondary">
                    {plan.note}
                  </ThemedText>
                ) : null}

                {/* Only while collecting: changing the rate on a closed plan
                    would suggest it is going to be taken, and it is not. */}
                {plan.is_active ? (
                  editingRate ? (
                    <>
                      <Field
                        label="Taken off each day worked"
                        value={rate}
                        onChangeText={setRate}
                        keyboardType="decimal-pad"
                        placeholder={String(plan.daily_deduction)}
                        returnKeyType="done"
                      />
                      <View style={styles.rateActions}>
                        <View style={styles.rateAction}>
                          <Button
                            title="Save"
                            loading={busy}
                            disabled={!isOnline}
                            onPress={() => void saveRate()}
                          />
                        </View>
                        <View style={styles.rateAction}>
                          <Button
                            title="Cancel"
                            variant="ghost"
                            disabled={busy}
                            onPress={() => setEditingRate(false)}
                          />
                        </View>
                      </View>
                    </>
                  ) : (
                    <Button
                      title="Change the daily amount"
                      variant="secondary"
                      disabled={!isOnline || busy}
                      onPress={() => {
                        setRate(String(plan.daily_deduction));
                        setEditingRate(true);
                      }}
                    />
                  )
                ) : null}
              </Card>

              <View style={styles.historyHead}>
                <ThemedText type="smallBold" themeColor="textSecondary" style={styles.label}>
                  EVERY DEDUCTION TAKEN
                </ThemedText>
                {/* Should always equal `recovered`. When it does not, the
                    rollup has drifted and the button below is the fix. */}
                <ThemedText type="small" themeColor="textSecondary">
                  {CURRENCY}
                  {formatMoney(takenTotal)}
                </ThemedText>
              </View>

              {installments.length === 0 ? (
                <EmptyState
                  title="Nothing taken yet"
                  message={`The first installment comes off the next day ${name.split(' ')[0]} is marked present.`}
                />
              ) : (
                <Card style={styles.historyCard}>
                  {installments.map((row, index) => (
                    <View key={row.id}>
                      {index > 0 ? (
                        <View style={[styles.separator, { backgroundColor: theme.border }]} />
                      ) : null}
                      <View style={styles.installmentRow}>
                        <ThemedText type="small">{formatRelativeDate(row.date)}</ThemedText>
                        <ThemedText type="smallBold" style={{ color: theme.negative }}>
                          −{CURRENCY}
                          {formatMoney(row.amount)}
                        </ThemedText>
                      </View>
                    </View>
                  ))}
                </Card>
              )}

              <Button
                title="Re-check the total"
                variant="ghost"
                disabled={!isOnline || busy}
                onPress={() => void confirmRecompute()}
              />
            </>
          )}
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
  },
  flex: {
    flex: 1,
  },
  content: {
    gap: Spacing.three,
    paddingHorizontal: Spacing.three,
    paddingBottom: Spacing.six,
    maxWidth: MaxContentWidth,
    width: '100%',
    alignSelf: 'center',
  },
  loading: {
    paddingVertical: Spacing.five,
  },
  summaryCard: {
    gap: Spacing.three,
  },
  summaryHead: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.two,
  },
  figures: {
    flexDirection: 'row',
    gap: Spacing.two,
  },
  figure: {
    flex: 1,
    gap: 1,
  },
  rateActions: {
    flexDirection: 'row',
    gap: Spacing.two,
  },
  rateAction: {
    flex: 1,
  },
  historyHead: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.two,
    marginTop: Spacing.two,
  },
  label: {
    letterSpacing: 0.5,
  },
  historyCard: {
    paddingVertical: Spacing.two,
  },
  installmentRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: Spacing.two,
  },
  separator: {
    height: StyleSheet.hairlineWidth,
  },
});
