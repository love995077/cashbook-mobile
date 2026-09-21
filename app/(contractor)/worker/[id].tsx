import { useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import { FlatList, Pressable, RefreshControl, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { BalanceCard } from '@/components/balance-card';
import { LedgerRow } from '@/components/ledger-row';
import { EditWorkerModal } from '@/components/edit-worker-modal';
import { ErrorState, LoadingState } from '@/components/load-state';
import { StatementButton } from '@/components/statement-button';
import { ThemedText } from '@/components/themed-text';
import { TradeBadge } from '@/components/trade-badge';
import { Button, EmptyState } from '@/components/ui-kit';
import { MaxContentWidth, Spacing } from '@/constants/theme';
import { useStore } from '@/data/store';
import { useTheme } from '@/hooks/use-theme';
import { confirm, notify } from '@/lib/dialog';
import { CURRENCY, TRANSACTION_LABELS, formatMoney, formatRelativeDate } from '@/lib/money';

/**
 * One worker, seen by their contractor: balance, history, and the two things
 * you would want to do from here — add an entry, or share the statement.
 */
export default function WorkerDetailScreen() {
  const theme = useTheme();
  const router = useRouter();
  const params = useLocalSearchParams<{ id?: string }>();
  const workerId = Number(params.id);

  const {
    workers,
    getLedger,
    loading,
    refreshing,
    error,
    refresh,
    removeWorker,
    deleteTransaction,
    isOnline,
  } = useStore();
  const [removing, setRemoving] = useState(false);
  const [removeError, setRemoveError] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  // The id of the entry whose delete is in flight, so only that row dims.
  const [deletingId, setDeletingId] = useState<number | null>(null);
  const worker = workers.find((candidate) => candidate.id === workerId);
  const ledger = Number.isFinite(workerId) ? getLedger(workerId) : undefined;
  // What the contractor still owes. Negative means the worker is ahead, and
  // there is nothing to settle.
  const owed = ledger?.balance.balance ?? 0;

  async function confirmRemove() {
    const name = worker?.name ?? ledger?.worker.name ?? 'This worker';
    // The balance is the thing worth saying out loud: removing someone you
    // still owe is a decision, not a slip, and it should not be made from a
    // screen that stayed quiet about it.
    const owedLine =
      owed > 0
        ? `You still owe them ${CURRENCY}${formatMoney(owed)}. `
        : owed < 0
          ? `They are ${CURRENCY}${formatMoney(-owed)} ahead. `
          : '';

    const ok = await confirm({
      title: `Remove ${name}?`,
      message:
        `${owedLine}They come off your crew and out of the attendance grid. ` +
        'Their ledger is kept, so past wages and reports stay correct.',
      confirmLabel: 'Remove',
      cancelLabel: 'Keep on crew',
      destructive: true,
    });
    if (!ok) return;

    setRemoving(true);
    setRemoveError(null);
    try {
      await removeWorker(workerId);
      router.back();
    } catch (caught) {
      const message = (caught as Error).message;
      setRemoveError(message);
      notify('Could not remove', message);
      // Left cleared only on failure: on success this screen is going away.
      setRemoving(false);
    }
  }

  /**
   * Delete a mistyped wage, advance or payment.
   *
   * The amount and date are read back in the question. A ledger row is four
   * words and a number; "are you sure?" on its own gives the contractor
   * nothing to check the row against, and this is the one action here that
   * money cannot be recovered from by re-entering it.
   */
  async function confirmDeleteEntry(transactionId: number) {
    const entry = ledger?.entries.find(
      (candidate) => candidate.kind === 'transaction' && candidate.transaction.id === transactionId
    );
    if (!entry || entry.kind !== 'transaction') return;

    if (!isOnline) {
      notify(
        'You are offline',
        'Deleting an entry needs a connection, so the balance everyone reads stays in step. Try again once you are back online.'
      );
      return;
    }

    const { type, amount } = entry.transaction;
    const label = TRANSACTION_LABELS[type].toLowerCase();

    const ok = await confirm({
      title: 'Delete entry?',
      message:
        `This removes the ${CURRENCY}${formatMoney(amount)} ${label} ` +
        `from ${formatRelativeDate(entry.date)}. The balance and your cash ` +
        'totals update straight away. This cannot be undone — delete it only ' +
        'if the entry was a mistake, not if the money actually changed hands.',
      confirmLabel: 'Delete',
      cancelLabel: 'Keep it',
      destructive: true,
    });
    if (!ok) return;

    setDeletingId(transactionId);
    try {
      await deleteTransaction(transactionId);
    } catch (caught) {
      // Covers the 409 the API answers when an installment plan, an advance
      // request or a piece-rate log was built on this entry. That message
      // names what to unwind first, so it is shown as sent rather than
      // flattened into "could not delete".
      notify('Could not delete', (caught as Error).message);
    } finally {
      setDeletingId(null);
    }
  }

  if (!Number.isFinite(workerId)) {
    return (
      <SafeAreaView style={[styles.screen, { backgroundColor: theme.background }]}>
        <ErrorState message="That worker link is not valid." onRetry={() => router.back()} />
      </SafeAreaView>
    );
  }

  const body = () => {
    if (loading && !ledger) return <LoadingState label="Loading ledger…" />;
    if (error && !ledger) return <ErrorState message={error} onRetry={refresh} />;
    if (!ledger) {
      return <EmptyState title="Worker not found" message="They may have been removed." />;
    }

    return (
      <FlatList
        data={ledger.entries}
        keyExtractor={(entry) => `${entry.kind}-${entry.id}`}
        contentContainerStyle={styles.content}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor={theme.tint} />
        }
        ListHeaderComponent={
          <View style={styles.headerBlock}>
            <View style={styles.cardWrap}>
              <BalanceCard balance={ledger.balance} />
            </View>

            <View style={styles.actions}>
              <Button
                title="New entry"
                onPress={() =>
                  router.push({
                    pathname: '/(contractor)/new-entry',
                    params: { workerId: String(workerId) },
                  })
                }
              />
              {/* A present/absent toggle is meaningless for a tiler, so this
                  is how a piece-rate worker gets paid at all — offered ahead
                  of settling for them, and still available to a daily worker
                  who was given measured work. */}
              <Button
                title="Log piece work"
                variant={worker?.wage_type === 'piece_rate' ? 'primary' : 'secondary'}
                onPress={() =>
                  router.push({
                    pathname: '/(contractor)/piece-rate',
                    params: { workerId: String(workerId) },
                  })
                }
              />
              {/* Secondary, and disabled when nothing is owed: settling is the
                  end of a pay period, not a daily action, and a live balance
                  is the honest label for it. */}
              <Button
                title={
                  owed > 0
                    ? `Settle payroll · ${CURRENCY}${formatMoney(owed)}`
                    : 'Settle payroll'
                }
                variant="secondary"
                disabled={owed <= 0}
                onPress={() =>
                  router.push({
                    pathname: '/(contractor)/settle/[id]',
                    params: { id: String(workerId) },
                  })
                }
              />
              <StatementButton
                workerId={workerId}
                workerName={ledger.worker.name}
              />
              {/* Ghost: an installment plan is opened from an advance in the
                  usual flow, and this is the way back to one that exists. */}
              <Button
                title="Installments"
                variant="ghost"
                onPress={() => router.push('/(contractor)/deductions')}
              />
            </View>

            <ThemedText type="smallBold" themeColor="textSecondary" style={styles.sectionLabel}>
              HISTORY
            </ThemedText>
            {/* Long press has no icon to advertise it, so the list says so
                once at the top rather than putting a delete target on every
                row. Only shown when there is something deletable to long
                press. */}
            {ledger.entries.some((entry) => entry.kind === 'transaction') ? (
              <ThemedText type="small" themeColor="textSecondary" style={styles.historyHint}>
                Press and hold an entry to delete it.
              </ThemedText>
            ) : null}
          </View>
        }
        renderItem={({ item }) => (
          <LedgerRow
            entry={item}
            onDelete={(transactionId) => void confirmDeleteEntry(transactionId)}
            deleting={item.kind === 'transaction' && deletingId === item.transaction.id}
          />
        )}
        ItemSeparatorComponent={() => (
          <View style={[styles.separator, { backgroundColor: theme.border }]} />
        )}
        ListEmptyComponent={
          <EmptyState
            title="Nothing logged yet"
            message="Wages, advances and attendance will appear here."
          />
        }
        ListFooterComponent={
          <View style={styles.danger}>
            {removeError ? (
              <ThemedText type="small" style={{ color: theme.negative }}>
                {removeError}
              </ThemedText>
            ) : null}
            {/* Above the destructive control, because correcting a record is
                the far more common intent and should not sit below the one
                that removes it. */}
            <Button
              title="Edit details"
              variant="secondary"
              disabled={!isOnline}
              onPress={() => setEditing(true)}
            />
            <Button
              title="Remove worker"
              variant="destructive"
              loading={removing}
              disabled={!isOnline}
              onPress={() => void confirmRemove()}
            />
            <ThemedText type="small" themeColor="textSecondary" style={styles.dangerNote}>
              Their ledger is kept. Past wages, statements and reports stay correct.
            </ThemedText>
          </View>
        }
      />
    );
  };

  const subtitle = worker?.daily_wage
    ? `${CURRENCY}${formatMoney(worker.daily_wage)} / day`
    : worker?.phone;

  return (
    <SafeAreaView style={[styles.screen, { backgroundColor: theme.background }]} edges={['top']}>
      {/* Keyed on the worker so the form re-seeds from the saved record after
          a save, rather than holding the values that were typed. */}
      {worker ? (
        <EditWorkerModal
          key={`${worker.id}-${worker.name}-${worker.daily_wage}`}
          worker={worker}
          visible={editing}
          onClose={() => setEditing(false)}
        />
      ) : null}

      <View style={styles.bar}>
        <Pressable
          accessibilityRole="button"
          onPress={() => router.back()}
          hitSlop={12}
          style={({ pressed }) => pressed && { opacity: 0.6 }}>
          <ThemedText type="smallBold" style={{ color: theme.tint }}>
            ‹ Workers
          </ThemedText>
        </Pressable>
      </View>

      <View style={styles.titleBlock}>
        <View style={styles.titleRow}>
          <ThemedText type="subtitle" numberOfLines={1} style={styles.titleName}>
            {worker?.name ?? ledger?.worker.name ?? 'Worker'}
          </ThemedText>
          <TradeBadge trade={worker?.trade ?? ledger?.worker.trade} />
        </View>
        {subtitle ? (
          <ThemedText type="small" themeColor="textSecondary">
            {subtitle}
          </ThemedText>
        ) : null}
      </View>

      {body()}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
  },
  bar: {
    paddingHorizontal: Spacing.three,
    paddingTop: Spacing.two,
  },
  titleBlock: {
    paddingHorizontal: Spacing.three,
    paddingTop: Spacing.two,
    paddingBottom: Spacing.three,
    gap: 1,
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
  },
  titleName: {
    flexShrink: 1,
  },
  content: {
    paddingBottom: Spacing.five,
    maxWidth: MaxContentWidth,
    width: '100%',
    alignSelf: 'center',
  },
  headerBlock: {
    gap: Spacing.three,
    marginBottom: Spacing.two,
  },
  cardWrap: {
    paddingHorizontal: Spacing.three,
  },
  actions: {
    paddingHorizontal: Spacing.three,
    gap: Spacing.two,
  },
  sectionLabel: {
    paddingHorizontal: Spacing.three,
    letterSpacing: 0.5,
  },
  historyHint: {
    paddingHorizontal: Spacing.three,
    paddingTop: 2,
  },
  separator: {
    height: StyleSheet.hairlineWidth,
    marginLeft: Spacing.three + 36 + Spacing.three,
  },
  // Set well below the history so it cannot be hit while scanning the ledger.
  danger: {
    paddingHorizontal: Spacing.three,
    paddingTop: Spacing.five,
    gap: Spacing.two,
  },
  dangerNote: {
    textAlign: 'center',
  },
});
