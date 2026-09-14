import { useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
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
import { TradeBadge } from '@/components/trade-badge';
import { Avatar, Badge, Button, Card, EmptyState, Field } from '@/components/ui-kit';
import { MaxContentWidth, Radius, Spacing } from '@/constants/theme';
import { useStore } from '@/data/store';
import type { PieceRateLog } from '@/data/types';
import { useTheme } from '@/hooks/use-theme';
import { CURRENCY, formatMoney, formatRelativeDate, toISODate } from '@/lib/money';

/**
 * Work paid by output rather than by the day.
 *
 * A tiler laying 120 sq ft at ₹18, a bar bender doing 400 kg at ₹4. The day
 * rate on the worker says nothing about what they earned; this screen is
 * where that gets recorded.
 *
 * The total is shown but never typed: the server multiplies quantity by rate,
 * so there is no client-supplied figure that could disagree with the two
 * numbers meant to produce it. The preview below the form is exactly that
 * multiplication, shown early so a mistyped rate is caught before it becomes
 * a wage.
 *
 * Every log writes a WAGE into the worker's ledger, which is why saving one
 * refreshes the whole dashboard.
 */
export default function PieceRateScreen() {
  const theme = useTheme();
  const router = useRouter();
  const params = useLocalSearchParams<{ workerId?: string; siteId?: string }>();

  const { workers, sites, getPieceRateLogs, addPieceRateLog, isOnline } = useStore();

  const siteId = Number(params.siteId);
  const scopedSite = Number.isFinite(siteId)
    ? sites.find((candidate) => candidate.id === siteId)
    : undefined;

  const [workerId, setWorkerId] = useState<number | null>(() => {
    const fromParams = Number(params.workerId);
    return Number.isFinite(fromParams) && fromParams > 0 ? fromParams : null;
  });
  const [description, setDescription] = useState('');
  const [quantity, setQuantity] = useState('');
  const [rate, setRate] = useState('');

  const [logs, setLogs] = useState<PieceRateLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const worker = workers.find((candidate) => candidate.id === workerId) ?? null;
  const today = toISODate(new Date());

  /**
   * Piece-rate workers first: they are the ones a P/A/H toggle is meaningless
   * for, so this screen is the only way they get paid. Daily workers stay in
   * the list because measured work is occasionally given to them too.
   */
  const crew = useMemo(() => {
    const scoped = scopedSite
      ? workers.filter((candidate) => candidate.site_id === scopedSite.id)
      : workers;
    return [...scoped].sort((a, b) => {
      const byType = Number(b.wage_type === 'piece_rate') - Number(a.wage_type === 'piece_rate');
      return byType !== 0 ? byType : a.name.localeCompare(b.name);
    });
  }, [workers, scopedSite]);

  const load = useCallback(
    async (controller?: AbortController) => {
      try {
        const rows = await getPieceRateLogs(
          scopedSite ? { siteId: scopedSite.id, limit: 50 } : { limit: 50 },
          controller?.signal
        );
        if (!controller?.signal.aborted) setLogs(rows);
      } catch (caught) {
        if (!controller?.signal.aborted) setError((caught as Error).message);
      } finally {
        if (!controller?.signal.aborted) setLoading(false);
      }
    },
    [getPieceRateLogs, scopedSite]
  );

  useEffect(() => {
    const controller = new AbortController();
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load(controller);
    return () => controller.abort();
  }, [load]);

  // The same multiplication the server will do, shown before the save so a
  // rate typed into the quantity box is caught here rather than in a ledger.
  const parsedQuantity = Number.parseFloat(quantity);
  const parsedRate = Number.parseFloat(rate);
  const previewTotal =
    Number.isFinite(parsedQuantity) && Number.isFinite(parsedRate)
      ? parsedQuantity * parsedRate
      : null;

  async function save() {
    setError(null);

    if (!worker) {
      setError('Pick a worker first');
      return;
    }
    if (!description.trim()) {
      setError('Say what was measured — "Tiling, second floor bedrooms"');
      return;
    }
    if (!Number.isFinite(parsedQuantity) || parsedQuantity <= 0) {
      setError('How much was done?');
      return;
    }
    if (!Number.isFinite(parsedRate) || parsedRate <= 0) {
      setError('What is the rate per unit?');
      return;
    }

    setSaving(true);
    try {
      const created = await addPieceRateLog({
        worker_id: worker.id,
        work_description: description.trim(),
        quantity: parsedQuantity,
        rate: parsedRate,
        site_id: scopedSite?.id ?? null,
        date: today,
      });
      setLogs((current) => [created, ...current]);
      setDescription('');
      setQuantity('');
      setRate('');
    } catch (caught) {
      setError((caught as Error).message);
    } finally {
      setSaving(false);
    }
  }

  const loggedTotal = logs.reduce((sum, log) => sum + log.total_amount, 0);

  return (
    <SafeAreaView style={[styles.screen, { backgroundColor: theme.background }]} edges={['top']}>
      <ScreenHeader
        title="Piece work"
        subtitle={
          scopedSite
            ? `${scopedSite.name} · ${CURRENCY}${formatMoney(loggedTotal)} logged`
            : `${CURRENCY}${formatMoney(loggedTotal)} logged`
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

          {!isOnline ? (
            <ThemedText type="small" style={{ color: theme.warning }}>
              You are offline. Logging piece work writes a wage, so it needs a connection.
            </ThemedText>
          ) : null}

          <View style={styles.section}>
            <ThemedText type="smallBold" themeColor="textSecondary">
              WORKER
            </ThemedText>
            {crew.length === 0 ? (
              <ThemedText type="small" themeColor="textSecondary">
                {scopedSite
                  ? 'Nobody is posted to this site yet.'
                  : 'Add a worker before logging measured work.'}
              </ThemedText>
            ) : (
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={styles.workerStrip}>
                {crew.map((candidate) => {
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
                      <TradeBadge trade={candidate.trade} compact />
                    </Pressable>
                  );
                })}
              </ScrollView>
            )}
          </View>

          <Card style={styles.form}>
            <Field
              label="What was measured?"
              value={description}
              onChangeText={setDescription}
              placeholder="Tiling, second floor bedrooms"
              maxLength={255}
              returnKeyType="next"
            />

            <View style={styles.pairRow}>
              <View style={styles.pairItem}>
                <Field
                  label="Quantity"
                  value={quantity}
                  onChangeText={setQuantity}
                  keyboardType="decimal-pad"
                  placeholder="120.5"
                  returnKeyType="next"
                />
              </View>
              <View style={styles.pairItem}>
                <Field
                  label={`Rate (${CURRENCY} per unit)`}
                  value={rate}
                  onChangeText={setRate}
                  keyboardType="decimal-pad"
                  placeholder="18"
                  returnKeyType="done"
                />
              </View>
            </View>

            {/* Not an input. The server multiplies; this is the same sum shown
                early so a mistyped rate is caught before it becomes a wage. */}
            <View style={[styles.totalRow, { borderTopColor: theme.border }]}>
              <ThemedText type="small" themeColor="textSecondary">
                Wage this earns
              </ThemedText>
              <ThemedText
                type="smallBold"
                style={{ color: previewTotal ? theme.positive : theme.textSecondary }}>
                {previewTotal ? `${CURRENCY}${formatMoney(previewTotal)}` : '—'}
              </ThemedText>
            </View>

            <Button
              title="Log work"
              loading={saving}
              disabled={!isOnline || !worker}
              onPress={() => void save()}
            />
            {worker ? (
              <ThemedText type="small" themeColor="textSecondary">
                Goes into {worker.name.split(' ')[0]}&apos;s ledger as a wage, dated today.
              </ThemedText>
            ) : null}
          </Card>

          <ThemedText type="smallBold" themeColor="textSecondary" style={styles.sectionLabel}>
            RECENTLY LOGGED
          </ThemedText>

          {loading ? (
            <ActivityIndicator color={theme.tint} style={styles.loading} />
          ) : logs.length === 0 ? (
            <EmptyState
              title="No measured work yet"
              message="Tiles laid, steel bent, plaster done — anything paid by the unit rather than the day."
            />
          ) : (
            logs.map((log) => (
              <Card key={log.id} style={styles.logCard}>
                <View style={styles.logHead}>
                  <View style={styles.logTitle}>
                    <ThemedText type="smallBold" numberOfLines={1}>
                      {log.work_description}
                    </ThemedText>
                    <ThemedText type="small" themeColor="textSecondary">
                      {log.worker_name ?? `Worker #${log.worker_id}`} ·{' '}
                      {formatRelativeDate(log.date)}
                    </ThemedText>
                  </View>
                  <ThemedText type="smallBold" style={{ color: theme.positive }}>
                    {CURRENCY}
                    {formatMoney(log.total_amount)}
                  </ThemedText>
                </View>

                <View style={styles.logFoot}>
                  <ThemedText type="small" themeColor="textSecondary">
                    {formatMoney(log.quantity)} × {CURRENCY}
                    {formatMoney(log.rate)}
                  </ThemedText>
                  {/* The ledger row this log wrote. Its absence would mean the
                      wage went missing, which is worth being able to see. */}
                  {log.transaction_id ? (
                    <Badge label="In ledger" color={theme.positive} />
                  ) : (
                    <Badge label="No wage row" color={theme.warning} />
                  )}
                </View>
              </Card>
            ))
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
  section: {
    gap: Spacing.two,
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
  form: {
    gap: Spacing.three,
  },
  pairRow: {
    flexDirection: 'row',
    gap: Spacing.two,
  },
  pairItem: {
    flex: 1,
  },
  totalRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingTop: Spacing.two,
  },
  sectionLabel: {
    letterSpacing: 0.5,
    marginTop: Spacing.two,
  },
  loading: {
    paddingVertical: Spacing.five,
  },
  logCard: {
    gap: Spacing.two,
  },
  logHead: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: Spacing.two,
  },
  logTitle: {
    flex: 1,
    gap: 1,
  },
  logFoot: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.two,
  },
});
