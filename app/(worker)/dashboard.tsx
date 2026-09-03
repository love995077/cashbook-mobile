import { FlatList, RefreshControl, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { BalanceCard } from '@/components/balance-card';
import { LedgerRow } from '@/components/ledger-row';
import { ErrorState, LoadingState } from '@/components/load-state';
import { ScreenHeader } from '@/components/screen-header';
import { StatementButton } from '@/components/statement-button';
import { SyncBanner } from '@/components/sync-banner';
import { ThemedText } from '@/components/themed-text';
import { EmptyState } from '@/components/ui-kit';
import { MaxContentWidth, Spacing } from '@/constants/theme';
import { useAuth } from '@/auth/auth-context';
import { useStore } from '@/data/store';
import { useTheme } from '@/hooks/use-theme';

/**
 * Worker dashboard: what they are owed, then the history that explains it.
 *
 * Backed by GET /worker/ledger, which returns the balance the server computed
 * along with the rows behind it.
 */
export default function WorkerDashboardScreen() {
  const theme = useTheme();
  const { user, signOut } = useAuth();
  const { myLedger, loading, refreshing, error, refresh } = useStore();

  const body = () => {
    if (loading && !myLedger) return <LoadingState label="Loading your ledger…" />;
    if (error && !myLedger) return <ErrorState message={error} onRetry={refresh} />;

    return (
      <FlatList
        data={myLedger?.entries ?? []}
        keyExtractor={(entry) => `${entry.kind}-${entry.id}`}
        contentContainerStyle={styles.content}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor={theme.tint} />
        }
        ListHeaderComponent={
          <View style={styles.headerBlock}>
            <View style={styles.cardWrap}>
              <SyncBanner />
            </View>

            {myLedger ? (
              <View style={styles.cardWrap}>
                <BalanceCard balance={myLedger.balance} />
              </View>
            ) : null}

            {myLedger ? (
              <View style={styles.cardWrap}>
                <StatementButton
                  workerId={myLedger.worker.id}
                  workerName={myLedger.worker.name}
                />
              </View>
            ) : null}

            {/* A refresh that failed over data already on screen. */}
            {error && myLedger ? (
              <ThemedText type="small" style={[styles.inlineError, { color: theme.negative }]}>
                {error}
              </ThemedText>
            ) : null}

            <ThemedText type="smallBold" themeColor="textSecondary" style={styles.sectionLabel}>
              RECENT HISTORY
            </ThemedText>
          </View>
        }
        renderItem={({ item }) => <LedgerRow entry={item} />}
        ItemSeparatorComponent={() => (
          <View style={[styles.separator, { backgroundColor: theme.border }]} />
        )}
        ListEmptyComponent={
          <EmptyState
            title="Nothing logged yet"
            message="Your attendance and payments will show up here once your contractor records them."
          />
        }
      />
    );
  };

  return (
    <SafeAreaView style={[styles.screen, { backgroundColor: theme.background }]} edges={['top']}>
      <ScreenHeader
        title={user?.name.split(' ')[0] ?? 'Ledger'}
        subtitle={user?.phone}
        action={{ label: 'Sign out', onPress: () => void signOut() }}
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
  cardWrap: {
    paddingHorizontal: Spacing.three,
  },
  sectionLabel: {
    paddingHorizontal: Spacing.three,
    letterSpacing: 0.5,
  },
  inlineError: {
    paddingHorizontal: Spacing.three,
  },
  separator: {
    height: StyleSheet.hairlineWidth,
    marginLeft: Spacing.three + 36 + Spacing.three,
  },
});
