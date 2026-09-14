import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import { Linking, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ApiError } from '@/api/client';
import { ErrorState } from '@/components/load-state';
import { MachineryTab } from '@/components/machinery-tab';
import { PettyCashTab } from '@/components/petty-cash-tab';
import { SiteStock } from '@/components/receive-material';
import { SiteGallery } from '@/components/site-gallery';
import { SupervisorCard } from '@/components/supervisor-card';
import { ThemedText } from '@/components/themed-text';
import { TradeBadge } from '@/components/trade-badge';
import { Avatar, Badge, Button, Card, Segmented } from '@/components/ui-kit';
import { MaxContentWidth, Radius, Spacing } from '@/constants/theme';
import { useAuth } from '@/auth/auth-context';
import { useStore } from '@/data/store';
import { isAdmin } from '@/data/types';
import { useTheme } from '@/hooks/use-theme';
import { confirm, notify } from '@/lib/dialog';
import { ATTENDANCE_GLYPHS, ATTENDANCE_LABELS, formatDate, toISODate } from '@/lib/money';

type Tab = 'crew' | 'cash' | 'stock' | 'machinery';

/**
 * Petty cash is admin only. It is the site's share of the contractor's cash
 * box, and `GET /contractor/sites/{id}/petty-cash` refuses a supervisor —
 * so the tab is not offered to one rather than being offered and failing.
 */
const ADMIN_TABS: { value: Tab; label: string }[] = [
  { value: 'crew', label: 'Crew' },
  { value: 'cash', label: 'Petty cash' },
  { value: 'stock', label: 'Stock' },
  { value: 'machinery', label: 'Plant' },
];

const SUPERVISOR_TABS = ADMIN_TABS.filter((tab) => tab.value !== 'cash');

/** Only the tabs a deep link may open, so `?tab=cash` cannot slip past. */
function openingTab(wanted: string | undefined, allowed: Tab[]): Tab {
  return allowed.includes(wanted as Tab) ? (wanted as Tab) : 'crew';
}

/**
 * One site: its crew, today's weather call, the money it leaks, what is on
 * the ground, and the photo log.
 *
 * The rain-out button lives here as well as on the attendance grid, because
 * this is the screen a contractor is on when they are thinking about the site
 * rather than about individual workers.
 *
 * Tabbed rather than one long scroll: the three are different jobs done at
 * different moments — marking the crew in the morning, logging a fare at
 * noon, taking a delivery at the gate — and stacking them would put the one
 * you want four screens down.
 */
export default function SiteDetailScreen() {
  const theme = useTheme();
  const router = useRouter();
  const params = useLocalSearchParams<{ id?: string; tab?: string }>();
  const siteId = Number(params.id);
  const { user } = useAuth();
  const admin = isAdmin(user?.role);
  const tabs = admin ? ADMIN_TABS : SUPERVISOR_TABS;

  const {
    sites,
    workers,
    outstandingTools,
    getAttendanceOn,
    markRainOut,
    assignWorkerToSite,
    removeSite,
    isOnline,
  } = useStore();
  const site = sites.find((candidate) => candidate.id === siteId);

  // Deep-linked from the supervisor's Home, which sends people straight to
  // the job they pressed rather than to the crew list they would then have to
  // navigate out of.
  const [tab, setTab] = useState<Tab>(() =>
    openingTab(params.tab, tabs.map((entry) => entry.value))
  );

  // Only this site's share of the contractor-wide count.
  const toolsOutHere =
    outstandingTools?.assignments.filter((row) => row.site_id === siteId).length ?? 0;

  const [raining, setRaining] = useState(false);
  const [assigning, setAssigning] = useState<number | null>(null);
  const [showAssign, setShowAssign] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [today] = useState(() => toISODate(new Date()));

  // The store holds every worker; this screen only wants the ones posted here.
  const crew = workers.filter((worker) => worker.site_id === siteId);
  const elsewhere = workers.filter((worker) => worker.site_id !== siteId);

  async function assign(workerId: number, to: number | null) {
    setAssigning(workerId);
    setError(null);
    try {
      await assignWorkerToSite(workerId, to);
    } catch (caught) {
      setError((caught as Error).message);
    } finally {
      setAssigning(null);
    }
  }

  async function confirmRainOut() {
    if (!site) return;

    const ok = await confirm({
      title: 'Mark rain-out?',
      message:
        `Mark all ${crew.length} worker${crew.length === 1 ? '' : 's'} at ${site.name} as rained ` +
        `out for ${formatDate(today)}? Anyone already marked present today will be changed.`,
      confirmLabel: 'Mark rain-out',
      destructive: true,
    });
    if (!ok) return;

    setRaining(true);
    setError(null);
    try {
      // site_id is the path and the day is the query; `rain_out` is the
      // server's to write — it marks the whole crew in one transaction rather
      // than this screen sending a status per worker.
      const result = await markRainOut(siteId, { date: today });
      // `markRainOut` refreshes the store before it resolves, so the crew rows
      // below are already showing the rain-out mark by the time this appears.
      notify(
        'Rain-out recorded',
        [
          `${result.created} newly marked`,
          result.updated ? `${result.updated} changed from an earlier status` : null,
          result.unchanged ? `${result.unchanged} already rained out` : null,
        ]
          .filter(Boolean)
          .join('\n')
      );
    } catch (caught) {
      const message = (caught as Error).message;
      setError(message);
      notify('Could not mark rain-out', message);
    } finally {
      setRaining(false);
    }
  }

  /**
   * Close the site, or delete it outright when there is nothing on it.
   *
   * Tries the real delete first and falls back to closing when the server says
   * there is history. That order matters: the contractor is asked one question
   * about what they want, and the decision about whether erasing is SAFE is
   * the server's, made against the counts it can see. Asking here would mean
   * guessing from the two numbers this screen happens to hold.
   */
  async function confirmDelete() {
    if (!site) return;

    const ok = await confirm({
      title: `Delete ${site.name}?`,
      // See the same confirmation on the sites list for why the crew is
      // described per outcome rather than once: only a purge unposts them.
      message:
        'If nothing has been recorded against this site it is deleted outright and ' +
        `${crew.length === 0 ? 'no workers are affected' : `the ${crew.length} worker${crew.length === 1 ? '' : 's'} posted here go back to unposted`}. ` +
        'If it has photos, petty cash, stock, plant or invoices on it, those are kept ' +
        'and the site is closed instead, with its crew still recorded against it — ' +
        'it leaves your list either way. Workers are never deleted.',
      confirmLabel: 'Delete site',
      destructive: true,
    });
    if (!ok) return;

    setDeleting(true);
    setError(null);
    try {
      try {
        await removeSite(siteId, { purge: true });
        notify('Site deleted', `${site.name} had nothing on record and has been removed.`);
      } catch (caught) {
        // 409 is the server saying "this one has history" — the expected
        // answer for any site that has actually been used, not a failure.
        if (!(caught instanceof ApiError) || caught.status !== 409) throw caught;
        await removeSite(siteId);
        notify(
          'Site closed',
          `${site.name} has history on it, so it has been closed rather than deleted. ` +
            'Its photos, cash and invoices are kept.'
        );
      }
      router.back();
    } catch (caught) {
      const message = (caught as Error).message;
      setError(message);
      notify('Could not delete the site', message);
    } finally {
      setDeleting(false);
    }
  }

  function openDirections() {
    if (!site) return;
    const query = encodeURIComponent(site.address || site.name);
    // The maps scheme is handled by Google Maps on Android and falls through
    // to the browser everywhere else, which is the same destination.
    void Linking.openURL(`https://www.google.com/maps/search/?api=1&query=${query}`);
  }

  if (!Number.isFinite(siteId)) {
    return (
      <SafeAreaView style={[styles.screen, { backgroundColor: theme.background }]}>
        <ErrorState message="That site link is not valid." onRetry={() => router.back()} />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={[styles.screen, { backgroundColor: theme.background }]} edges={['top']}>
      <View style={styles.bar}>
        <Pressable
          accessibilityRole="button"
          onPress={() => router.back()}
          hitSlop={12}
          style={({ pressed }) => pressed && { opacity: 0.6 }}>
          <ThemedText type="smallBold" style={{ color: theme.tint }}>
            ‹ {admin ? 'Sites' : 'My site'}
          </ThemedText>
        </Pressable>

        {/* Admin only. A supervisor runs the job; deciding it is over is the
            contractor's call, and DELETE /contractor/sites/{id} refuses them
            anyway — so the button is not offered rather than offered and
            failing. */}
        {admin && site ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`Delete ${site.name}`}
            disabled={deleting || !isOnline}
            onPress={() => void confirmDelete()}
            hitSlop={12}
            style={({ pressed }) => [
              (pressed || deleting) && { opacity: 0.5 },
              !isOnline && { opacity: 0.35 },
            ]}>
            <Ionicons name="trash-outline" size={20} color={theme.negative} />
          </Pressable>
        ) : null}
      </View>

      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.titleBlock}>
          <ThemedText type="subtitle" numberOfLines={1}>
            {site?.name ?? 'Site'}
          </ThemedText>
          {site?.address ? (
            <ThemedText type="small" themeColor="textSecondary" numberOfLines={2}>
              {site.address}
            </ThemedText>
          ) : null}
        </View>

        <Segmented options={tabs} value={tab} onChange={setTab} />

        {/* Outside the tabs: tools are their own screen, and the badge is the
            reason a contractor opens it. */}
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Tools at this site, ${toolsOutHere} out`}
          onPress={() =>
            router.push({
              pathname: '/(contractor)/tools',
              params: { siteId: String(siteId) },
            })
          }
          style={({ pressed }) => [
            styles.toolsRow,
            {
              backgroundColor: theme.backgroundElement,
              borderColor: toolsOutHere ? theme.warning : theme.border,
              opacity: pressed ? 0.7 : 1,
            },
          ]}>
          <ThemedText type="smallBold">🔧  Tools</ThemedText>
          {toolsOutHere ? (
            <Badge
              label={`${toolsOutHere} still out`}
              color={theme.warning}
            />
          ) : (
            <ThemedText type="small" themeColor="textSecondary">
              All in
            </ThemedText>
          )}
        </Pressable>

        {tab === 'crew' ? (
          <View style={styles.actions}>
            <Button
              title={raining ? 'Marking…' : '🌧  Mark rain-out'}
              variant="secondary"
              loading={raining}
              disabled={!isOnline || crew.length === 0}
              onPress={() => void confirmRainOut()}
            />
            {site?.address || site?.name ? (
              <Button title="Directions" variant="ghost" onPress={openDirections} />
            ) : null}
          </View>
        ) : null}

        {tab === 'crew' && crew.length === 0 ? (
          <ThemedText type="small" style={{ color: theme.warning }}>
            No workers are posted to this site yet, so there is nobody to mark rained out.
          </ThemedText>
        ) : null}

        {tab === 'crew' && !isOnline ? (
          <ThemedText type="small" style={{ color: theme.warning }}>
            You are offline. A rain-out writes a row per worker and is not queued — it needs a
            connection.
          </ThemedText>
        ) : null}

        {error ? (
          <ThemedText type="small" style={{ color: theme.negative }}>
            {error}
          </ThemedText>
        ) : null}

        {tab === 'crew' ? (
          <>
          <Card style={styles.crewCard}>
            <ThemedText type="smallBold" themeColor="textSecondary">
              CREW TODAY · {formatDate(today)}
            </ThemedText>

            {crew.length === 0 ? (
              <ThemedText type="small" themeColor="textSecondary">
                Assign workers to this site to see them here.
              </ThemedText>
            ) : (
              crew.map((worker) => {
                const mark = getAttendanceOn(worker.id, today);
                const tint = mark
                  ? {
                      present: theme.positive,
                      half_day: theme.warning,
                      absent: theme.negative,
                      rain_out: theme.tint,
                    }[mark.status]
                  : theme.textSecondary;

                return (
                  <View key={worker.id} style={styles.crewRow}>
                    <Avatar name={worker.name} size={36} />
                    <View style={styles.crewBody}>
                      <ThemedText type="smallBold" numberOfLines={1}>
                        {worker.name}
                      </ThemedText>
                      <TradeBadge trade={worker.trade} />
                    </View>
                    <View style={[styles.mark, { backgroundColor: `${tint}1F` }]}>
                      <ThemedText type="small" style={{ color: tint, fontWeight: '700' }}>
                        {mark ? ATTENDANCE_GLYPHS[mark.status] : '—'}
                      </ThemedText>
                    </View>
                    <ThemedText type="small" themeColor="textSecondary" style={styles.markLabel}>
                      {mark ? ATTENDANCE_LABELS[mark.status] : 'Not marked'}
                    </ThemedText>
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel={`Remove ${worker.name} from this site`}
                      disabled={assigning === worker.id}
                      onPress={() => void assign(worker.id, null)}
                      hitSlop={8}
                      style={({ pressed }) => pressed && { opacity: 0.6 }}>
                      <ThemedText type="small" style={{ color: theme.negative }}>
                        {assigning === worker.id ? '…' : '×'}
                      </ThemedText>
                    </Pressable>
                  </View>
                );
              })
            )}

            <Pressable
              accessibilityRole="button"
              onPress={() => setShowAssign((current) => !current)}
              hitSlop={8}
              style={({ pressed }) => pressed && { opacity: 0.6 }}>
              <ThemedText type="smallBold" style={{ color: theme.tint }}>
                {showAssign ? 'Done' : '+ Post workers to this site'}
              </ThemedText>
            </Pressable>

            {showAssign ? (
              elsewhere.length === 0 ? (
                <ThemedText type="small" themeColor="textSecondary">
                  Every worker on your crew is already posted here.
                </ThemedText>
              ) : (
                elsewhere.map((worker) => {
                  const otherSite = sites.find((candidate) => candidate.id === worker.site_id);
                  return (
                    <Pressable
                      key={worker.id}
                      accessibilityRole="button"
                      accessibilityLabel={`Post ${worker.name} to this site`}
                      disabled={assigning === worker.id}
                      onPress={() => void assign(worker.id, siteId)}
                      style={({ pressed }) => [styles.crewRow, pressed && { opacity: 0.6 }]}>
                      <Avatar name={worker.name} size={30} />
                      <View style={styles.crewBody}>
                        <ThemedText type="small" numberOfLines={1}>
                          {worker.name}
                        </ThemedText>
                        <ThemedText type="small" themeColor="textSecondary" numberOfLines={1}>
                          {otherSite ? `Currently at ${otherSite.name}` : 'Not posted'}
                        </ThemedText>
                      </View>
                      <ThemedText type="small" style={{ color: theme.tint }}>
                        {assigning === worker.id ? '…' : 'Post'}
                      </ThemedText>
                    </Pressable>
                  );
                })
              )
            ) : null}
          </Card>

            {/* Admin only: a supervisor may run a site, but not choose which
                site they run. */}
            {admin && site ? <SupervisorCard site={site} /> : null}

            <SiteGallery siteId={siteId} />
          </>
        ) : tab === 'cash' ? (
          <PettyCashTab siteId={siteId} />
        ) : tab === 'machinery' ? (
          <MachineryTab siteId={siteId} />
        ) : (
          <SiteStock siteId={siteId} />
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
  },
  bar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: Spacing.three,
    paddingTop: Spacing.two,
  },
  content: {
    gap: Spacing.three,
    paddingHorizontal: Spacing.three,
    paddingBottom: Spacing.six,
    maxWidth: MaxContentWidth,
    width: '100%',
    alignSelf: 'center',
  },
  titleBlock: {
    paddingTop: Spacing.two,
    gap: 1,
  },
  actions: {
    gap: Spacing.two,
  },
  toolsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.two,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two + 2,
    borderRadius: Radius.medium,
    borderWidth: StyleSheet.hairlineWidth,
  },
  crewCard: {
    gap: Spacing.three,
  },
  crewRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two + 2,
  },
  crewBody: {
    flex: 1,
    gap: 2,
  },
  mark: {
    width: 30,
    height: 30,
    borderRadius: Radius.small,
    alignItems: 'center',
    justifyContent: 'center',
  },
  markLabel: {
    width: 84,
    textAlign: 'right',
  },
});
