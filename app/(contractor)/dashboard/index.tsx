import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { Pressable, RefreshControl, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { AddSiteForm } from '@/components/add-site-form';
import { ErrorState, LoadingState } from '@/components/load-state';
import { ScreenHeader } from '@/components/screen-header';
import { SiteCard } from '@/components/site-card';
import { SupervisorHome } from '@/components/supervisor-home';
import { SyncBanner } from '@/components/sync-banner';
import { ThemedText } from '@/components/themed-text';
import { EmptyState } from '@/components/ui-kit';
import { BottomTabInset, MaxContentWidth, Radius, Spacing } from '@/constants/theme';
import { useAuth } from '@/auth/auth-context';
import { useStore } from '@/data/store';
import { isAdmin } from '@/data/types';
import { useGreeting } from '@/i18n/language-context';
import { useTheme } from '@/hooks/use-theme';
import { formatDate, toISODate } from '@/lib/money';

/**
 * Home: pick a site.
 *
 * SITE-FIRST
 * ----------
 * A contractor runs jobs, and nearly every question they open the app with
 * is about one of them: is today's crew there, what do I owe the people on
 * it, what has it cost. So Home is the list of sites and nothing else. Each
 * card carries those three answers (see `SiteCard`); tapping one opens the
 * site, where its labour, its expenses and its reports are that site's alone.
 *
 * The business-wide cash box - everything in, everything out, across every
 * site - moved to the Analytics tab, where its breakdown already lived.
 *
 * ADMINS ONLY. A supervisor lands on this same route and gets
 * `SupervisorHome`, which is their own site(s) and no money: the cards here
 * carry what each site owes and costs, and `GET /contractor/sites/overview`
 * refuses a supervisor anyway.
 */
export default function HomeScreen() {
  const { user } = useAuth();

  // Before anything else, and before any hook that reads money: a supervisor
  // has no cash box, and the store never loaded one for them.
  if (!isAdmin(user?.role)) return <SupervisorHome />;

  return <SitesHome />;
}

function SitesHome() {
  const theme = useTheme();
  const router = useRouter();
  const greeting = useGreeting();
  const { user } = useAuth();
  const {
    sites,
    siteOverviews,
    workers,
    outstandingTools,
    loading,
    refreshing,
    error,
    refresh,
    getAdvanceRequests,
  } = useStore();

  // Just the count for the header badge, fetched here rather than held in
  // the store: Home is the only screen that shows it.
  const [pendingCount, setPendingCount] = useState(0);
  const [adding, setAdding] = useState(false);
  const [showClosed, setShowClosed] = useState(false);
  const [today] = useState(() => toISODate(new Date()));

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

  const overviewFor = useMemo(
    () => new Map(siteOverviews.map((row) => [row.site_id, row])),
    [siteOverviews]
  );
  const open = sites.filter((site) => site.is_active);
  const closed = sites.filter((site) => !site.is_active);

  // One line across every open site, so the day's state reads before any card.
  const crewTotal = open.reduce(
    (sum, site) => sum + (overviewFor.get(site.id)?.crew_active ?? site.worker_count),
    0
  );
  const markedTotal = open.reduce(
    (sum, site) => sum + (overviewFor.get(site.id)?.marked_today ?? 0),
    0
  );
  // Workers on no site appear on no card - say so, or they are invisible.
  const unposted = workers.filter((worker) => worker.site_id == null).length;

  const hasData = sites.length > 0 || workers.length > 0;

  if (loading && !hasData) {
    return (
      <SafeAreaView style={[styles.screen, { backgroundColor: theme.background }]} edges={['top']}>
        <ScreenHeader title="Sites" />
        <LoadingState label="Loading your sites..." />
      </SafeAreaView>
    );
  }

  if (error && !hasData) {
    return (
      <SafeAreaView style={[styles.screen, { backgroundColor: theme.background }]} edges={['top']}>
        <ScreenHeader title="Sites" />
        <ErrorState message={error} onRetry={refresh} />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={[styles.screen, { backgroundColor: theme.background }]} edges={['top']}>
      <ScreenHeader
        title="Sites"
        greeting={{ name: user?.name ?? 'there', salutation: greeting }}
        action={adding ? undefined : { label: '+ Site', onPress: () => setAdding(true) }}
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

        {open.length > 0 ? (
          <View style={styles.todayRow}>
            <ThemedText type="smallBold" themeColor="textSecondary" style={styles.label}>
              TODAY · {formatDate(today).toUpperCase()}
            </ThemedText>
            <ThemedText type="small" themeColor="textSecondary">
              {markedTotal} of {crewTotal} marked across {open.length}{' '}
              {open.length === 1 ? 'site' : 'sites'}
            </ThemedText>
          </View>
        ) : null}

        {error ? (
          <ThemedText type="small" style={{ color: theme.negative }}>
            {error}
          </ThemedText>
        ) : null}

        {/* End-of-shift tool warning: only for things out since BEFORE today.
            A drill taken this morning is not a problem, and a badge that lights
            up every working day is a badge nobody reads. */}
        {outstandingTools && outstandingTools.overdue_count > 0 ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`${outstandingTools.overdue_count} tools not returned`}
            onPress={() => {
              const first = outstandingTools.assignments.find((row) => row.site_id != null);
              const siteId = first?.site_id ?? open[0]?.id;
              if (siteId != null) {
                router.push({ pathname: '/(contractor)/tools', params: { siteId: String(siteId) } });
              }
            }}
            style={({ pressed }) => [
              styles.banner,
              { backgroundColor: `${theme.warning}1A`, borderColor: theme.warning },
              pressed && { opacity: 0.7 },
            ]}>
            <Ionicons name="construct-outline" size={20} color={theme.warning} />
            <ThemedText type="smallBold" style={[styles.bannerText, { color: theme.warning }]}>
              {outstandingTools.overdue_count}{' '}
              {outstandingTools.overdue_count === 1 ? 'tool has' : 'tools have'} not come back
            </ThemedText>
          </Pressable>
        ) : null}

        {adding ? <AddSiteForm onCancel={() => setAdding(false)} /> : null}

        {open.length === 0 && !adding ? (
          <EmptyState
            title="No sites yet"
            message="Add the job you are running. Its crew, its expenses and its reports all live inside it."
            action={{ label: '+ Add site', onPress: () => setAdding(true) }}
          />
        ) : null}

        {open.map((site) => (
          <SiteCard
            key={site.id}
            site={site}
            overview={overviewFor.get(site.id)}
            onPress={() =>
              router.push({ pathname: '/(contractor)/site/[id]', params: { id: String(site.id) } })
            }
          />
        ))}

        {unposted > 0 ? (
          <Pressable
            accessibilityRole="button"
            onPress={() =>
              router.push({ pathname: '/(contractor)/dashboard/workers', params: { site: 'none' } })
            }
            style={({ pressed }) => [
              styles.banner,
              { backgroundColor: theme.backgroundElement, borderColor: theme.border },
              pressed && { opacity: 0.7 },
            ]}>
            <Ionicons name="people-outline" size={20} color={theme.tint} />
            <View style={styles.bannerText}>
              <ThemedText type="smallBold">
                {unposted} {unposted === 1 ? 'worker is' : 'workers are'} not on any site
              </ThemedText>
              <ThemedText type="small" themeColor="textSecondary">
                They appear on no site&apos;s crew. Tap to post them.
              </ThemedText>
            </View>
          </Pressable>
        ) : null}

        {closed.length > 0 ? (
          <Pressable
            accessibilityRole="button"
            onPress={() => setShowClosed((current) => !current)}
            hitSlop={8}>
            <ThemedText type="smallBold" style={{ color: theme.tint }}>
              {showClosed ? 'Hide' : 'Show'} {closed.length} closed{' '}
              {closed.length === 1 ? 'site' : 'sites'}
            </ThemedText>
          </Pressable>
        ) : null}

        {showClosed
          ? closed.map((site) => (
              <SiteCard
                key={site.id}
                site={site}
                overview={overviewFor.get(site.id)}
                onPress={() =>
                  router.push({
                    pathname: '/(contractor)/site/[id]',
                    params: { id: String(site.id) },
                  })
                }
              />
            ))
          : null}
      </ScrollView>
    </SafeAreaView>
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
  todayRow: {
    gap: 2,
  },
  label: {
    letterSpacing: 0.5,
  },
  banner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
    padding: Spacing.three,
    borderRadius: Radius.medium,
    borderWidth: StyleSheet.hairlineWidth,
  },
  bannerText: {
    flex: 1,
    gap: 1,
  },
});
