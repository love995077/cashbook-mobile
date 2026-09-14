import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ScreenHeader } from '@/components/screen-header';
import { ThemedText } from '@/components/themed-text';
import { Badge, Button, Card, EmptyState, Field, Segmented } from '@/components/ui-kit';
import { MaxContentWidth, Spacing } from '@/constants/theme';
import { useAuth } from '@/auth/auth-context';
import { useStore } from '@/data/store';
import type { Invoice, InvoicePreview, InvoiceStatus } from '@/data/types';
import { useTheme } from '@/hooks/use-theme';
import { choose, type Choice } from '@/lib/dialog';
import { CURRENCY, formatMoney, formatRelativeDate, toISODate } from '@/lib/money';
import { downloadReport, reportFilename } from '@/lib/reports';

type Range = 'month' | 'quarter' | 'all';

const RANGES: { value: Range; label: string }[] = [
  { value: 'month', label: 'This month' },
  { value: 'quarter', label: 'Last 90 days' },
  { value: 'all', label: 'All time' },
];

const STATUS_LABELS: Record<InvoiceStatus, string> = {
  draft: 'Draft',
  sent: 'Sent',
  paid: 'Paid',
  void: 'Void',
};

/** What each line of the preview is, in the contractor's words. */
const KIND_LABELS = {
  piece_rate: 'Work done',
  materials: 'Materials and site costs',
  machinery: 'Plant and diesel',
} as const;

/**
 * Bill the client for a site.
 *
 * Three steps down one screen: pick the site and the period, read what the
 * site actually cost, and raise the bill.
 *
 * THE TOTAL IS TYPED, NOT COMPUTED
 * --------------------------------
 * The amount field is seeded from the calculation and then left alone. An
 * invoice carries markup, retention, a rounding, a discount agreed on the
 * phone — none of which this app models — so forcing the bill to equal the
 * sum of the logs would either be wrong or would need every commercial term
 * modelled first. The breakdown is the basis for the number, and the PDF says
 * so when the two differ.
 *
 * THE SUBTOTALS CAN OVERLAP
 * -------------------------
 * Diesel logged against a machine may also have been filed as a site expense.
 * The three are shown apart rather than silently added twice, so the overlap
 * is the contractor's to resolve rather than something the screen hides.
 *
 * Admin only. `GET /contractor/invoices` refuses a supervisor outright, and
 * the row into this screen is not drawn for one — see the Settings screen.
 */
export default function InvoicesScreen() {
  const theme = useTheme();
  const router = useRouter();
  const { token, user } = useAuth();
  const { sites, getInvoices, getInvoicePreview, addInvoice, editInvoice, isOnline } = useStore();

  const active = useMemo(() => sites.filter((site) => site.is_active), [sites]);

  const [siteId, setSiteId] = useState<number | null>(null);
  const [range, setRange] = useState<Range>('month');

  const [preview, setPreview] = useState<InvoicePreview | null>(null);
  const [calculating, setCalculating] = useState(false);

  const [clientName, setClientName] = useState('');
  const [amount, setAmount] = useState('');
  const [note, setNote] = useState('');
  const [touchedAmount, setTouchedAmount] = useState(false);
  const [raising, setRaising] = useState(false);

  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [loadingList, setLoadingList] = useState(true);
  const [busy, setBusy] = useState<number | null>(null);

  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // The first active site, once they arrive. A contractor with one job should
  // not have to press it before the screen does anything.
  useEffect(() => {
    if (siteId === null && active.length > 0) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setSiteId(active[0].id);
    }
  }, [active, siteId]);

  const window = useMemo(() => {
    const today = new Date();
    if (range === 'all') return { start: undefined as string | undefined, end: toISODate(today) };
    const start = new Date(today);
    if (range === 'month') start.setDate(1);
    else start.setDate(start.getDate() - 89);
    return { start: toISODate(start), end: toISODate(today) };
  }, [range]);

  // --- the calculation ------------------------------------------------------

  useEffect(() => {
    if (siteId === null) return;

    const controller = new AbortController();
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setCalculating(true);

    void (async () => {
      try {
        const result = await getInvoicePreview(
          siteId,
          { startDate: window.start, endDate: window.end },
          controller.signal
        );
        if (controller.signal.aborted) return;
        setPreview(result);
        setError(null);
      } catch (caught) {
        if (!controller.signal.aborted) {
          setPreview(null);
          setError((caught as Error).message);
        }
      } finally {
        if (!controller.signal.aborted) setCalculating(false);
      }
    })();

    return () => controller.abort();
  }, [siteId, window.start, window.end, getInvoicePreview]);

  // Seed the amount from the calculation, and keep re-seeding it until the
  // contractor types their own figure. After that the field is theirs: moving
  // the date range must not quietly overwrite a number they negotiated.
  useEffect(() => {
    if (preview && !touchedAmount) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setAmount(preview.suggested_total ? String(preview.suggested_total) : '');
    }
  }, [preview, touchedAmount]);

  // --- the list -------------------------------------------------------------

  const loadInvoices = useCallback(
    async (controller?: AbortController) => {
      try {
        const rows = await getInvoices({}, controller?.signal);
        if (!controller?.signal.aborted) setInvoices(rows);
      } catch (caught) {
        if (!controller?.signal.aborted) setError((caught as Error).message);
      } finally {
        if (!controller?.signal.aborted) setLoadingList(false);
      }
    },
    [getInvoices]
  );

  useEffect(() => {
    const controller = new AbortController();
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void loadInvoices(controller);
    return () => controller.abort();
  }, [loadInvoices]);

  // --- actions --------------------------------------------------------------

  async function raise() {
    setError(null);
    setMessage(null);

    if (siteId === null) {
      setError('Pick the site this bill is for');
      return;
    }
    if (!clientName.trim()) {
      setError('Name the client being billed');
      return;
    }
    const total = Number.parseFloat(amount);
    if (!Number.isFinite(total) || total < 0) {
      setError('Enter the amount to bill');
      return;
    }

    setRaising(true);
    try {
      const invoice = await addInvoice({
        site_id: siteId,
        client_name: clientName.trim(),
        total_amount: total,
        note: note.trim() || null,
      });
      setInvoices((current) => [invoice, ...current]);
      setClientName('');
      setNote('');
      setTouchedAmount(false);
      setMessage(
        `Invoice #${invoice.id} raised for ${CURRENCY}${formatMoney(invoice.total_amount)}. ` +
          'Export the PDF below to send it.'
      );
    } catch (caught) {
      setError((caught as Error).message);
    } finally {
      setRaising(false);
    }
  }

  /**
   * Build the PDF and hand it to the share sheet.
   *
   * The window travels with it so the basis breakdown on the paper matches
   * what was on screen when the figure was agreed.
   */
  async function exportPdf(invoice: Invoice) {
    setError(null);
    setMessage(null);
    setBusy(invoice.id);

    try {
      const outcome = await downloadReport({
        token: token ?? '',
        path: `/contractor/invoices/${invoice.id}/pdf`,
        params: { start_date: window.start ?? null, end_date: window.end },
        filename: reportFilename(invoice.client_name, `invoice-${invoice.id}`, 'pdf'),
        format: 'pdf',
        title: `Invoice #${invoice.id}`,
      });

      if (outcome.kind === 'saved') setMessage(`Saved to ${outcome.uri}`);
      else if (outcome.kind === 'downloaded') setMessage('Downloaded.');
      // 'shared' needs no message: the share sheet was the feedback.
    } catch (caught) {
      setError((caught as Error).message);
    } finally {
      setBusy(null);
    }
  }

  async function setStatus(invoice: Invoice, next: InvoiceStatus) {
    setError(null);
    setBusy(invoice.id);
    try {
      const updated = await editInvoice(invoice.id, { status: next });
      setInvoices((current) => current.map((row) => (row.id === invoice.id ? updated : row)));
    } catch (caught) {
      setError((caught as Error).message);
    } finally {
      setBusy(null);
    }
  }

  /**
   * The one menu an invoice row needs.
   *
   * Void rather than delete once it has been sent: an invoice the client has
   * seen is a thing they remember and will ask about, and the API refuses to
   * delete it anyway.
   */
  async function openActions(invoice: Invoice) {
    type Action = 'pdf' | InvoiceStatus;

    const options: Choice<Action>[] = [
      { label: 'Export PDF', value: 'pdf' as const },
      invoice.status === 'draft' ? { label: 'Mark as sent', value: 'sent' as const } : null,
      invoice.status === 'sent' ? { label: 'Mark as paid', value: 'paid' as const } : null,
      invoice.status !== 'void' && invoice.status !== 'paid'
        ? { label: 'Void it', value: 'void' as const, destructive: true }
        : null,
    ].filter((option) => option !== null);

    const action = await choose<Action>({
      title: `Invoice #${invoice.id}`,
      message: `${invoice.client_name} · ${CURRENCY}${formatMoney(invoice.total_amount)} · ${
        STATUS_LABELS[invoice.status]
      }`,
      options,
      cancelLabel: 'Close',
    });
    if (action === null) return;

    if (action === 'pdf') await exportPdf(invoice);
    else await setStatus(invoice, action);
  }

  // --- render ---------------------------------------------------------------

  const statusTone: Record<InvoiceStatus, string> = {
    draft: theme.textSecondary,
    sent: theme.warning,
    paid: theme.positive,
    void: theme.negative,
  };

  const site = active.find((candidate) => candidate.id === siteId) ?? null;
  const differs =
    preview !== null &&
    amount.trim() !== '' &&
    Number.parseFloat(amount) !== preview.suggested_total;

  return (
    <SafeAreaView style={[styles.screen, { backgroundColor: theme.background }]} edges={['top']}>
      <ScreenHeader
        title="Invoicing"
        subtitle="Bill a client for what a site cost"
        onBack={() => router.back()}
      />

      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        {active.length === 0 ? (
          <EmptyState
            title="No sites yet"
            message="An invoice bills for a site, so add the job you are running first."
            action={{
              label: 'Go to Sites',
              onPress: () => router.push('/(contractor)/dashboard/sites'),
            }}
          />
        ) : (
          <>
            {/* --- 1. what is being billed ------------------------------- */}
            <View style={styles.section}>
              <ThemedText type="smallBold" themeColor="textSecondary" style={styles.label}>
                SITE
              </ThemedText>
              <Card style={styles.picker}>
                {active.map((candidate, index) => {
                  const selected = candidate.id === siteId;
                  return (
                    <View key={candidate.id}>
                      {index > 0 ? (
                        <View style={[styles.divider, { backgroundColor: theme.border }]} />
                      ) : null}
                      <Pressable
                        accessibilityRole="button"
                        accessibilityState={{ selected }}
                        onPress={() => setSiteId(candidate.id)}
                        style={({ pressed }) => [styles.option, pressed && { opacity: 0.6 }]}>
                        <Ionicons
                          name={selected ? 'radio-button-on' : 'radio-button-off'}
                          size={18}
                          color={selected ? theme.tint : theme.textSecondary}
                        />
                        <View style={styles.optionBody}>
                          <ThemedText type="small" numberOfLines={1}>
                            {candidate.name}
                          </ThemedText>
                          {candidate.address ? (
                            <ThemedText type="small" themeColor="textSecondary" numberOfLines={1}>
                              {candidate.address}
                            </ThemedText>
                          ) : null}
                        </View>
                      </Pressable>
                    </View>
                  );
                })}
              </Card>
            </View>

            <View style={styles.section}>
              <ThemedText type="smallBold" themeColor="textSecondary" style={styles.label}>
                PERIOD
              </ThemedText>
              <Segmented options={RANGES} value={range} onChange={setRange} />
            </View>

            {/* --- 2. what it came to ------------------------------------ */}
            <View style={styles.section}>
              <ThemedText type="smallBold" themeColor="textSecondary" style={styles.label}>
                WHAT THIS SITE COST
              </ThemedText>

              {calculating ? (
                <Card style={styles.calculating}>
                  <ActivityIndicator color={theme.tint} />
                  <ThemedText type="small" themeColor="textSecondary">
                    Adding up {site?.name ?? 'the site'}…
                  </ThemedText>
                </Card>
              ) : preview === null ? (
                <Card>
                  <ThemedText type="small" themeColor="textSecondary">
                    Nothing to calculate yet.
                  </ThemedText>
                </Card>
              ) : (
                <Card style={styles.preview}>
                  <Line
                    label="Work done (piece rate)"
                    amount={preview.piece_rate_total}
                    tone={theme.text}
                  />
                  <Line
                    label="Materials and site costs"
                    amount={preview.materials_total}
                    tone={theme.text}
                  />
                  <Line
                    label="Plant and diesel"
                    amount={preview.machinery_total}
                    tone={theme.text}
                  />

                  <View style={[styles.divider, { backgroundColor: theme.border }]} />
                  <Line
                    label="Recorded cost"
                    amount={preview.suggested_total}
                    tone={theme.tint}
                    strong
                  />

                  <ThemedText type="small" themeColor="textSecondary">
                    Daily wages are not billed here — a day rate is what you pay your crew, not
                    what the client is charged for it.
                    {preview.machinery_total > 0 && preview.materials_total > 0
                      ? ' Check the two cost lines against each other: diesel logged against a machine may also sit in your expenses.'
                      : ''}
                    {preview.material_receipt_count > 0
                      ? ` ${preview.material_receipt_count} ${
                          preview.material_receipt_count === 1 ? 'delivery was' : 'deliveries were'
                        } accepted in this period; a challan records what arrived, never what it cost.`
                      : ''}
                  </ThemedText>

                  {preview.lines.length > 0 ? (
                    <>
                      <View style={[styles.divider, { backgroundColor: theme.border }]} />
                      {preview.lines.map((line, index) => (
                        <View key={`${line.kind}-${line.label}-${index}`} style={styles.lineRow}>
                          <View style={styles.lineBody}>
                            <ThemedText type="small" numberOfLines={1}>
                              {line.label}
                            </ThemedText>
                            <ThemedText type="small" themeColor="textSecondary" numberOfLines={1}>
                              {[
                                KIND_LABELS[line.kind],
                                line.quantity !== null
                                  ? `${line.quantity}${line.unit ? ` ${line.unit}` : ''}`
                                  : null,
                                line.rate !== null
                                  ? `@ ${CURRENCY}${formatMoney(line.rate)}`
                                  : null,
                              ]
                                .filter(Boolean)
                                .join(' · ')}
                            </ThemedText>
                          </View>
                          <ThemedText type="smallBold">
                            {CURRENCY}
                            {formatMoney(line.amount)}
                          </ThemedText>
                        </View>
                      ))}
                    </>
                  ) : null}
                </Card>
              )}
            </View>

            {/* --- 3. the bill ------------------------------------------- */}
            <View style={styles.section}>
              <ThemedText type="smallBold" themeColor="textSecondary" style={styles.label}>
                RAISE THE INVOICE
              </ThemedText>

              <Card style={styles.form}>
                <Field
                  label="Client"
                  value={clientName}
                  onChangeText={setClientName}
                  placeholder="Mehta Developers"
                  hint="Recorded as typed — a site changing hands must not rewrite old invoices."
                  maxLength={160}
                  autoCapitalize="words"
                  returnKeyType="next"
                />

                <Field
                  label="Amount to bill"
                  value={amount}
                  onChangeText={(next) => {
                    setTouchedAmount(true);
                    setAmount(next);
                  }}
                  keyboardType="decimal-pad"
                  placeholder="0"
                  hint={
                    differs
                      ? 'Your figure, not the calculated one. The PDF prints this as the amount due and labels the breakdown as the basis for it.'
                      : 'Seeded from the calculation above. Type over it to add markup, retention or a discount.'
                  }
                  returnKeyType="next"
                />

                <Field
                  label="Note (optional)"
                  value={note}
                  onChangeText={setNote}
                  placeholder="Includes 10% markup, retention held"
                  maxLength={255}
                  returnKeyType="done"
                />

                {!isOnline ? (
                  <ThemedText type="small" style={{ color: theme.warning }}>
                    You are offline. Raising an invoice is not queued — it needs a connection.
                  </ThemedText>
                ) : null}

                <Button
                  title={raising ? 'Raising…' : 'Raise invoice'}
                  loading={raising}
                  disabled={!isOnline || siteId === null}
                  onPress={() => void raise()}
                />
              </Card>
            </View>

            {message ? (
              <ThemedText type="small" style={{ color: theme.positive }}>
                {message}
              </ThemedText>
            ) : null}
            {error ? (
              <ThemedText type="small" style={{ color: theme.negative }}>
                {error}
              </ThemedText>
            ) : null}

            {/* --- what has already gone out ----------------------------- */}
            <View style={styles.section}>
              <ThemedText type="smallBold" themeColor="textSecondary" style={styles.label}>
                RAISED SO FAR
              </ThemedText>

              {loadingList ? (
                <ActivityIndicator color={theme.tint} style={styles.loading} />
              ) : invoices.length === 0 ? (
                <Card>
                  <ThemedText type="small" themeColor="textSecondary">
                    No invoices yet. The first one you raise shows up here, with a button to
                    export the PDF and send it.
                  </ThemedText>
                </Card>
              ) : (
                <Card style={styles.list}>
                  {invoices.map((invoice, index) => (
                    <View key={invoice.id}>
                      {index > 0 ? (
                        <View style={[styles.divider, { backgroundColor: theme.border }]} />
                      ) : null}
                      <Pressable
                        accessibilityRole="button"
                        accessibilityLabel={`Invoice ${invoice.id} for ${invoice.client_name}`}
                        onPress={() => void openActions(invoice)}
                        style={({ pressed }) => [styles.invoiceRow, pressed && { opacity: 0.6 }]}>
                        <View style={styles.invoiceBody}>
                          <ThemedText type="smallBold" numberOfLines={1}>
                            {invoice.client_name}
                          </ThemedText>
                          <ThemedText type="small" themeColor="textSecondary" numberOfLines={1}>
                            {[
                              `#${invoice.id}`,
                              invoice.site_name,
                              formatRelativeDate(invoice.created_at.slice(0, 10)),
                            ]
                              .filter(Boolean)
                              .join(' · ')}
                          </ThemedText>
                        </View>

                        <View style={styles.invoiceRight}>
                          <ThemedText type="smallBold">
                            {CURRENCY}
                            {formatMoney(invoice.total_amount)}
                          </ThemedText>
                          <Badge
                            label={STATUS_LABELS[invoice.status]}
                            color={statusTone[invoice.status]}
                          />
                        </View>

                        {busy === invoice.id ? (
                          <ActivityIndicator color={theme.tint} />
                        ) : (
                          <Ionicons
                            name="ellipsis-horizontal"
                            size={18}
                            color={theme.textSecondary}
                          />
                        )}
                      </Pressable>
                    </View>
                  ))}
                </Card>
              )}

              <ThemedText type="small" themeColor="textSecondary">
                Signed in as {user?.name ?? 'you'}. Tap an invoice to export its PDF or move it
                along.
              </ThemedText>
            </View>
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

function Line({
  label,
  amount,
  tone,
  strong = false,
}: {
  label: string;
  amount: number;
  tone: string;
  strong?: boolean;
}) {
  return (
    <View style={styles.summaryRow}>
      <ThemedText type={strong ? 'smallBold' : 'small'} themeColor="textSecondary">
        {label}
      </ThemedText>
      <ThemedText type={strong ? 'smallBold' : 'small'} style={{ color: tone }}>
        {CURRENCY}
        {formatMoney(amount)}
      </ThemedText>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
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
  label: {
    letterSpacing: 0.5,
  },
  picker: {
    padding: 0,
    paddingHorizontal: Spacing.three,
  },
  option: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two + 2,
    paddingVertical: Spacing.two + 2,
  },
  optionBody: {
    flex: 1,
    gap: 1,
  },
  calculating: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
  },
  preview: {
    gap: Spacing.two,
  },
  summaryRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.two,
  },
  lineRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.two,
    paddingVertical: Spacing.one,
  },
  lineBody: {
    flex: 1,
    gap: 1,
  },
  form: {
    gap: Spacing.three,
  },
  loading: {
    paddingVertical: Spacing.four,
  },
  list: {
    padding: 0,
    paddingHorizontal: Spacing.three,
  },
  invoiceRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
    paddingVertical: Spacing.two + 2,
  },
  invoiceBody: {
    flex: 1,
    gap: 1,
  },
  invoiceRight: {
    alignItems: 'flex-end',
    gap: Spacing.half,
  },
  divider: {
    height: StyleSheet.hairlineWidth,
  },
});
