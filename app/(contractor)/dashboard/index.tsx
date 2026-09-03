import { useRouter } from 'expo-router';
import { useMemo } from 'react';
import { FlatList, RefreshControl, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ErrorState, LoadingState } from '@/components/load-state';
import { ScreenHeader } from '@/components/screen-header';
import { SyncBanner } from '@/components/sync-banner';
import { ThemedText } from '@/components/themed-text';
import { Card, EmptyState } from '@/components/ui-kit';
import { VoiceEntryButton } from '@/components/voice-entry-button';
import { WorkerRow } from '@/components/worker-row';
import { MaxContentWidth, Spacing } from '@/constants/theme';
import { useAuth } from '@/auth/auth-context';
import { useStore } from '@/data/store';
import { useTheme } from '@/hooks/use-theme';
import { CURRENCY, formatMoney } from '@/lib/money';

/**
 * Workers tab — the contractor's crew and what each one is owed, from
 * GET /contractor/workers plus each worker's ledger.
 */
export default function WorkersScreen() {
  const theme = useTheme();
  const router = useRouter();
  const { user } = useAuth();
  const { workers, loading, refreshing, error, refresh } = useStore();

  const totals = useMemo(() => {
    const balances = workers.map((worker) => worker.balance.balance);
    return {
      payable: balances.filter((value) => value > 0).reduce((sum, value) => sum + value, 0),
      advanced: balances.filter((value) => value < 0).reduce((sum, value) => sum - value, 0),
    };
  }, [workers]);

  const hasData = workers.length > 0;

  const body = () => {
    if (loading && !hasData) return <LoadingState label="Loading your crew…" />;
    if (error && !hasData) return <ErrorState message={error} onRetry={refresh} />;

    return (
      <FlatList
        data={workers}
        keyExtractor={(worker) => String(worker.id)}
        contentContainerStyle={styles.content}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor={theme.tint} />
        }
        ListHeaderComponent={
          <View style={styles.headerBlock}>
            <View style={styles.banner}>
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

            <View style={styles.voice}>
              <VoiceEntryButton />
            </View>

            {error ? (
              <ThemedText type="small" style={[styles.inlineError, { color: theme.negative }]}>
                {error}
              </ThemedText>
            ) : null}

            <ThemedText type="smallBold" themeColor="textSecondary" style={styles.sectionLabel}>
              {workers.length} WORKER{workers.length === 1 ? '' : 'S'}
            </ThemedText>
          </View>
        }
        renderItem={({ item }) => (
          <WorkerRow
            worker={item}
            onPress={() =>
              router.push({
                pathname: '/(contractor)/worker/[id]',
                params: { id: String(item.id) },
              })
            }
          />
        )}
        ItemSeparatorComponent={() => (
          <View style={[styles.separator, { backgroundColor: theme.border }]} />
        )}
        ListEmptyComponent={
          <EmptyState
            title="No workers yet"
            message="Add your first worker to start tracking wages and advances."
          />
        }
      />
    );
  };

  return (
    <SafeAreaView style={[styles.screen, { backgroundColor: theme.background }]} edges={['top']}>
      <ScreenHeader
        title="Workers"
        subtitle={user ? `${user.name}'s crew` : undefined}
        action={{ label: '+ Entry', onPress: () => router.push('/(contractor)/new-entry') }}
      />
      {body()}
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
  sectionLabel: {
    paddingHorizontal: Spacing.three,
    letterSpacing: 0.5,
  },
  inlineError: {
    paddingHorizontal: Spacing.three,
  },
  voice: {
    paddingHorizontal: Spacing.three,
  },
  banner: {
    paddingHorizontal: Spacing.three,
  },
  separator: {
    height: StyleSheet.hairlineWidth,
    marginLeft: Spacing.three + 44 + Spacing.three,
  },
});
