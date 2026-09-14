import { useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ErrorState } from '@/components/load-state';
import { ScreenHeader } from '@/components/screen-header';
import { ThemedText } from '@/components/themed-text';
import { Avatar, Badge, Button, Card, EmptyState, Field } from '@/components/ui-kit';
import { MaxContentWidth, Spacing } from '@/constants/theme';
import { useStore } from '@/data/store';
import type { Tool, ToolAssignment } from '@/data/types';
import { useTheme } from '@/hooks/use-theme';
import { choose, confirm, notify } from '@/lib/dialog';

/**
 * Who has the drill.
 *
 * A grinder walks off a site because nobody could say who took it out. Each
 * tool shows what is on the shelf and who is holding the rest, and a tool is
 * booked back in from the same row it went out on.
 *
 * Site-scoped, because a tool store is: the drill at the villa is not the
 * drill at the mall. Reached from the site screen with `?siteId=`.
 */
export default function ToolsScreen() {
  const theme = useTheme();
  const router = useRouter();
  const params = useLocalSearchParams<{ siteId?: string }>();
  const siteId = Number(params.siteId);

  const { sites, workers, getTools, addTool, removeTool, assignTool, returnTool, isOnline } =
    useStore();
  const site = sites.find((candidate) => candidate.id === siteId);

  const [tools, setTools] = useState<Tool[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<number | null>(null);

  const [showAdd, setShowAdd] = useState(false);
  const [name, setName] = useState('');
  const [count, setCount] = useState('1');
  const [adding, setAdding] = useState(false);

  const load = useCallback(
    async (controller?: AbortController) => {
      try {
        const rows = await getTools(siteId, controller?.signal);
        if (!controller?.signal.aborted) setTools(rows);
      } catch (caught) {
        if (!controller?.signal.aborted) setError((caught as Error).message);
      } finally {
        if (!controller?.signal.aborted) setLoading(false);
      }
    },
    [siteId, getTools]
  );

  useEffect(() => {
    if (!Number.isFinite(siteId)) return;
    const controller = new AbortController();
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load(controller);
    return () => controller.abort();
  }, [load, siteId]);

  // Only this site's crew can be handed this site's tools — a worker at the
  // other job cannot have walked over to sign one out.
  const crew = workers.filter((worker) => worker.site_id === siteId);

  async function create() {
    setError(null);
    if (!name.trim()) {
      setError('Name the tool');
      return;
    }
    const inventory = Number.parseInt(count, 10);
    if (!Number.isFinite(inventory) || inventory < 1) {
      setError('How many does the site have?');
      return;
    }

    setAdding(true);
    try {
      const created = await addTool(siteId, { name: name.trim(), inventory_count: inventory });
      setTools((current) => [...current, created]);
      setName('');
      setCount('1');
      setShowAdd(false);
    } catch (caught) {
      setError((caught as Error).message);
    } finally {
      setAdding(false);
    }
  }

  async function pickWorker(tool: Tool) {
    if (crew.length === 0) {
      notify(
        'Nobody posted here',
        'Tools are handed to workers posted to this site. Post your crew to it first.'
      );
      return;
    }

    const workerId = await choose<number>({
      title: `Who is taking the ${tool.name}?`,
      message: `${tool.available_count} on the shelf.`,
      // Ten is what fits in a readable list; a bigger crew needs a screen, not
      // a dialog.
      options: crew.slice(0, 10).map((worker) => ({ label: worker.name, value: worker.id })),
    });
    if (workerId === null) return;

    await assign(tool, workerId);
  }

  async function assign(tool: Tool, workerId: number) {
    setBusy(tool.id);
    setError(null);
    try {
      await assignTool(siteId, tool.id, workerId);
      await load();
    } catch (caught) {
      setError((caught as Error).message);
    } finally {
      setBusy(null);
    }
  }

  async function confirmReturn(tool: Tool, assignment: ToolAssignment) {
    const outcome = await choose<'returned' | 'lost'>({
      title: `${assignment.worker_name ?? 'This worker'} and the ${tool.name}`,
      message: 'Is it back?',
      options: [
        { label: 'Returned', value: 'returned' },
        // Kept apart from a plain return: this is the one that costs money,
        // and it is worth being able to list at the end of a job.
        { label: 'Mark lost', value: 'lost', destructive: true },
      ],
    });
    if (outcome === null) return;

    await close(tool, assignment, outcome);
  }

  async function close(tool: Tool, assignment: ToolAssignment, status: 'returned' | 'lost') {
    setBusy(tool.id);
    setError(null);
    try {
      await returnTool(assignment.id, status);
      await load();
    } catch (caught) {
      setError((caught as Error).message);
    } finally {
      setBusy(null);
    }
  }

  async function confirmRemove(tool: Tool) {
    const ok = await confirm({
      title: 'Remove this tool?',
      message: `${tool.name} will be taken off the site's list.`,
      confirmLabel: 'Remove',
      cancelLabel: 'Keep',
      destructive: true,
    });
    if (!ok) return;

    setBusy(tool.id);
    try {
      await removeTool(siteId, tool.id);
      setTools((current) => current.filter((row) => row.id !== tool.id));
    } catch (caught) {
      // The API refuses while one is still out, and says so.
      const message = (caught as Error).message;
      setError(message);
      notify('Could not remove', message);
    } finally {
      setBusy(null);
    }
  }

  if (!Number.isFinite(siteId)) {
    return (
      <SafeAreaView style={[styles.screen, { backgroundColor: theme.background }]}>
        <ErrorState message="That tools link is not valid." onRetry={() => router.back()} />
      </SafeAreaView>
    );
  }

  const totalOut = tools.reduce((sum, tool) => sum + tool.out_count, 0);

  return (
    <SafeAreaView style={[styles.screen, { backgroundColor: theme.background }]} edges={['top']}>
      <ScreenHeader
        title="Tools"
        subtitle={
          site
            ? `${site.name} · ${totalOut} out`
            : `${totalOut} out`
        }
        onBack={() => router.back()}
      />

      <ScrollView contentContainerStyle={styles.content}>
        {error ? (
          <ThemedText type="small" style={{ color: theme.negative }}>
            {error}
          </ThemedText>
        ) : null}

        {!isOnline ? (
          <ThemedText type="small" style={{ color: theme.warning }}>
            You are offline. Checking a tool out or back in needs a connection.
          </ThemedText>
        ) : null}

        {loading ? (
          <ActivityIndicator color={theme.tint} style={styles.loading} />
        ) : tools.length === 0 ? (
          <EmptyState
            title="No tools listed"
            message="Add the drill, the grinder, the vibrator — whatever leaves the store and is supposed to come back."
            action={{ label: 'Add a tool', onPress: () => setShowAdd(true) }}
          />
        ) : (
          tools.map((tool) => (
            <Card key={tool.id} style={styles.toolCard}>
              <View style={styles.toolHead}>
                <View style={styles.toolTitle}>
                  <ThemedText type="smallBold" numberOfLines={1}>
                    {tool.name}
                  </ThemedText>
                  <ThemedText type="small" themeColor="textSecondary">
                    {tool.available_count} of {tool.inventory_count} on the shelf
                  </ThemedText>
                </View>

                {tool.out_count > 0 ? (
                  <Badge label={`${tool.out_count} out`} color={theme.warning} />
                ) : (
                  <Badge label="All in" color={theme.positive} />
                )}
              </View>

              {tool.assignments.map((assignment) => (
                <Pressable
                  key={assignment.id}
                  accessibilityRole="button"
                  accessibilityLabel={`Book in the ${tool.name} from ${assignment.worker_name}`}
                  disabled={busy === tool.id || !isOnline}
                  onPress={() => void confirmReturn(tool, assignment)}
                  style={({ pressed }) => [styles.holderRow, pressed && { opacity: 0.6 }]}>
                  <Avatar name={assignment.worker_name ?? '?'} size={30} />
                  <View style={styles.holderBody}>
                    <ThemedText type="small" numberOfLines={1}>
                      {assignment.worker_name ?? `Worker #${assignment.worker_id}`}
                    </ThemedText>
                    <ThemedText type="small" themeColor="textSecondary">
                      Out since {formatCheckout(assignment.checkout_time)}
                    </ThemedText>
                  </View>
                  <ThemedText type="small" style={{ color: theme.tint }}>
                    Book in
                  </ThemedText>
                </Pressable>
              ))}

              <View style={styles.toolActions}>
                <View style={styles.toolAction}>
                  <Button
                    title={busy === tool.id ? '…' : 'Assign'}
                    variant="secondary"
                    disabled={!isOnline || busy === tool.id || tool.available_count === 0}
                    onPress={() => void pickWorker(tool)}
                  />
                </View>
                <View style={styles.toolAction}>
                  <Button
                    title="Remove"
                    variant="ghost"
                    disabled={busy === tool.id}
                    onPress={() => void confirmRemove(tool)}
                  />
                </View>
              </View>
            </Card>
          ))
        )}

        {showAdd ? (
          <Card style={styles.addCard}>
            <Field
              label="Tool"
              value={name}
              onChangeText={setName}
              placeholder="Bosch drill"
              maxLength={120}
              returnKeyType="next"
            />
            <Field
              label="How many does this site have?"
              value={count}
              onChangeText={setCount}
              keyboardType="number-pad"
              placeholder="1"
              hint="Three identical drills are one entry with a count of 3."
              returnKeyType="done"
            />
            <Button title="Add tool" loading={adding} onPress={() => void create()} />
            <Button
              title="Cancel"
              variant="ghost"
              disabled={adding}
              onPress={() => setShowAdd(false)}
            />
          </Card>
        ) : tools.length ? (
          <Button title="+ Add a tool" variant="secondary" onPress={() => setShowAdd(true)} />
        ) : null}
      </ScrollView>
    </SafeAreaView>
  );
}

/** "9:20 am" for today, "Tue 9:20 am" for anything older — see the badge. */
function formatCheckout(iso: string): string {
  const when = new Date(iso.endsWith('Z') ? iso : `${iso}Z`);
  if (Number.isNaN(when.getTime())) return iso;

  const time = when.toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' });
  const sameDay = when.toDateString() === new Date().toDateString();
  return sameDay
    ? time
    : `${when.toLocaleDateString('en-IN', { weekday: 'short' })} ${time}`;
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
  },
  content: {
    gap: Spacing.three,
    paddingHorizontal: Spacing.three,
    paddingBottom: Spacing.six,
    maxWidth: MaxContentWidth,
    width: '100%',
    alignSelf: 'center',
  },
  loading: {
    paddingVertical: Spacing.five,
  },
  toolCard: {
    gap: Spacing.three,
  },
  toolHead: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
  },
  toolTitle: {
    flex: 1,
    gap: 1,
  },
  holderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two + 2,
    paddingVertical: Spacing.one,
  },
  holderBody: {
    flex: 1,
    gap: 1,
  },
  toolActions: {
    flexDirection: 'row',
    gap: Spacing.two,
  },
  toolAction: {
    flex: 1,
  },
  addCard: {
    gap: Spacing.three,
  },
});
