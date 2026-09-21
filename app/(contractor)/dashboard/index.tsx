import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { Pressable, RefreshControl, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { CashEntryRow } from '@/components/cash-entry-row';
import { Fab } from '@/components/fab';
import { ErrorState, LoadingState } from '@/components/load-state';
import { ScreenHeader } from '@/components/screen-header';
import { useGreeting } from '@/i18n/language-context';
import { StatCard } from '@/components/stat-card';
import { SupervisorHome } from '@/components/supervisor-home';
import { SyncBanner } from '@/components/sync-banner';
import { ThemedText } from '@/components/themed-text';
import { Card, EmptyState } from '@/components/ui-kit';
import { VoiceEntryButton } from '@/components/voice-entry-button';
import { BottomTabInset, MaxContentWidth, Radius, Spacing } from '@/constants/theme';
import { useAuth } from '@/auth/auth-context';
import { useStore } from '@/data/store';
import { isAdmin } from '@/data/types';
import { useTheme } from '@/hooks/use-theme';
import { CURRENCY, formatMoney } from '@/lib/money';

/**
 * Home: what came in, what went out, and what is left.
 *
 * The three cards are the cash box, not the crew ledger. Money owed to workers
 * is deliberately kept out of the balance - it has not been paid yet, so
 * subtracting it would misstate the cash actually in hand. It gets its own
 * line under the cards instead.
 *
 * ADMINS ONLY. A supervisor lands on this same route and gets
 * `SupervisorHome` instead — see the switch at the top of the component and
 * the note in the tabs layout. Every figure below comes from `GET
 * /contractor/summary`, which the API refuses them anyway.
 */
export default function HomeScreen() {
  const { user } = useAuth();

  // Before anything else, and before any hook that reads the cash box: a
  // supervisor has no cash box, and the store never loaded one for them.
  if (!isAdmin(user?.role)) return <SupervisorHome />;

  return <AdminHome />;
}

function AdminHome() {
  const theme = useTheme();
  const router = useRouter();
  const greeting = useGreeting();
  // Just the count for the header badge. Fetched here rather than held in the
  // store because Home is the only screen that shows it, and it is one small
  // request against a list that is almost always empty.
  const [pendingCount, setPendingCount] = useState(0);
  const { user } = useAuth();
  const {
    summary,
    cashEntries,
    workers,
    sites,
    outstandingTools,
    loading,
    refreshing,
    error,
    refresh,
    getAdvanceRequests,
  } = useStore();

  useEffect(() => {
    const controller = new AbortController();
    void (async () => {
      try {
        const rows = await getAdvanceRequests({ status: 'pending' }, controller.signal);
        if (!controller.signal.aborted) setPendingCount(rows.length);
      } catch {
        // A badge is not worth an error banner over.
      }
    })();
    return () => controller.abort();
  }, [getAdvanceRequests]);

  const recent = useMemo(() => cashEntries.slice(0, 6), [cashEntries]);
  const hasData = summary !== null || workers.length > 0;
  const balance = summary?.balance ?? 0;
  const crewSize = summary?.worker_count ?? workers.length;

  if (loading && !hasData) {
    return (
      <SafeAreaView style={[styles.screen, { backgroundColor: theme.background }]} edges={['top']}>
        <ScreenHeader title="Home" />
        <LoadingState label="Loading your books..." />
      </SafeAreaView>
    );
  }

  if (error && !hasData) {
    return (
      <SafeAreaView style={[styles.screen, { backgroundColor: theme.background }]} edges={['top']}>
        <ScreenHeader title="Home" />
        <ErrorState message={error} onRetry={refresh} />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={[styles.screen, { backgroundColor: theme.background }]} edges={['top']}>
      <ScreenHeader
        title="Home"
        greeting={{ name: user?.name ?? 'there', salutation: greeting }}
        action={{ label: 'Reports', onPress: () => router.push('/(contractor)/reports') }}
        icons={[
          {
            name: 'qr-code-outline',
            accessibilityLabel: 'Scan a worker ID',
            onPress: () => router.push('/(contractor)/scan'),
          },
          {
            name: 'cash-outline',
            accessibilityLabel: pendingCount
              ? `${pendingCount} advance requests waiting`
              : 'Advance requests',
            badge: pendingCount,
            onPress: () => router.push('/(contractor)/approvals'),
          },
          {
            name: 'settings-outline',
            accessibilityLabel: 'Settings',
            onPress: () => router.push('/(contractor)/dashboard/settings'),
          },
        ]}
      />

      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor={theme.tint} />
        }>
        <SyncBanner />

        <StatCard
          label="Current balance"
          amount={balance}
          icon="wallet-outline"
          tone={balance >= 0 ? theme.tint : theme.negative}
          caption={
            balance >= 0
              ? 'Cash received, less everything paid out.'
              : 'You have paid out more than you have received.'
          }
          emphasis
        />

        {/* Both cards open the same screen, focused differently. Analytics is
            where these two figures are already broken down — by period, and by
            category — so a tap on a number goes to what the number is made of
            rather than to a form that would create another one. The entry
            points stay in the quick-action strip below, where a tap that
            starts writing is expected. */}
        <View style={styles.pair}>
          <StatCard
            label="Cash in"
            amount={summary?.cash_in ?? 0}
            icon="arrow-down-circle-outline"
            tone={theme.positive}
            caption="Site advances and client payments."
            accessibilityHint="Opens the analytics breakdown of money received"
            onPress={() =>
              router.push({
                pathname: '/(contractor)/dashboard/analytics',
                params: { focus: 'in' },
              })
            }
          />
          <StatCard
            label="Wages / materials paid"
            amount={summary?.total_out ?? 0}
            icon="arrow-up-circle-outline"
            tone={theme.negative}
            caption={`${CURRENCY}${formatMoney(
              summary?.wages_paid ?? 0
            )} to workers, ${CURRENCY}${formatMoney(summary?.expenses_paid ?? 0)} on materials and other costs.`}
            accessibilityHint="Opens the analytics breakdown of money paid out"
            onPress={() =>
              router.push({
                pathname: '/(contractor)/dashboard/analytics',
                params: { focus: 'out' },
              })
            }
          />
        </View>

        <Card style={styles.owed}>
          <View style={styles.owedRow}>
            <ThemedText type="small" themeColor="textSecondary">
              Still owed to the crew
            </ThemedText>
            <ThemedText type="smallBold" style={{ color: theme.warning }}>
              {CURRENCY}
              {formatMoney(summary?.outstanding_payable ?? 0)}
            </ThemedText>
          </View>
          <ThemedText type="small" themeColor="textSecondary">
            Wages earned but not yet paid, across {crewSize}{' '}
            {crewSize === 1 ? 'worker' : 'workers'}. Not part of the balance above.
          </ThemedText>
        </Card>

        {error ? (
          <ThemedText type="small" style={{ color: theme.negative }}>
            {error}
          </ThemedText>
        ) : null}

        {/* End-of-shift tool warning.
            Shown only when something has been out since BEFORE today. A drill
            taken out this morning is not a problem, and a badge that lights up
            every working day is a badge nobody reads. */}
        {outstandingTools && outstandingTools.overdue_count > 0 ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`${outstandingTools.overdue_count} tools not returned`}
            onPress={() => {
              const first = outstandingTools.assignments.find((row) => row.site_id != null);
              const siteId = first?.site_id ?? sites[0]?.id;
              if (siteId != null) {
                router.push({
                  pathname: '/(contractor)/tools',
                  params: { siteId: String(siteId) },
                });
              }
            }}
            style={({ pressed }) => [
              styles.toolWarning,
              {
                backgroundColor: `${theme.warning}1A`,
                borderColor: theme.warning,
                opacity: pressed ? 0.7 : 1,
              },
            ]}>
            <Ionicons name="construct-outline" size={20} color={theme.warning} />
            <View style={styles.toolWarningBody}>
              <ThemedText type="smallBold" style={{ color: theme.warning }}>
                {outstandingTools.overdue_count}{' '}
                {outstandingTools.overdue_count === 1 ? 'tool has' : 'tools have'} not come back
              </ThemedText>
              <ThemedText type="small" themeColor="textSecondary" numberOfLines={1}>
                {outstandingTools.assignments
                  .slice(0, 2)
                  .map((row) => `${row.tool_name} · ${row.worker_name}`)
                  .join(', ')}
                {outstandingTools.assignments.length > 2
                  ? ` and ${outstandingTools.assignments.length - 2} more`
                  : ''}
              </ThemedText>
            </View>
          </Pressable>
        ) : null}

        <View style={styles.actions}>
          <QuickAction
            icon="calendar-outline"
            label="Attendance"
            onPress={() => router.push('/(contractor)/dashboard/attendance')}
          />
          <QuickAction
            icon="cash-outline"
            label="Advance"
            onPress={() => router.push('/(contractor)/new-entry')}
          />
          <QuickAction
            icon="receipt-outline"
            label="Expense"
            onPress={() => router.push('/(contractor)/new-expense')}
          />
          <QuickAction
            icon="bar-chart-outline"
            label="Analytics"
            onPress={() => router.push('/(contractor)/dashboard/analytics')}
          />
        </View>

        <VoiceEntryButton />

        <View style={styles.section}>
          <View style={styles.sectionHead}>
            <ThemedText type="smallBold" themeColor="textSecondary" style={styles.sectionLabel}>
              RECENT EXPENSES
            </ThemedText>
            {cashEntries.length > recent.length ? (
              <Pressable
                accessibilityRole="button"
                onPress={() => router.push('/(contractor)/dashboard/analytics')}>
                <ThemedText type="small" style={{ color: theme.tint }}>
                  See all
                </ThemedText>
              </Pressable>
            ) : null}
          </View>

          <Card style={styles.list}>
            {recent.length === 0 ? (
              <EmptyState
                title="Nothing logged yet"
                message="Tap the + button to record fuel, transport, materials or a site advance."
              />
            ) : (
              recent.map((entry, index) => (
                <View key={entry.id}>
                  {index > 0 ? (
                    <View style={[styles.separator, { backgroundColor: theme.border }]} />
                  ) : null}
                  <CashEntryRow entry={entry} />
                </View>
              ))
            )}
          </Card>
        </View>
      </ScrollView>

      <Fab onPress={() => router.push('/(contractor)/new-expense')} label="Add an expense" />
    </SafeAreaView>
  );
}

/** One tile in the quick-action strip under the cards. */
function QuickAction({
  icon,
  label,
  onPress,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  onPress: () => void;
}) {
  const theme = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => [
        styles.action,
        {
          backgroundColor: theme.backgroundElement,
          borderColor: theme.border,
          opacity: pressed ? 0.7 : 1,
        },
      ]}>
      <Ionicons name={icon} size={20} color={theme.tint} />
      <ThemedText type="small" numberOfLines={1}>
        {label}
      </ThemedText>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
  },
  content: {
    gap: Spacing.three,
    paddingHorizontal: Spacing.three,
    paddingBottom: BottomTabInset + Spacing.six,
    maxWidth: MaxContentWidth,
    width: '100%',
    alignSelf: 'center',
  },
  pair: {
    flexDirection: 'row',
    gap: Spacing.three,
  },
  owed: {
    gap: Spacing.one,
    paddingVertical: Spacing.two + 2,
  },
  owedRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  toolWarning: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
    padding: Spacing.three,
    borderRadius: Radius.medium,
    borderWidth: StyleSheet.hairlineWidth,
  },
  toolWarningBody: {
    flex: 1,
    gap: 1,
  },
  actions: {
    flexDirection: 'row',
    gap: Spacing.two,
  },
  action: {
    flex: 1,
    alignItems: 'center',
    gap: Spacing.one,
    paddingVertical: Spacing.three,
    paddingHorizontal: Spacing.one,
    borderRadius: Radius.medium,
    borderWidth: StyleSheet.hairlineWidth,
  },
  section: {
    gap: Spacing.two,
  },
  sectionHead: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  sectionLabel: {
    letterSpacing: 0.5,
  },
  list: {
    padding: 0,
    paddingVertical: Spacing.one,
    overflow: 'hidden',
  },
  separator: {
    height: StyleSheet.hairlineWidth,
    marginLeft: Spacing.three + 40 + Spacing.three,
  },
});
