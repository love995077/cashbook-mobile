import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { Pressable, RefreshControl, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ErrorState, LoadingState } from '@/components/load-state';
import { ScreenHeader } from '@/components/screen-header';
import { SyncBanner } from '@/components/sync-banner';
import { ThemedText } from '@/components/themed-text';
import { Badge, Card, EmptyState } from '@/components/ui-kit';
import { BottomTabInset, MaxContentWidth, Radius, Spacing } from '@/constants/theme';
import { useAuth } from '@/auth/auth-context';
import { useStore } from '@/data/store';
import { useGreeting } from '@/i18n/language-context';
import { useTheme } from '@/hooks/use-theme';
import { formatDate, toISODate } from '@/lib/money';

/**
 * Home, for the person running one site rather than the business.
 *
 * There are no money cards here and no cash-box FAB. A supervisor's day is
 * three jobs — mark the crew in, hand tools out, take deliveries at the gate —
 * so the screen is those three and the state of the site they are on.
 *
 * The site comes from the store's `sites`, which the API has already narrowed
 * to what this supervisor is assigned. Usually that is exactly one, and the
 * screen opens straight onto it; more than one is rare but legal, so the extra
 * ones are listed rather than hidden behind the single-site layout.
 *
 * The admin's Home is `app/(contractor)/dashboard/index.tsx`, which renders
 * this instead when the signed-in user is a supervisor.
 */
export function SupervisorHome() {
  const theme = useTheme();
  const router = useRouter();
  const greeting = useGreeting();
  const { user } = useAuth();
  const {
    sites,
    workers,
    outstandingTools,
    getAttendanceOn,
    loading,
    refreshing,
    error,
    refresh,
  } = useStore();

  const site = sites[0] ?? null;
  const today = toISODate(new Date());

  const crew = site ? workers.filter((worker) => worker.site_id === site.id) : [];
  const marked = crew.filter((worker) => getAttendanceOn(worker.id, today)).length;
  const unmarked = crew.length - marked;

  const toolsOut = site
    ? (outstandingTools?.assignments.filter((row) => row.site_id === site.id).length ?? 0)
    : 0;

  const hasData = sites.length > 0 || workers.length > 0;

  if (loading && !hasData) {
    return (
      <SafeAreaView style={[styles.screen, { backgroundColor: theme.background }]} edges={['top']}>
        <ScreenHeader title="Home" />
        <LoadingState label="Loading your site…" />
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
        icons={[
          {
            name: 'qr-code-outline',
            accessibilityLabel: 'Scan a worker ID',
            onPress: () => router.push('/(contractor)/scan'),
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

        {site === null ? (
          <EmptyState
            title="No site assigned yet"
            message="Your contractor assigns you to a site from their Sites screen. Once they do, your crew and your tools show up here."
          />
        ) : (
          <>
            {/* The site itself: the one thing every job below is scoped to. */}
            <Card style={styles.siteCard}>
              <View style={styles.siteHead}>
                <View style={styles.siteBody}>
                  <ThemedText type="smallBold" themeColor="textSecondary">
                    YOUR SITE
                  </ThemedText>
                  <ThemedText type="subtitle" numberOfLines={1}>
                    {site.name}
                  </ThemedText>
                  {site.address ? (
                    <ThemedText type="small" themeColor="textSecondary" numberOfLines={2}>
                      {site.address}
                    </ThemedText>
                  ) : null}
                </View>
                <Ionicons name="business-outline" size={28} color={theme.tint} />
              </View>

              <View style={[styles.divider, { backgroundColor: theme.border }]} />

              <View style={styles.counts}>
                <Count label="On the crew" value={String(crew.length)} tone={theme.text} />
                <Count
                  label={`Marked ${formatDate(today)}`}
                  value={`${marked}/${crew.length}`}
                  tone={unmarked > 0 ? theme.warning : theme.positive}
                />
                <Count
                  label="Tools out"
                  value={String(toolsOut)}
                  tone={toolsOut > 0 ? theme.warning : theme.textSecondary}
                />
              </View>
            </Card>

            {/* The end-of-shift warning, same rule as the admin's Home: only
                what has been out since BEFORE today. A drill taken out this
                morning is not a problem, and a badge that lights up every
                working day is a badge nobody reads. */}
            {outstandingTools && outstandingTools.overdue_count > 0 ? (
              <View
                style={[
                  styles.warning,
                  { backgroundColor: `${theme.warning}1A`, borderColor: theme.warning },
                ]}>
                <Ionicons name="construct-outline" size={20} color={theme.warning} />
                <ThemedText type="small" style={[styles.warningText, { color: theme.warning }]}>
                  {outstandingTools.overdue_count}{' '}
                  {outstandingTools.overdue_count === 1 ? 'tool has' : 'tools have'} not come
                  back from an earlier day.
                </ThemedText>
              </View>
            ) : null}

            <View style={styles.jobs}>
              <Job
                icon="calendar-outline"
                label="Mark attendance"
                detail={
                  crew.length === 0
                    ? 'No crew posted here yet'
                    : unmarked > 0
                      ? `${unmarked} still to mark today`
                      : 'Everyone is marked for today'
                }
                badge={unmarked > 0 ? String(unmarked) : undefined}
                onPress={() =>
                  router.push({
                    pathname: '/(contractor)/dashboard/attendance',
                    params: { siteId: String(site.id) },
                  })
                }
              />
              <Job
                icon="construct-outline"
                label="Tool checkout"
                detail={
                  toolsOut > 0
                    ? `${toolsOut} out with the crew`
                    : 'Everything is in the store'
                }
                badge={toolsOut > 0 ? String(toolsOut) : undefined}
                onPress={() =>
                  router.push({
                    pathname: '/(contractor)/tools',
                    params: { siteId: String(site.id) },
                  })
                }
              />
              <Job
                icon="cube-outline"
                label="Receive material"
                detail="File a delivery and its challan photo"
                onPress={() =>
                  router.push({
                    pathname: '/(contractor)/site/[id]',
                    params: { id: String(site.id), tab: 'stock' },
                  })
                }
              />
              <Job
                icon="car-outline"
                label="Machinery and diesel"
                detail="Log hours run and what the fuel cost"
                onPress={() =>
                  router.push({
                    pathname: '/(contractor)/site/[id]',
                    params: { id: String(site.id), tab: 'machinery' },
                  })
                }
              />
            </View>

            {sites.length > 1 ? (
              <View style={styles.section}>
                <ThemedText type="smallBold" themeColor="textSecondary" style={styles.sectionLabel}>
                  ALSO YOURS
                </ThemedText>
                <Card style={styles.list}>
                  {sites.slice(1).map((other, index) => (
                    <View key={other.id}>
                      {index > 0 ? (
                        <View style={[styles.divider, { backgroundColor: theme.border }]} />
                      ) : null}
                      <Job
                        icon="business-outline"
                        label={other.name}
                        detail={`${other.worker_count} on the crew`}
                        onPress={() =>
                          router.push({
                            pathname: '/(contractor)/site/[id]',
                            params: { id: String(other.id) },
                          })
                        }
                        flat
                      />
                    </View>
                  ))}
                </Card>
              </View>
            ) : null}
          </>
        )}

        {error ? (
          <ThemedText type="small" style={{ color: theme.negative }}>
            {error}
          </ThemedText>
        ) : null}
      </ScrollView>
    </SafeAreaView>
  );
}

function Count({ label, value, tone }: { label: string; value: string; tone: string }) {
  return (
    <View style={styles.count}>
      <ThemedText style={[styles.countValue, { color: tone }]} numberOfLines={1}>
        {value}
      </ThemedText>
      <ThemedText type="small" themeColor="textSecondary" numberOfLines={2} style={styles.countLabel}>
        {label}
      </ThemedText>
    </View>
  );
}

/**
 * One of the day's jobs: a wide row rather than a tile.
 *
 * Wide because each one carries a line of state — how many are left to mark,
 * how many tools are out — and that line is the reason to tap it or not.
 */
function Job({
  icon,
  label,
  detail,
  badge,
  onPress,
  flat = false,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  detail: string;
  badge?: string;
  onPress: () => void;
  flat?: boolean;
}) {
  const theme = useTheme();
  const body = (
    <View style={styles.jobBody}>
      <View style={[styles.jobIcon, { backgroundColor: `${theme.tint}1A` }]}>
        <Ionicons name={icon} size={20} color={theme.tint} />
      </View>
      <View style={styles.jobText}>
        <ThemedText type="smallBold" numberOfLines={1}>
          {label}
        </ThemedText>
        <ThemedText type="small" themeColor="textSecondary" numberOfLines={1}>
          {detail}
        </ThemedText>
      </View>
      {badge ? <Badge label={badge} color={theme.warning} /> : null}
      <Ionicons name="chevron-forward" size={18} color={theme.textSecondary} />
    </View>
  );

  if (flat) {
    return (
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${label}. ${detail}`}
        onPress={onPress}
        style={({ pressed }) => (pressed ? { opacity: 0.6 } : null)}>
        {body}
      </Pressable>
    );
  }

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${label}. ${detail}`}
      onPress={onPress}
      style={({ pressed }) => [
        styles.job,
        {
          backgroundColor: theme.backgroundElement,
          borderColor: theme.border,
          opacity: pressed ? 0.7 : 1,
        },
      ]}>
      {body}
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
  siteCard: {
    gap: Spacing.three,
  },
  siteHead: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: Spacing.three,
  },
  siteBody: {
    flex: 1,
    gap: 1,
  },
  divider: {
    height: StyleSheet.hairlineWidth,
  },
  counts: {
    flexDirection: 'row',
    gap: Spacing.two,
  },
  count: {
    flex: 1,
    gap: 1,
  },
  countValue: {
    fontSize: 22,
    lineHeight: 28,
    fontWeight: '700',
  },
  countLabel: {
    lineHeight: 15,
  },
  warning: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two + 2,
    padding: Spacing.three,
    borderRadius: Radius.medium,
    borderWidth: StyleSheet.hairlineWidth,
  },
  warningText: {
    flex: 1,
  },
  jobs: {
    gap: Spacing.two,
  },
  job: {
    borderRadius: Radius.medium,
    borderWidth: StyleSheet.hairlineWidth,
  },
  jobBody: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.three,
  },
  jobIcon: {
    width: 36,
    height: 36,
    borderRadius: Radius.small,
    alignItems: 'center',
    justifyContent: 'center',
  },
  jobText: {
    flex: 1,
    gap: 1,
  },
  section: {
    gap: Spacing.two,
  },
  sectionLabel: {
    letterSpacing: 0.5,
  },
  list: {
    padding: 0,
    paddingVertical: Spacing.one,
    overflow: 'hidden',
  },
});
