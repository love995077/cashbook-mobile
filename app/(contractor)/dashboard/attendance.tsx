import { useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, RefreshControl, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ErrorState, LoadingState } from '@/components/load-state';
import { ScreenHeader } from '@/components/screen-header';
import { SyncBanner } from '@/components/sync-banner';
import { ThemedText } from '@/components/themed-text';
import { Avatar, EmptyState } from '@/components/ui-kit';
import { MaxContentWidth, Radius, Spacing } from '@/constants/theme';
import { useStore } from '@/data/store';
import type { AttendanceStatus } from '@/data/types';
import { useTheme } from '@/hooks/use-theme';
import { formatDate, toISODate } from '@/lib/money';

const OPTIONS: { value: AttendanceStatus; short: string }[] = [
  { value: 'present', short: 'P' },
  { value: 'half_day', short: '½' },
  { value: 'absent', short: 'A' },
];

/**
 * Attendance tab — mark the whole crew for one day in a single pass.
 *
 * Each tap is a POST /contractor/attendance. The API allows one record per
 * worker per date, so a marked row locks rather than letting a second request
 * come back 409.
 */
export default function AttendanceScreen() {
  const theme = useTheme();
  const { workers, loading, refreshing, error, refresh, getAttendanceOn, markAttendance } =
    useStore();
  const [today] = useState(() => toISODate(new Date()));

  /** Worker id currently being submitted, so only that row shows a spinner. */
  const [pendingId, setPendingId] = useState<number | null>(null);
  const [rowError, setRowError] = useState<string | null>(null);

  const markedCount = workers.filter((worker) => getAttendanceOn(worker.id, today)).length;
  const hasData = workers.length > 0;

  async function mark(workerId: number, status: AttendanceStatus) {
    setPendingId(workerId);
    setRowError(null);
    try {
      await markAttendance({ worker_id: workerId, date: today, status });
    } catch (caught) {
      setRowError((caught as Error).message);
    } finally {
      setPendingId(null);
    }
  }

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
          <View style={styles.header}>
            <SyncBanner />
            {rowError || error ? (
              <ThemedText type="small" style={[styles.inlineError, { color: theme.negative }]}>
                {rowError ?? error}
              </ThemedText>
            ) : null}
          </View>
        }
        renderItem={({ item }) => {
          const existing = getAttendanceOn(item.id, today);
          const pending = pendingId === item.id;

          return (
            <View style={styles.row}>
              <Avatar name={item.name} size={40} />

              <View style={styles.body}>
                <ThemedText type="smallBold" numberOfLines={1}>
                  {item.name}
                </ThemedText>
                <ThemedText type="small" themeColor="textSecondary">
                  {existing ? 'Marked for today' : 'Not marked yet'}
                </ThemedText>
              </View>

              {pending ? (
                <View style={styles.pending}>
                  <ActivityIndicator color={theme.tint} />
                </View>
              ) : (
                <View style={styles.options}>
                  {OPTIONS.map((option) => {
                    const selected = existing?.status === option.value;
                    const locked = !!existing && !selected;
                    const tint = {
                      present: theme.positive,
                      half_day: theme.warning,
                      absent: theme.negative,
                    }[option.value];

                    return (
                      <Pressable
                        key={option.value}
                        accessibilityRole="button"
                        accessibilityLabel={`Mark ${item.name} ${option.value.replace('_', ' ')}`}
                        accessibilityState={{ selected, disabled: !!existing || pendingId !== null }}
                        disabled={!!existing || pendingId !== null}
                        onPress={() => void mark(item.id, option.value)}
                        style={({ pressed }) => [
                          styles.option,
                          {
                            borderColor: selected ? tint : theme.border,
                            backgroundColor: selected ? `${tint}22` : 'transparent',
                            opacity: locked ? 0.25 : pressed ? 0.6 : 1,
                          },
                        ]}>
                        <ThemedText
                          type="smallBold"
                          style={{ color: selected ? tint : theme.textSecondary }}>
                          {option.short}
                        </ThemedText>
                      </Pressable>
                    );
                  })}
                </View>
              )}
            </View>
          );
        }}
        ItemSeparatorComponent={() => (
          <View style={[styles.separator, { backgroundColor: theme.border }]} />
        )}
        ListEmptyComponent={
          <EmptyState title="No workers yet" message="Add a worker before marking attendance." />
        }
        ListFooterComponent={
          <ThemedText type="small" themeColor="textSecondary" style={styles.footnote}>
            P = present · ½ = half day · A = absent. One entry per worker per day.
          </ThemedText>
        }
      />
    );
  };

  return (
    <SafeAreaView style={[styles.screen, { backgroundColor: theme.background }]} edges={['top']}>
      <ScreenHeader
        title="Attendance"
        subtitle={`${formatDate(today)} · ${markedCount} of ${workers.length} marked`}
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
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two + 2,
  },
  body: {
    flex: 1,
    gap: 1,
  },
  options: {
    flexDirection: 'row',
    gap: Spacing.two,
  },
  option: {
    width: 40,
    height: 36,
    borderRadius: Radius.small,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pending: {
    width: 40 * 3 + Spacing.two * 2,
    alignItems: 'center',
  },
  separator: {
    height: StyleSheet.hairlineWidth,
    marginLeft: Spacing.three + 40 + Spacing.three,
  },
  footnote: {
    paddingHorizontal: Spacing.three,
    paddingTop: Spacing.three,
  },
  inlineError: {
    paddingHorizontal: Spacing.three,
    paddingBottom: Spacing.two,
  },
  header: {
    gap: Spacing.two,
    paddingHorizontal: Spacing.three,
    paddingBottom: Spacing.two,
  },
});
