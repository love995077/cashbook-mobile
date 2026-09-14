import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Button, EmptyState, Field } from '@/components/ui-kit';
import { Radius, Spacing } from '@/constants/theme';
import { useStore } from '@/data/store';
import type { PettyCashEntry, PettyCashTotals } from '@/data/types';
import { useTheme } from '@/hooks/use-theme';
import { confirm, notify } from '@/lib/dialog';
import { CURRENCY, formatMoney, formatRelativeDate } from '@/lib/money';

/**
 * The site's small cash: fares, tea, a packet of nails.
 *
 * Deliberately not the expense form. A `CashEntry` wants a category, a
 * direction and a date picker; this wants two fields and a thumb, because it
 * is filled in standing next to the person who was just handed the money.
 *
 * The description is required rather than optional — an unlabelled ₹200 is
 * exactly the entry nobody can account for at the end of the job, and this
 * tab is made of those.
 */
export function PettyCashTab({ siteId }: { siteId: number }) {
  const theme = useTheme();
  const { getPettyCash, getPettyCashTotals, addPettyCash, removePettyCash, isOnline } =
    useStore();

  const [entries, setEntries] = useState<PettyCashEntry[]>([]);
  const [totals, setTotals] = useState<PettyCashTotals | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [amount, setAmount] = useState('');
  const [description, setDescription] = useState('');
  const [saving, setSaving] = useState(false);

  const load = useCallback(
    async (controller: AbortController) => {
      try {
        const [rows, sums] = await Promise.all([
          getPettyCash(siteId, controller.signal),
          getPettyCashTotals(siteId, controller.signal),
        ]);
        if (controller.signal.aborted) return;
        setEntries(rows);
        setTotals(sums);
      } catch (caught) {
        if (!controller.signal.aborted) setError((caught as Error).message);
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    },
    [siteId, getPettyCash, getPettyCashTotals]
  );

  useEffect(() => {
    const controller = new AbortController();
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load(controller);
    return () => controller.abort();
  }, [load]);

  async function save() {
    setError(null);

    const value = Number.parseFloat(amount);
    if (!Number.isFinite(value) || value <= 0) {
      setError('Enter an amount greater than zero');
      return;
    }
    if (!description.trim()) {
      setError('Say what it was for — an unlabelled entry is impossible to account for later');
      return;
    }

    setSaving(true);
    try {
      const created = await addPettyCash(siteId, {
        amount: value,
        description: description.trim(),
      });
      setEntries((current) => [created, ...current]);
      // Moved locally rather than refetched: one entry changes two numbers,
      // and a round trip to learn that is a round trip wasted.
      setTotals((current) =>
        current
          ? {
              ...current,
              total: current.total + created.amount,
              period_total: current.period_total + created.amount,
              entry_count: current.entry_count + 1,
            }
          : current
      );
      setAmount('');
      setDescription('');
    } catch (caught) {
      setError((caught as Error).message);
    } finally {
      setSaving(false);
    }
  }

  async function confirmRemove(entry: PettyCashEntry) {
    const ok = await confirm({
      title: 'Delete this entry?',
      message: `${CURRENCY}${formatMoney(entry.amount)} — ${entry.description}`,
      confirmLabel: 'Delete',
      cancelLabel: 'Keep',
      destructive: true,
    });
    if (!ok) return;

    try {
      await removePettyCash(siteId, entry.id);
      setEntries((current) => current.filter((row) => row.id !== entry.id));
      setTotals((current) =>
        current
          ? {
              ...current,
              total: current.total - entry.amount,
              period_total: current.period_total - entry.amount,
              entry_count: Math.max(current.entry_count - 1, 0),
            }
          : current
      );
    } catch (caught) {
      const message = (caught as Error).message;
      setError(message);
      notify('Could not delete', message);
    }
  }

  return (
    <View style={styles.wrap}>
      <View style={styles.header}>
        <ThemedText type="smallBold" themeColor="textSecondary">
          PETTY CASH
        </ThemedText>
        <ThemedText type="smallBold" style={{ color: theme.negative }}>
          {CURRENCY}
          {formatMoney(totals?.total ?? 0)}
        </ThemedText>
      </View>

      <View style={styles.form}>
        <View style={styles.formRow}>
          <View style={styles.amountField}>
            <Field
              label="Amount"
              value={amount}
              onChangeText={setAmount}
              keyboardType="decimal-pad"
              placeholder={`${CURRENCY}0`}
              returnKeyType="next"
            />
          </View>
          <View style={styles.descField}>
            <Field
              label="What for"
              value={description}
              onChangeText={setDescription}
              placeholder="Auto fare, cement pickup"
              maxLength={255}
              returnKeyType="done"
              onSubmitEditing={() => void save()}
            />
          </View>
        </View>

        <Button
          title={saving ? 'Saving…' : 'Log cash out'}
          loading={saving}
          disabled={!isOnline}
          onPress={() => void save()}
        />

        {!isOnline ? (
          <ThemedText type="small" style={{ color: theme.warning }}>
            You are offline. Petty cash is not queued — it needs a connection.
          </ThemedText>
        ) : null}

        {error ? (
          <ThemedText type="small" style={{ color: theme.negative }}>
            {error}
          </ThemedText>
        ) : null}
      </View>

      {loading ? (
        <ActivityIndicator color={theme.tint} style={styles.loading} />
      ) : entries.length === 0 ? (
        <EmptyState
          title="Nothing logged yet"
          message="Fares, tea, a packet of nails — the small cash that otherwise goes unaccounted for."
        />
      ) : (
        <View style={styles.list}>
          {entries.map((entry, index) => (
            <Pressable
              key={entry.id}
              accessibilityRole="button"
              accessibilityLabel={`${entry.description}, ${entry.amount}`}
              accessibilityHint="Hold to delete"
              onLongPress={() => void confirmRemove(entry)}
              style={({ pressed }) => [styles.row, pressed && { opacity: 0.6 }]}>
              {index > 0 ? (
                <View style={[styles.separator, { backgroundColor: theme.border }]} />
              ) : null}
              <View style={styles.rowBody}>
                <ThemedText type="small" numberOfLines={1}>
                  {entry.description}
                </ThemedText>
                <ThemedText type="small" themeColor="textSecondary" numberOfLines={1}>
                  {[formatRelativeDate(entry.date), entry.recorded_by_name]
                    .filter(Boolean)
                    .join(' · ')}
                </ThemedText>
              </View>
              <ThemedText type="smallBold" style={{ color: theme.negative }}>
                −{CURRENCY}
                {formatMoney(entry.amount)}
              </ThemedText>
            </Pressable>
          ))}
        </View>
      )}

      {entries.length ? (
        <ThemedText type="small" themeColor="textSecondary">
          Hold an entry to delete it.
        </ThemedText>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    gap: Spacing.three,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  form: {
    gap: Spacing.two,
  },
  formRow: {
    flexDirection: 'row',
    gap: Spacing.two,
  },
  amountField: {
    width: 120,
  },
  descField: {
    flex: 1,
  },
  loading: {
    paddingVertical: Spacing.four,
  },
  list: {
    gap: Spacing.one,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
    paddingVertical: Spacing.two,
    borderRadius: Radius.small,
  },
  rowBody: {
    flex: 1,
    gap: 1,
  },
  separator: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    height: StyleSheet.hairlineWidth,
  },
});
