import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Avatar, Card } from '@/components/ui-kit';
import { Spacing } from '@/constants/theme';
import { useStore } from '@/data/store';
import type { User } from '@/data/types';
import { useTheme } from '@/hooks/use-theme';
import { confirm, notify } from '@/lib/dialog';
import { formatDate } from '@/lib/money';

/**
 * Workers taken off this site's crew, collapsed by default.
 *
 * Deactivated workers never appear in the attendance grid, but they are not
 * gone: their days and their money stay on this site's books, and the
 * contractor needs a way back to their ledger (to pay what is still owed)
 * and a way to bring someone back who returns for the next job.
 *
 * Fetched for the screen - the store holds only the active crew.
 */
export function DeactivatedCrew({ siteId, admin }: { siteId: number; admin: boolean }) {
  const theme = useTheme();
  const router = useRouter();
  const { getWorkers, reactivateWorker, isOnline, workers } = useStore();
  const [open, setOpen] = useState(false);
  const [rows, setRows] = useState<User[]>([]);
  const [busy, setBusy] = useState<number | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    void (async () => {
      try {
        const everyone = await getWorkers({ includeInactive: true, siteId }, controller.signal);
        if (!controller.signal.aborted) setRows(everyone.filter((worker) => !worker.is_active));
      } catch {
        // Not worth an error over: the active crew above is what the screen is for.
      }
    })();
    return () => controller.abort();
    // `workers` changes when somebody is deactivated or reactivated.
  }, [getWorkers, siteId, workers]);

  if (rows.length === 0) return null;

  async function bringBack(worker: User) {
    const ok = await confirm({
      title: `Reactivate ${worker.name}?`,
      message:
        'They go back on this site’s crew and into the attendance grid. Their ledger is ' +
        'exactly as it was.',
      confirmLabel: 'Reactivate',
    });
    if (!ok) return;
    setBusy(worker.id);
    try {
      await reactivateWorker(worker.id);
    } catch (caught) {
      notify('Could not reactivate', (caught as Error).message);
    } finally {
      setBusy(null);
    }
  }

  return (
    <Card style={styles.card}>
      <Pressable accessibilityRole="button" onPress={() => setOpen((current) => !current)}>
        <ThemedText type="smallBold" style={{ color: theme.tint }}>
          {open ? 'Hide' : 'Show'} {rows.length} deactivated{' '}
          {rows.length === 1 ? 'worker' : 'workers'}
        </ThemedText>
      </Pressable>

      {open
        ? rows.map((worker) => (
            <View key={worker.id} style={styles.row}>
              <Pressable
                accessibilityRole="button"
                disabled={!admin}
                onPress={() =>
                  router.push({
                    pathname: '/(contractor)/worker/[id]',
                    params: { id: String(worker.id) },
                  })
                }
                style={styles.who}>
                <Avatar name={worker.name} size={30} />
                <View style={styles.body}>
                  <ThemedText type="small" numberOfLines={1}>
                    {worker.name}
                  </ThemedText>
                  <ThemedText type="small" themeColor="textSecondary" numberOfLines={1}>
                    {worker.deactivated_on
                      ? `Left · last day before ${formatDate(worker.deactivated_on)}`
                      : 'Deactivated'}
                  </ThemedText>
                </View>
              </Pressable>
              {admin ? (
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={`Reactivate ${worker.name}`}
                  disabled={!isOnline || busy !== null}
                  onPress={() => void bringBack(worker)}
                  hitSlop={8}>
                  <ThemedText type="small" style={{ color: theme.tint }}>
                    {busy === worker.id ? '…' : 'Reactivate'}
                  </ThemedText>
                </Pressable>
              ) : null}
            </View>
          ))
        : null}
    </Card>
  );
}

const styles = StyleSheet.create({
  card: {
    gap: Spacing.three,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
  },
  who: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
  },
  body: {
    flex: 1,
    gap: 1,
  },
});
