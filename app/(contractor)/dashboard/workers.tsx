import { useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { FlatList, Pressable, RefreshControl, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { AddWorkerModal } from '@/components/add-worker-modal';
import { ErrorState, LoadingState } from '@/components/load-state';
import { ScreenHeader } from '@/components/screen-header';
import { SyncBanner } from '@/components/sync-banner';
import { ThemedText } from '@/components/themed-text';
import { Avatar, Badge, Card, EmptyState } from '@/components/ui-kit';
import { VoiceEntryButton } from '@/components/voice-entry-button';
import { WorkerRow } from '@/components/worker-row';
import { MaxContentWidth, Spacing } from '@/constants/theme';
import { useAuth } from '@/auth/auth-context';
import { useStore } from '@/data/store';
import type { User } from '@/data/types';
import { useTheme } from '@/hooks/use-theme';
import { CURRENCY, formatDate, formatMoney } from '@/lib/money';

/** 'all', 'none' (posted nowhere), or a site id. */
type Scope = 'all' | 'none' | number;

/**
 * Workers tab: the whole crew, as a directory.
 *
 * Day-to-day labour lives inside each site (site-first); this is where the
 * crew is looked at as people rather than as a site's day: who is posted
 * where, who is posted nowhere (and so appears on no site's grid), and who
 * has been deactivated - with their ledgers still one tap away, because a
 * worker who left is often still owed money.
 *
 * Deactivated workers are fetched for the screen when asked for. The store
 * holds only the active crew, which is what every other screen wants.
 */
export default function WorkersScreen() {
  const theme = useTheme();
  const router = useRouter();
  const params = useLocalSearchParams<{ site?: string }>();
  const { user } = useAuth();
  const { workers, sites, loading, refreshing, error, refresh, getWorkers } = useStore();
  const [adding, setAdding] = useState(false);
  const [scope, setScope] = useState<Scope>(() =>
    params.site === 'none' ? 'none' : params.site ? Number(params.site) : 'all'
  );
  const [showInactive, setShowInactive] = useState(false);
  const [inactive, setInactive] = useState<User[]>([]);

  // The Home banner links here with ?site=none, and the tab stays mounted, so
  // a later link has to move the filter too. Adjusted during render rather
  // than in an effect: it is derived from the route, not synced from outside.
  const [linked, setLinked] = useState(params.site);
  if (params.site !== linked) {
    setLinked(params.site);
    if (params.site) setScope(params.site === 'none' ? 'none' : Number(params.site));
  }

  useEffect(() => {
    if (!showInactive) return;
    const controller = new AbortController();
    void (async () => {
      try {
        const everyone = await getWorkers({ includeInactive: true }, controller.signal);
        if (!controller.signal.aborted) setInactive(everyone.filter((w) => !w.is_active));
      } catch {
        // The active list is still right; the toggle simply shows nothing more.
      }
    })();
    return () => controller.abort();
  }, [showInactive, getWorkers, workers]);

  const inScope = useCallback(
    (worker: { site_id: number | null }) =>
      scope === 'all' ? true : scope === 'none' ? worker.site_id == null : worker.site_id === scope,
    [scope]
  );

  const shown = useMemo(() => workers.filter(inScope), [workers, inScope]);
  const shownInactive = useMemo(() => inactive.filter(inScope), [inactive, inScope]);

  const totals = useMemo(() => {
    const balances = shown.map((worker) => worker.balance.balance);
    return {
      payable: balances.filter((value) => value > 0).reduce((sum, value) => sum + value, 0),
      advanced: balances.filter((value) => value < 0).reduce((sum, value) => sum - value, 0),
    };
  }, [shown]);

  const scopes: { value: Scope; label: string }[] = [
    { value: 'all', label: 'All' },
    ...sites.filter((site) => site.is_active).map((site) => ({ value: site.id, label: site.name })),
    { value: 'none', label: 'Unposted' },
  ];

  const hasData = workers.length > 0;

  const body = () => {
    if (loading && !hasData) return <LoadingState label="Loading your crew…" />;
    if (error && !hasData) return <ErrorState message={error} onRetry={refresh} />;

    return (
      <FlatList
        data={shown}
        keyExtractor={(worker) => String(worker.id)}
        contentContainerStyle={styles.content}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor={theme.tint} />
        }
        ListHeaderComponent={
          <View style={styles.headerBlock}>
            <View style={styles.pad}>
              <SyncBanner />
            </View>

            <Card style={styles.summary}>
              <View style={styles.summaryItem}>
                <ThemedText type="small" themeColor="textSecondary">
                  Total payable
                </ThemedText>
                <ThemedText style={[styles.summaryValue, { color: theme.positive }]}>
                  {CURRENCY}
                  {formatMoney(totals.payable)}
                </ThemedText>
              </View>
              <View style={[styles.summaryDivider, { backgroundColor: theme.border }]} />
              <View style={styles.summaryItem}>
                <ThemedText type="small" themeColor="textSecondary">
                  Advanced out
                </ThemedText>
                <ThemedText style={[styles.summaryValue, { color: theme.warning }]}>
                  {CURRENCY}
                  {formatMoney(totals.advanced)}
                </ThemedText>
              </View>
            </Card>

            <View style={styles.pad}>
              <VoiceEntryButton />
            </View>

            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.chips}>
              {scopes.map((option) => {
                const selected = option.value === scope;
                return (
                  <Pressable
                    key={String(option.value)}
                    accessibilityRole="button"
                    accessibilityState={{ selected }}
                    onPress={() => setScope(option.value)}
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
                      numberOfLines={1}
                      style={{ color: selected ? theme.onTint : theme.textSecondary }}>
                      {option.label}
                    </ThemedText>
                  </Pressable>
                );
              })}
            </ScrollView>

            {error ? (
              <ThemedText type="small" style={[styles.pad, { color: theme.negative }]}>
                {error}
              </ThemedText>
            ) : null}

            <ThemedText type="smallBold" themeColor="textSecondary" style={styles.sectionLabel}>
              {shown.length} WORKER{shown.length === 1 ? '' : 'S'}
            </ThemedText>
          </View>
        }
        renderItem={({ item }) => (
          <WorkerRow
            worker={item}
            onPress={() =>
              router.push({ pathname: '/(contractor)/worker/[id]', params: { id: String(item.id) } })
            }
          />
        )}
        ItemSeparatorComponent={() => (
          <View style={[styles.separator, { backgroundColor: theme.border }]} />
        )}
        ListEmptyComponent={
          scope === 'all' ? (
            <EmptyState
              title="No workers yet"
              message="Add your first worker to start tracking wages and advances."
              action={{ label: '+ Add Worker', onPress: () => setAdding(true) }}
            />
          ) : (
            <EmptyState
              title={scope === 'none' ? 'Everyone is posted to a site' : 'Nobody posted here'}
              message={
                scope === 'none'
                  ? 'Every active worker is on a site, so every one of them is on a grid.'
                  : 'Post workers to this site from its Labour tab.'
              }
            />
          )
        }
        ListFooterComponent={
          <View style={styles.footer}>
            <Pressable
              accessibilityRole="button"
              onPress={() => setShowInactive((current) => !current)}
              hitSlop={8}>
              <ThemedText type="smallBold" style={{ color: theme.tint }}>
                {showInactive ? 'Hide deactivated workers' : 'Show deactivated workers'}
              </ThemedText>
            </Pressable>

            {showInactive ? (
              shownInactive.length === 0 ? (
                <ThemedText type="small" themeColor="textSecondary">
                  Nobody here has been deactivated.
                </ThemedText>
              ) : (
                shownInactive.map((worker) => (
                  <Pressable
                    key={worker.id}
                    accessibilityRole="button"
                    onPress={() =>
                      router.push({
                        pathname: '/(contractor)/worker/[id]',
                        params: { id: String(worker.id) },
                      })
                    }
                    style={({ pressed }) => [styles.inactiveRow, pressed && { opacity: 0.6 }]}>
                    <Avatar name={worker.name} size={36} />
                    <View style={styles.inactiveBody}>
                      <ThemedText type="smallBold" numberOfLines={1}>
                        {worker.name}
                      </ThemedText>
                      <ThemedText type="small" themeColor="textSecondary" numberOfLines={1}>
                        {worker.deactivated_on
                          ? `Last day before ${formatDate(worker.deactivated_on)}`
                          : 'Deactivated'}
                        {worker.site_id
                          ? ` · ${sites.find((site) => site.id === worker.site_id)?.name ?? ''}`
                          : ''}
                      </ThemedText>
                    </View>
                    <Badge label="Deactivated" color={theme.textSecondary} />
                  </Pressable>
                ))
              )
            ) : null}
          </View>
        }
      />
    );
  };

  return (
    <SafeAreaView style={[styles.screen, { backgroundColor: theme.background }]} edges={['top']}>
      <ScreenHeader
        title="Workers"
        subtitle={user ? `${user.name}'s crew` : undefined}
        action={{ label: '+ Add Worker', onPress: () => setAdding(true) }}
        icons={[
          {
            name: 'settings-outline',
            accessibilityLabel: 'Settings',
            onPress: () => router.push('/(contractor)/dashboard/settings'),
          },
        ]}
      />
      {body()}

      <AddWorkerModal
        visible={adding}
        onClose={() => setAdding(false)}
        defaultSiteId={typeof scope === 'number' ? scope : null}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
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
  pad: {
    paddingHorizontal: Spacing.three,
  },
  summary: {
    flexDirection: 'row',
    alignItems: 'center',
    marginHorizontal: Spacing.three,
  },
  summaryItem: {
    flex: 1,
    gap: Spacing.half,
  },
  summaryValue: {
    fontSize: 22,
    lineHeight: 28,
    fontWeight: '700',
  },
  summaryDivider: {
    width: StyleSheet.hairlineWidth,
    alignSelf: 'stretch',
    marginHorizontal: Spacing.three,
  },
  chips: {
    gap: Spacing.two,
    paddingHorizontal: Spacing.three,
  },
  chip: {
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
    borderRadius: 999,
    borderWidth: StyleSheet.hairlineWidth,
    maxWidth: 200,
  },
  sectionLabel: {
    paddingHorizontal: Spacing.three,
    letterSpacing: 0.5,
  },
  separator: {
    height: StyleSheet.hairlineWidth,
    marginLeft: Spacing.three + 44 + Spacing.three,
  },
  footer: {
    gap: Spacing.three,
    padding: Spacing.three,
  },
  inactiveRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
  },
  inactiveBody: {
    flex: 1,
    gap: 1,
  },
});
