import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ScreenHeader } from '@/components/screen-header';
import { ThemedText } from '@/components/themed-text';
import { Card, Segmented } from '@/components/ui-kit';
import { MaxContentWidth, Radius, Spacing } from '@/constants/theme';
import { useAuth } from '@/auth/auth-context';
import { useTheme } from '@/hooks/use-theme';
import { formatDate, toISODate } from '@/lib/money';
import { downloadReport, reportFilename, type ReportFormat } from '@/lib/reports';

type Range = 'month' | 'quarter' | 'all';

const RANGES: { value: Range; label: string }[] = [
  { value: 'month', label: 'This month' },
  { value: 'quarter', label: 'Last 90 days' },
  { value: 'all', label: 'All time' },
];

/**
 * How far back the monthly export offers to go.
 *
 * Twelve, because the reason to reach for last March is that the accountant
 * asked for it, and a picker that stops at six months sends the contractor to
 * a support call instead.
 */
const MONTHS_BACK = 12;

type ReportKind = {
  id: string;
  title: string;
  description: string;
  icon: keyof typeof Ionicons.glyphMap;
  path: string;
  format: ReportFormat;
  slug: string;
};

const REPORTS: ReportKind[] = [
  {
    id: 'business-pdf',
    title: 'Business report (PDF)',
    description: 'Cash in, cash out, the crew and every expense - ready to print or send.',
    icon: 'document-text-outline',
    path: '/api/reports/business/pdf',
    format: 'pdf',
    slug: 'report',
  },
  {
    id: 'transactions-csv',
    title: 'Transaction history (CSV)',
    description: 'Every wage, advance and settlement, one row each, for a spreadsheet.',
    icon: 'grid-outline',
    path: '/api/reports/transactions/csv',
    format: 'csv',
    slug: 'transactions',
  },
  {
    id: 'attendance-csv',
    title: 'Worker attendance (CSV)',
    description: 'Every mark with a days-worked column, so day counts add up on their own.',
    icon: 'calendar-outline',
    path: '/api/reports/attendance/csv',
    format: 'csv',
    slug: 'attendance',
  },
  {
    id: 'expenses-csv',
    title: 'Expenses and receipts (CSV)',
    description: 'Materials, fuel, rentals and the advances that paid for them.',
    icon: 'receipt-outline',
    path: '/api/reports/cash-entries/csv',
    format: 'csv',
    slug: 'expenses',
  },
];

/**
 * Generate and share the reports.
 *
 * Each one is fetched with the session token, verified, and handed to the
 * native share sheet - so a contractor can send an accountant a CSV over
 * WhatsApp without the file ever touching a browser.
 *
 * TWO CONTROLS, BECAUSE THERE ARE TWO KINDS OF PERIOD
 * ---------------------------------------------------
 * The four reports above take a window — any start and any end — and share
 * one range picker. The monthly accounting export takes a MONTH, because that
 * is the unit an accountant closes the books in, and `GET
 * /api/reports/monthly-report` accepts nothing else. Feeding it the range
 * picker would mean inventing a month from two arbitrary dates and getting it
 * wrong at every boundary, so it carries its own picker.
 */
export default function ReportsScreen() {
  const theme = useTheme();
  const router = useRouter();
  const { token, user } = useAuth();

  const [range, setRange] = useState<Range>('month');
  const [month, setMonth] = useState(() => toMonth(new Date()));
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  /**
   * The last twelve months, newest first.
   *
   * Built by walking back a month at a time from the first of THIS month
   * rather than by subtracting from today: stepping back from the 31st lands
   * on the wrong month whenever the previous one is shorter.
   */
  const months = useMemo(() => {
    const cursor = new Date();
    cursor.setDate(1);
    return Array.from({ length: MONTHS_BACK }, () => {
      const value = toMonth(cursor);
      const label = cursor.toLocaleDateString(undefined, {
        month: 'short',
        year: 'numeric',
      });
      cursor.setMonth(cursor.getMonth() - 1);
      return { value, label };
    });
  }, []);

  const window = useMemo(() => {
    const today = new Date();
    if (range === 'all') return { start: null as string | null, end: toISODate(today) };
    const start = new Date(today);
    if (range === 'month') start.setDate(1);
    else start.setDate(start.getDate() - 89);
    return { start: toISODate(start), end: toISODate(today) };
  }, [range]);

  async function run(report: ReportKind) {
    setError(null);
    setMessage(null);
    setBusy(report.id);

    try {
      const outcome = await downloadReport({
        token: token ?? '',
        path: report.path,
        params: { start_date: window.start, end_date: window.end },
        filename: reportFilename(user?.name ?? 'moneymate', report.slug, report.format),
        format: report.format,
        title: report.title,
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

  /**
   * The whole month in one sheet, for the accountant.
   *
   * One file rather than a zip of three: this goes over WhatsApp, and a zip on
   * a phone is a support call. The server writes transactions, attendance and
   * petty cash as three labelled blocks in a single CSV, which opens in Excel
   * on a tap.
   */
  async function exportMonthly() {
    setError(null);
    setMessage(null);
    setBusy('monthly');

    try {
      const outcome = await downloadReport({
        token: token ?? '',
        path: '/api/reports/monthly-report',
        params: { month },
        filename: reportFilename(user?.name ?? 'moneymate', `accounts-${month}`, 'csv'),
        format: 'csv',
        title: `Accounts for ${monthLabel}`,
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

  const monthLabel = months.find((option) => option.value === month)?.label ?? month;

  return (
    <SafeAreaView style={[styles.screen, { backgroundColor: theme.background }]}>
      <ScreenHeader title="Reports" onBack={() => router.back()} />

      <ScrollView contentContainerStyle={styles.content}>
        <ThemedText type="smallBold" themeColor="textSecondary" style={styles.label}>
          PERIOD
        </ThemedText>

        <Segmented options={RANGES} value={range} onChange={setRange} />

        <ThemedText type="small" themeColor="textSecondary">
          {window.start
            ? `${formatDate(window.start)} to ${formatDate(window.end)}`
            : `Everything up to ${formatDate(window.end)}`}
        </ThemedText>

        {REPORTS.map((report) => (
          <Pressable
            key={report.id}
            accessibilityRole="button"
            accessibilityState={{ busy: busy === report.id, disabled: busy !== null }}
            disabled={busy !== null}
            onPress={() => void run(report)}
            style={({ pressed }) => (pressed ? { opacity: 0.7 } : null)}>
            <Card style={styles.row}>
              <View style={[styles.icon, { backgroundColor: `${theme.tint}1A` }]}>
                <Ionicons name={report.icon} size={20} color={theme.tint} />
              </View>
              <View style={styles.body}>
                <ThemedText type="smallBold">{report.title}</ThemedText>
                <ThemedText type="small" themeColor="textSecondary">
                  {report.description}
                </ThemedText>
              </View>
              <Ionicons
                name={busy === report.id ? 'hourglass-outline' : 'share-outline'}
                size={20}
                color={theme.textSecondary}
              />
            </Card>
          </Pressable>
        ))}

        <View style={[styles.rule, { backgroundColor: theme.border }]} />

        <ThemedText type="smallBold" themeColor="textSecondary" style={styles.label}>
          MONTHLY ACCOUNTING EXPORT
        </ThemedText>

        <ThemedText type="small" themeColor="textSecondary">
          Closed by the month rather than by a date range, which is how an
          accountant asks for it.
        </ThemedText>

        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.months}>
          {months.map((option) => {
            const selected = option.value === month;
            return (
              <Pressable
                key={option.value}
                accessibilityRole="button"
                accessibilityState={{ selected }}
                onPress={() => setMonth(option.value)}
                style={({ pressed }) => [
                  styles.chip,
                  {
                    backgroundColor: selected ? theme.tint : theme.backgroundElement,
                    borderColor: selected ? theme.tint : theme.border,
                    opacity: pressed ? 0.7 : 1,
                  },
                ]}>
                <ThemedText
                  type="smallBold"
                  style={{ color: selected ? theme.onTint : theme.textSecondary }}
                  numberOfLines={1}>
                  {option.label}
                </ThemedText>
              </Pressable>
            );
          })}
        </ScrollView>

        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Export the accounts for ${monthLabel} to Excel`}
          accessibilityState={{ busy: busy === 'monthly', disabled: busy !== null }}
          disabled={busy !== null}
          onPress={() => void exportMonthly()}
          style={({ pressed }) => (pressed ? { opacity: 0.7 } : null)}>
          <Card style={styles.row}>
            <View style={[styles.icon, { backgroundColor: `${theme.positive}1A` }]}>
              <Ionicons name="albums-outline" size={20} color={theme.positive} />
            </View>
            <View style={styles.body}>
              <ThemedText type="smallBold">Export to Excel — {monthLabel}</ThemedText>
              <ThemedText type="small" themeColor="textSecondary">
                Every transaction, attendance mark and petty cash entry for the month, as one
                sheet to save or send your accountant.
              </ThemedText>
            </View>
            <Ionicons
              name={busy === 'monthly' ? 'hourglass-outline' : 'share-outline'}
              size={20}
              color={theme.textSecondary}
            />
          </Card>
        </Pressable>

        {error ? (
          <ThemedText type="small" style={{ color: theme.negative }}>
            {error}
          </ThemedText>
        ) : null}
        {message ? (
          <ThemedText type="small" themeColor="textSecondary">
            {message}
          </ThemedText>
        ) : null}

        <ThemedText type="small" themeColor="textSecondary" style={styles.footnote}>
          Reports are generated on the server from live data, so they need a connection. CSV
          files open in Excel or Google Sheets.
        </ThemedText>
      </ScrollView>
    </SafeAreaView>
  );
}

/**
 * A Date as the "YYYY-MM" the API wants.
 *
 * Built from the local calendar fields rather than by slicing an ISO string:
 * `toISOString()` is UTC, so anywhere east of Greenwich the first of the month
 * would export the previous one for most of the day.
 */
function toMonth(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
  },
  content: {
    gap: Spacing.three,
    paddingHorizontal: Spacing.three,
    paddingBottom: Spacing.five,
    maxWidth: MaxContentWidth,
    width: '100%',
    alignSelf: 'center',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
  },
  icon: {
    width: 40,
    height: 40,
    borderRadius: Radius.medium,
    alignItems: 'center',
    justifyContent: 'center',
  },
  body: {
    flex: 1,
    gap: 1,
  },
  label: {
    letterSpacing: 0.5,
  },
  rule: {
    height: StyleSheet.hairlineWidth,
    marginTop: Spacing.two,
  },
  months: {
    gap: Spacing.two,
    paddingRight: Spacing.three,
  },
  chip: {
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
    borderRadius: 999,
    borderWidth: StyleSheet.hairlineWidth,
  },
  footnote: {
    textAlign: 'center',
  },
});
