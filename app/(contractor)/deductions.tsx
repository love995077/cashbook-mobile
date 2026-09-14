import { useRouter } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
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

import { ScreenHeader } from '@/components/screen-header';
import { ThemedText } from '@/components/themed-text';
import { Avatar, Badge, Button, Card, EmptyState, Field, Segmented } from '@/components/ui-kit';
import { MaxContentWidth, Radius, Spacing } from '@/constants/theme';
import { useStore } from '@/data/store';
import type { AutoDeduction } from '@/data/types';
import { useTheme } from '@/hooks/use-theme';
import { confirm, notify } from '@/lib/dialog';
import { CURRENCY, formatMoney } from '@/lib/money';

type Scope = 'active' | 'all';

const SCOPES: { value: Scope; label: string }[] = [
  { value: 'active', label: 'Collecting' },
  { value: 'all', label: 'All plans' },
];

/**
 * Recovering an advance a little at a time, instead of all at once.
 *
 * A worker on ₹600/day who takes ₹5,000 shows a negative balance for eight
 * days and cannot be paid a rupee in that time — which is exactly the
 * situation an installment arrangement exists to avoid. A plan holds only the
 * installments actually recovered against the current period and carries the
 * rest as a tracked debt.
 *
 * Closing a plan is NOT the same as finishing one. It writes the remainder
 * off: collection stops and the unrecovered principal lands back on the
 * worker's balance as the plain advance it always was. That is why it is
 * behind a confirmation that names the figure.
 *
 * The usual way a plan starts is the "recover in installments" switch on an
 * advance, which links it to the ADVANCE row. The form here is for a debt
 * agreed off the books, and deliberately links no transaction.
 */
export default function DeductionsScreen() {
  const theme = useTheme();
  const router = useRouter();

  const { workers, getDeductions, createDeduction, closeDeduction, isOnline } = useStore();

  const [scope, setScope] = useState<Scope>('active');
  const [plans, setPlans] = useState<AutoDeduction[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<number | null>(null);

  const [showAdd, setShowAdd] = useState(false);
  const [workerId, setWorkerId] = useState<number | null>(null);
  const [principal, setPrincipal] = useState('');
  const [daily, setDaily] = useState('');
  const [note, setNote] = useState('');
  const [adding, setAdding] = useState(false);

  const load = useCallback(
    async (controller?: AbortController) => {
      try {
        const rows = await getDeductions({ activeOnly: scope === 'active' }, controller?.signal);
        if (!controller?.signal.aborted) setPlans(rows);
      } catch (caught) {
        if (!controller?.signal.aborted) setError((caught as Error).message);
      } finally {
        if (!controller?.signal.aborted) setLoading(false);
      }
    },
    [getDeductions, scope]
  );

  useEffect(() => {
    const controller = new AbortController();
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load(controller);
    return () => controller.abort();
  }, [load]);

  // A worker can only run one plan at a time — two would take two deductions
  // a day and neither would be the figure that was agreed. The API returns a
  // 409 either way; hiding them here means the contractor never picks a name
  // that is going to be refused.
  const collecting = new Set(
    plans.filter((plan) => plan.is_active).map((plan) => plan.worker_id)
  );
  const available = workers.filter((worker) => !collecting.has(worker.id));

  async function create() {
    setError(null);

    if (!workerId) {
      setError('Pick a worker first');
      return;
    }
    const principalAmount = Number.parseFloat(principal);
    if (!Number.isFinite(principalAmount) || principalAmount <= 0) {
      setError('How much is being recovered?');
      return;
    }
    const dailyAmount = Number.parseFloat(daily);
    if (!Number.isFinite(dailyAmount) || dailyAmount <= 0) {
      setError('How much comes off each day worked?');
      return;
    }
    if (dailyAmount > principalAmount) {
      // Otherwise the first day clears the whole plan, which is not an
      // installment arrangement — it is a lump sum with extra steps.
      setError('The daily amount cannot be larger than the debt being recovered');
      return;
    }

    setAdding(true);
    try {
      const created = await createDeduction({
        worker_id: workerId,
        principal_amount: principalAmount,
        daily_deduction: dailyAmount,
        note: note.trim() || null,
      });
      setPlans((current) => [created, ...current]);
      setWorkerId(null);
      setPrincipal('');
      setDaily('');
      setNote('');
      setShowAdd(false);
    } catch (caught) {
      setError((caught as Error).message);
    } finally {
      setAdding(false);
    }
  }

  async function confirmClose(plan: AutoDeduction) {
    const name = plan.worker_name ?? `Worker #${plan.worker_id}`;
    const ok = await confirm({
      title: 'Stop collecting?',
      message: `${CURRENCY}${formatMoney(plan.balance_remaining)} of ${name}'s ${CURRENCY}${formatMoney(
        plan.principal_amount
      )} has not been recovered. Closing the plan writes that off — it goes back onto their balance as a plain advance.`,
      confirmLabel: 'Write off the rest',
      cancelLabel: 'Keep collecting',
      destructive: true,
    });
    if (!ok) return;

    setBusy(plan.id);
    setError(null);
    try {
      await closeDeduction(plan.id);
      await load();
    } catch (caught) {
      const message = (caught as Error).message;
      setError(message);
      notify('Could not close the plan', message);
    } finally {
      setBusy(null);
    }
  }

  const outstanding = plans
    .filter((plan) => plan.is_active)
    .reduce((sum, plan) => sum + plan.balance_remaining, 0);

  return (
    <SafeAreaView style={[styles.screen, { backgroundColor: theme.background }]} edges={['top']}>
      <ScreenHeader
        title="Installments"
        subtitle={`${CURRENCY}${formatMoney(outstanding)} still to recover`}
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

          {!isOnline ? (
            <ThemedText type="small" style={{ color: theme.warning }}>
              You are offline. Opening or closing a plan moves every payable figure, so it needs a
              connection.
            </ThemedText>
          ) : null}

          <Segmented options={SCOPES} value={scope} onChange={setScope} />

          {loading ? (
            <ActivityIndicator color={theme.tint} style={styles.loading} />
          ) : plans.length === 0 ? (
            <EmptyState
              title={scope === 'active' ? 'Nothing being recovered' : 'No plans yet'}
              message="An advance taken back a little each day, instead of all at once — so a worker who borrowed ₹5,000 can still be paid this week."
              action={
                available.length
                  ? { label: 'Open a plan', onPress: () => setShowAdd(true) }
                  : undefined
              }
            />
          ) : (
            plans.map((plan) => {
              // principal is > 0 (the API and the form both enforce it), so
              // this never divides by zero.
              const progress = Math.min(1, plan.recovered_amount / plan.principal_amount);
              const name = plan.worker_name ?? `Worker #${plan.worker_id}`;

              return (
                <Card key={plan.id} style={styles.planCard}>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={`Installment history for ${name}`}
                    onPress={() =>
                      router.push({
                        pathname: '/(contractor)/deduction/[id]',
                        params: { id: String(plan.id) },
                      })
                    }
                    style={({ pressed }) => [styles.planHead, pressed && { opacity: 0.6 }]}>
                    <Avatar name={name} size={38} />
                    <View style={styles.planTitle}>
                      <ThemedText type="smallBold" numberOfLines={1}>
                        {name}
                      </ThemedText>
                      <ThemedText type="small" themeColor="textSecondary">
                        {CURRENCY}
                        {formatMoney(plan.daily_deduction)} a day worked
                      </ThemedText>
                    </View>
                    {plan.is_active ? (
                      <Badge label="Collecting" color={theme.tint} />
                    ) : (
                      <Badge label="Closed" color={theme.textSecondary} />
                    )}
                  </Pressable>

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
                        Left
                      </ThemedText>
                      <ThemedText type="smallBold">
                        {CURRENCY}
                        {formatMoney(plan.balance_remaining)}
                      </ThemedText>
                    </View>
                    <View style={styles.figure}>
                      <ThemedText type="small" themeColor="textSecondary">
                        Of
                      </ThemedText>
                      <ThemedText type="smallBold" themeColor="textSecondary">
                        {CURRENCY}
                        {formatMoney(plan.principal_amount)}
                      </ThemedText>
                    </View>
                  </View>

                  <View style={[styles.track, { backgroundColor: theme.backgroundSelected }]}>
                    <View
                      style={[
                        styles.fill,
                        { backgroundColor: theme.positive, width: `${progress * 100}%` },
                      ]}
                    />
                  </View>

                  {plan.note ? (
                    <ThemedText type="small" themeColor="textSecondary" numberOfLines={2}>
                      {plan.note}
                    </ThemedText>
                  ) : null}

                  {plan.is_active ? (
                    <Button
                      title={busy === plan.id ? '…' : 'Stop collecting'}
                      variant="ghost"
                      disabled={!isOnline || busy === plan.id}
                      onPress={() => void confirmClose(plan)}
                    />
                  ) : null}
                </Card>
              );
            })
          )}

          {showAdd ? (
            <Card style={styles.addCard}>
              <ThemedText type="smallBold" themeColor="textSecondary">
                WORKER
              </ThemedText>
              {available.length === 0 ? (
                <ThemedText type="small" themeColor="textSecondary">
                  Everyone on the crew is already repaying something. Close a plan before opening
                  another against the same worker.
                </ThemedText>
              ) : (
                <ScrollView
                  horizontal
                  showsHorizontalScrollIndicator={false}
                  contentContainerStyle={styles.workerStrip}>
                  {available.map((candidate) => {
                    const selected = candidate.id === workerId;
                    return (
                      <Pressable
                        key={candidate.id}
                        accessibilityRole="button"
                        accessibilityState={{ selected }}
                        onPress={() => setWorkerId(candidate.id)}
                        style={({ pressed }) => [
                          styles.workerChip,
                          {
                            borderColor: selected ? theme.tint : theme.border,
                            backgroundColor: selected
                              ? `${theme.tint}1A`
                              : theme.backgroundElement,
                            opacity: pressed ? 0.7 : 1,
                          },
                        ]}>
                        <Avatar name={candidate.name} size={36} />
                        <ThemedText type="small" numberOfLines={1} style={styles.workerChipName}>
                          {candidate.name.split(' ')[0]}
                        </ThemedText>
                      </Pressable>
                    );
                  })}
                </ScrollView>
              )}

              <Field
                label="Amount to recover"
                value={principal}
                onChangeText={setPrincipal}
                keyboardType="decimal-pad"
                placeholder="5000"
                hint="What was handed over. This cannot be edited later — it is what actually left the cash box."
                returnKeyType="next"
              />
              <Field
                label="Taken off each day worked"
                value={daily}
                onChangeText={setDaily}
                keyboardType="decimal-pad"
                placeholder="200"
                returnKeyType="next"
              />
              <Field
                label="Note (optional)"
                value={note}
                onChangeText={setNote}
                placeholder="Advance agreed in June"
                maxLength={255}
                returnKeyType="done"
              />

              <Button
                title="Open plan"
                loading={adding}
                disabled={!isOnline || available.length === 0}
                onPress={() => void create()}
              />
              <Button
                title="Cancel"
                variant="ghost"
                disabled={adding}
                onPress={() => setShowAdd(false)}
              />
            </Card>
          ) : plans.length ? (
            <Button
              title="+ Open a plan"
              variant="secondary"
              disabled={available.length === 0}
              onPress={() => setShowAdd(true)}
            />
          ) : null}
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
  planCard: {
    gap: Spacing.three,
  },
  planHead: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two + 2,
  },
  planTitle: {
    flex: 1,
    gap: 1,
  },
  figures: {
    flexDirection: 'row',
    gap: Spacing.two,
  },
  figure: {
    flex: 1,
    gap: 1,
  },
  track: {
    height: 6,
    borderRadius: 3,
    overflow: 'hidden',
  },
  fill: {
    height: '100%',
    borderRadius: 3,
  },
  addCard: {
    gap: Spacing.three,
  },
  workerStrip: {
    gap: Spacing.two,
    paddingVertical: Spacing.half,
  },
  workerChip: {
    width: 86,
    alignItems: 'center',
    gap: Spacing.one,
    paddingVertical: Spacing.two,
    paddingHorizontal: Spacing.one,
    borderRadius: Radius.medium,
    borderWidth: 1,
  },
  workerChipName: {
    textAlign: 'center',
  },
});
