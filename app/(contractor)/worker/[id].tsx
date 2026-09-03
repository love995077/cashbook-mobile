import { useLocalSearchParams, useRouter } from 'expo-router';
import { FlatList, Pressable, RefreshControl, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { BalanceCard } from '@/components/balance-card';
import { LedgerRow } from '@/components/ledger-row';
import { ErrorState, LoadingState } from '@/components/load-state';
import { StatementButton } from '@/components/statement-button';
import { ThemedText } from '@/components/themed-text';
import { Button, EmptyState } from '@/components/ui-kit';
import { MaxContentWidth, Spacing } from '@/constants/theme';
import { useStore } from '@/data/store';
import { useTheme } from '@/hooks/use-theme';
import { CURRENCY, formatMoney } from '@/lib/money';

/**
 * One worker, seen by their contractor: balance, history, and the two things
 * you would want to do from here — add an entry, or share the statement.
 */
export default function WorkerDetailScreen() {
  const theme = useTheme();
  const router = useRouter();
  const params = useLocalSearchParams<{ id?: string }>();
  const workerId = Number(params.id);

  const { workers, getLedger, loading, refreshing, error, refresh } = useStore();
  const worker = workers.find((candidate) => candidate.id === workerId);
  const ledger = Number.isFinite(workerId) ? getLedger(workerId) : undefined;

  if (!Number.isFinite(workerId)) {
    return (
      <SafeAreaView style={[styles.screen, { backgroundColor: theme.background }]}>
        <ErrorState message="That worker link is not valid." onRetry={() => router.back()} />
      </SafeAreaView>
    );
  }

  const body = () => {
    if (loading && !ledger) return <LoadingState label="Loading ledger…" />;
    if (error && !ledger) return <ErrorState message={error} onRetry={refresh} />;
    if (!ledger) {
      return <EmptyState title="Worker not found" message="They may have been removed." />;
    }

    return (
      <FlatList
        data={ledger.entries}
        keyExtractor={(entry) => `${entry.kind}-${entry.id}`}
        contentContainerStyle={styles.content}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor={theme.tint} />
        }
        ListHeaderComponent={
          <View style={styles.headerBlock}>
            <View style={styles.cardWrap}>
              <BalanceCard balance={ledger.balance} />
            </View>

            <View style={styles.actions}>
              <Button
                title="New entry"
                onPress={() =>
                  router.push({
                    pathname: '/(contractor)/new-entry',
                    params: { workerId: String(workerId) },
                  })
                }
              />
              <StatementButton
                workerId={workerId}
                workerName={ledger.worker.name}
              />
            </View>

            <ThemedText type="smallBold" themeColor="textSecondary" style={styles.sectionLabel}>
              HISTORY
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
            message="Wages, advances and attendance will appear here."
          />
        }
      />
    );
  };

  const subtitle = worker?.daily_wage
    ? `${CURRENCY}${formatMoney(worker.daily_wage)} / day`
    : worker?.phone;

  return (
    <SafeAreaView style={[styles.screen, { backgroundColor: theme.background }]} edges={['top']}>
      <View style={styles.bar}>
        <Pressable
          accessibilityRole="button"
          onPress={() => router.back()}
          hitSlop={12}
          style={({ pressed }) => pressed && { opacity: 0.6 }}>
          <ThemedText type="smallBold" style={{ color: theme.tint }}>
            ‹ Workers
          </ThemedText>
        </Pressable>
      </View>

      <View style={styles.titleBlock}>
        <ThemedText type="subtitle" numberOfLines={1}>
          {worker?.name ?? ledger?.worker.name ?? 'Worker'}
        </ThemedText>
        {subtitle ? (
          <ThemedText type="small" themeColor="textSecondary">
            {subtitle}
          </ThemedText>
        ) : null}
      </View>

      {body()}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
  },
  bar: {
    paddingHorizontal: Spacing.three,
    paddingTop: Spacing.two,
  },
  titleBlock: {
    paddingHorizontal: Spacing.three,
    paddingTop: Spacing.two,
    paddingBottom: Spacing.three,
    gap: 1,
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
  actions: {
    paddingHorizontal: Spacing.three,
    gap: Spacing.two,
  },
  sectionLabel: {
    paddingHorizontal: Spacing.three,
    letterSpacing: 0.5,
  },
  separator: {
    height: StyleSheet.hairlineWidth,
    marginLeft: Spacing.three + 36 + Spacing.three,
  },
});
