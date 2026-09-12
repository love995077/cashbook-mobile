import { useLocalSearchParams } from 'expo-router';
import { useMemo, useState } from 'react';
import { RefreshControl, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { BarChart, type ChartSeries } from '@/components/bar-chart';
import { ErrorState, LoadingState } from '@/components/load-state';
import { ScreenHeader } from '@/components/screen-header';
import { ThemedText } from '@/components/themed-text';
import { Card, EmptyState, Segmented } from '@/components/ui-kit';
import { BottomTabInset, MaxContentWidth, Radius, Spacing } from '@/constants/theme';
import { useAnalytics } from '@/data/use-analytics';
import type { AnalyticsPeriod } from '@/data/types';
import { useTheme } from '@/hooks/use-theme';
import { CURRENCY, formatDate, formatMoney } from '@/lib/money';

const PERIODS: { value: AnalyticsPeriod; label: string }[] = [
  { value: 'day', label: 'Day' },
  { value: 'week', label: 'Week' },
  { value: 'month', label: 'Month' },
];

/**
 * Analytics: what goes out against what comes in, over time.
 *
 * Money out is split into two bars - wages actually paid and everything bought
 * for the site - because they are different problems. A month where wages are
 * flat but materials doubled reads very differently from the reverse, and one
 * combined bar would hide it.
 *
 * `?focus=in|out` is set by the two summary cards on Home. It marks the rows
 * in PERIOD TOTALS that make up the card that was tapped, so arriving here
 * from a number lands on that number rather than on a wall of them. It only
 * highlights - the data is identical either way, so a stale or missing param
 * costs nothing.
 */
export default function AnalyticsScreen() {
  const theme = useTheme();
  const params = useLocalSearchParams<{ focus?: string }>();
  const focus = params.focus === 'in' || params.focus === 'out' ? params.focus : null;
  const [period, setPeriod] = useState<AnalyticsPeriod>('week');
  const [selected, setSelected] = useState<number | null>(null);
  const { series, loading, refreshing, error, isStale, refresh } = useAnalytics(period);

  // Memoised so the chart below does not rebuild on every render: the
  // `?? []` would otherwise be a new array each time.
  const buckets = useMemo(() => series?.buckets ?? [], [series]);

  const chart = useMemo<ChartSeries[]>(
    () => [
      {
        key: 'wages',
        label: 'Wages paid',
        color: theme.negative,
        values: buckets.map((bucket) => bucket.wages_paid),
      },
      {
        key: 'expenses',
        label: 'Materials and expenses',
        color: theme.warning,
        values: buckets.map((bucket) => bucket.expenses_paid),
      },
      {
        key: 'in',
        label: 'Site advances in',
        color: theme.positive,
        values: buckets.map((bucket) => bucket.cash_in),
      },
    ],
    [buckets, theme]
  );

  const detail = selected != null ? buckets[selected] : undefined;

  if (loading && !series) {
    return (
      <SafeAreaView style={[styles.screen, { backgroundColor: theme.background }]} edges={['top']}>
        <ScreenHeader title="Analytics" />
        <LoadingState label="Crunching your numbers..." />
      </SafeAreaView>
    );
  }

  if (error && !series) {
    return (
      <SafeAreaView style={[styles.screen, { backgroundColor: theme.background }]} edges={['top']}>
        <ScreenHeader title="Analytics" />
        <ErrorState message={error} onRetry={refresh} />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={[styles.screen, { backgroundColor: theme.background }]} edges={['top']}>
      <ScreenHeader
        title="Analytics"
        subtitle={
          series ? `${formatDate(series.start_date)} to ${formatDate(series.end_date)}` : undefined
        }
      />

      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor={theme.tint} />
        }>
        <Segmented
          options={PERIODS}
          value={period}
          onChange={(next) => {
            setSelected(null);
            setPeriod(next);
          }}
        />

        {isStale ? (
          <ThemedText type="small" style={{ color: theme.warning }}>
            Offline - showing the last chart that loaded.
          </ThemedText>
        ) : null}

        <Card style={styles.chartCard}>
          <BarChart
            labels={buckets.map((bucket) => bucket.label)}
            series={chart}
            selectedIndex={selected}
            onSelect={(index) => setSelected((current) => (current === index ? null : index))}
            emptyMessage="No spending or advances recorded in this period yet."
          />

          {detail ? (
            <View style={[styles.detail, { borderTopColor: theme.border }]}>
              <ThemedText type="smallBold">
                {formatDate(detail.start_date)}
                {detail.end_date !== detail.start_date ? ` to ${formatDate(detail.end_date)}` : ''}
              </ThemedText>
              <DetailRow label="Wages paid" amount={detail.wages_paid} tone={theme.negative} />
              <DetailRow
                label="Materials and expenses"
                amount={detail.expenses_paid}
                tone={theme.warning}
              />
              <DetailRow label="Site advances in" amount={detail.cash_in} tone={theme.positive} />
              <DetailRow
                label="Net for the period"
                amount={detail.cash_in - detail.total_out}
                tone={detail.cash_in - detail.total_out >= 0 ? theme.positive : theme.negative}
                strong
              />
            </View>
          ) : (
            <ThemedText type="small" themeColor="textSecondary" style={styles.hint}>
              Tap a bar to see that {period} in full.
            </ThemedText>
          )}
        </Card>

        <View style={styles.section}>
          <ThemedText type="smallBold" themeColor="textSecondary" style={styles.sectionLabel}>
            PERIOD TOTALS
          </ThemedText>
          <Card style={styles.totals}>
            <DetailRow
              label="Cash in"
              amount={series?.totals.cash_in ?? 0}
              tone={theme.positive}
              highlight={focus === 'in'}
            />
            <DetailRow
              label="Wages paid"
              amount={series?.totals.wages_paid ?? 0}
              tone={theme.negative}
              highlight={focus === 'out'}
            />
            <DetailRow
              label="Materials and expenses"
              amount={series?.totals.expenses_paid ?? 0}
              tone={theme.warning}
              highlight={focus === 'out'}
            />
            <View style={[styles.divider, { backgroundColor: theme.border }]} />
            <DetailRow
              label="Balance"
              amount={series?.totals.balance ?? 0}
              tone={(series?.totals.balance ?? 0) >= 0 ? theme.positive : theme.negative}
              strong
            />
          </Card>
        </View>

        <View style={styles.section}>
          <ThemedText type="smallBold" themeColor="textSecondary" style={styles.sectionLabel}>
            WHERE IT WENT
          </ThemedText>
          <Card style={styles.totals}>
            {series && series.by_category.length > 0 ? (
              series.by_category.map((item) => (
                <CategoryBar
                  key={`${item.category_id ?? 'none'}-${item.name}`}
                  name={item.name}
                  total={item.total}
                  share={
                    item.total /
                    Math.max(
                      ...series.by_category.map((candidate) => candidate.total),
                      1
                    )
                  }
                  color={
                    item.color ?? (item.direction === 'in' ? theme.positive : theme.negative)
                  }
                />
              ))
            ) : (
              <EmptyState
                title="No categorised entries"
                message="Log an expense from Home and it will show up here, broken down by category."
              />
            )}
          </Card>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

function DetailRow({
  label,
  amount,
  tone,
  strong = false,
  highlight = false,
}: {
  label: string;
  amount: number;
  tone: string;
  strong?: boolean;
  /** Tints the row when it is what the caller came here to look at. */
  highlight?: boolean;
}) {
  return (
    <View
      style={[
        styles.detailRow,
        highlight && [styles.highlighted, { backgroundColor: `${tone}14` }],
      ]}>
      <ThemedText type={strong || highlight ? 'smallBold' : 'small'} themeColor="textSecondary">
        {label}
      </ThemedText>
      <ThemedText type="smallBold" style={{ color: tone }}>
        {amount < 0 ? '-' : ''}
        {CURRENCY}
        {formatMoney(Math.abs(amount))}
      </ThemedText>
    </View>
  );
}

/** A labelled amount with a proportional bar behind it. */
function CategoryBar({
  name,
  total,
  share,
  color,
}: {
  name: string;
  total: number;
  share: number;
  color: string;
}) {
  return (
    <View style={styles.categoryRow}>
      <View style={styles.detailRow}>
        <ThemedText type="small" numberOfLines={1}>
          {name}
        </ThemedText>
        <ThemedText type="smallBold" style={{ color }}>
          {CURRENCY}
          {formatMoney(total)}
        </ThemedText>
      </View>
      <View style={[styles.track, { backgroundColor: `${color}22` }]}>
        <View
          style={[
            styles.fill,
            { backgroundColor: color, width: `${Math.max(2, Math.round(share * 100))}%` },
          ]}
        />
      </View>
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
    paddingBottom: BottomTabInset + Spacing.five,
    maxWidth: MaxContentWidth,
    width: '100%',
    alignSelf: 'center',
  },
  chartCard: {
    gap: Spacing.three,
  },
  detail: {
    gap: Spacing.one,
    paddingTop: Spacing.three,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  detailRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.three,
  },
  highlighted: {
    // Negative margin so the tint bleeds to the card's padding edge rather
    // than floating as a narrower stripe inside it.
    marginHorizontal: -Spacing.two,
    paddingHorizontal: Spacing.two,
    paddingVertical: Spacing.one,
    borderRadius: Radius.small,
  },
  hint: {
    textAlign: 'center',
  },
  section: {
    gap: Spacing.two,
  },
  sectionLabel: {
    letterSpacing: 0.5,
  },
  totals: {
    gap: Spacing.two,
  },
  divider: {
    height: StyleSheet.hairlineWidth,
    marginVertical: Spacing.one,
  },
  categoryRow: {
    gap: Spacing.one,
  },
  track: {
    height: 6,
    borderRadius: Radius.small,
    overflow: 'hidden',
  },
  fill: {
    height: 6,
    borderRadius: Radius.small,
  },
});
