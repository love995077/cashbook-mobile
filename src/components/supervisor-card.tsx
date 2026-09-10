import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Avatar, Card } from '@/components/ui-kit';
import { Spacing } from '@/constants/theme';
import { useStore } from '@/data/store';
import type { Site, User } from '@/data/types';
import { useTheme } from '@/hooks/use-theme';

/**
 * Who runs this site day to day, and the picker that changes it.
 *
 * Admin only. A supervisor may run a site but may not decide which site they
 * run — `PATCH /contractor/sites/{id}` keeps `CurrentContractor` for exactly
 * this field.
 *
 * The list is fetched when the picker opens rather than with the screen: most
 * visits to a site are not about reassigning it, and a contractor with no
 * supervisors at all should not pay for a request that always comes back
 * empty.
 */
export function SupervisorCard({ site }: { site: Site }) {
  const theme = useTheme();
  const { getSupervisors, editSite, isOnline } = useStore();

  const [picking, setPicking] = useState(false);
  const [candidates, setCandidates] = useState<User[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState<number | 'none' | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(
    async (controller: AbortController) => {
      setLoading(true);
      try {
        const rows = await getSupervisors(controller.signal);
        if (!controller.signal.aborted) setCandidates(rows);
      } catch (caught) {
        if (!controller.signal.aborted) setError((caught as Error).message);
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    },
    [getSupervisors]
  );

  useEffect(() => {
    if (!picking || candidates !== null) return;
    const controller = new AbortController();
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load(controller);
    return () => controller.abort();
  }, [picking, candidates, load]);

  async function assign(supervisorId: number | null) {
    setSaving(supervisorId ?? 'none');
    setError(null);
    try {
      await editSite(site.id, { supervisor_id: supervisorId });
      setPicking(false);
    } catch (caught) {
      setError((caught as Error).message);
    } finally {
      setSaving(null);
    }
  }

  return (
    <Card style={styles.card}>
      <View style={styles.head}>
        <View style={styles.body}>
          <ThemedText type="smallBold" themeColor="textSecondary">
            SUPERVISOR
          </ThemedText>
          <ThemedText type="small" numberOfLines={1}>
            {site.supervisor_name ?? 'You are running this site yourself'}
          </ThemedText>
        </View>
        <Pressable
          accessibilityRole="button"
          onPress={() => setPicking((current) => !current)}
          hitSlop={8}
          style={({ pressed }) => (pressed ? { opacity: 0.6 } : null)}>
          <ThemedText type="smallBold" style={{ color: theme.tint }}>
            {picking ? 'Done' : site.supervisor_id ? 'Change' : 'Assign'}
          </ThemedText>
        </Pressable>
      </View>

      <ThemedText type="small" themeColor="textSecondary">
        A supervisor marks attendance, hands out tools, takes deliveries and logs machinery here.
        They never see the cash box, payroll or your invoices.
      </ThemedText>

      {error ? (
        <ThemedText type="small" style={{ color: theme.negative }}>
          {error}
        </ThemedText>
      ) : null}

      {picking ? (
        loading ? (
          <ActivityIndicator color={theme.tint} />
        ) : candidates && candidates.length === 0 ? (
          <ThemedText type="small" style={{ color: theme.warning }}>
            No supervisor accounts yet. One is created by signing up with the supervisor role and
            your contractor id.
          </ThemedText>
        ) : (
          <View style={styles.options}>
            {site.supervisor_id ? (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Run this site yourself"
                disabled={saving !== null || !isOnline}
                onPress={() => void assign(null)}
                style={({ pressed }) => [styles.option, pressed && { opacity: 0.6 }]}>
                <ThemedText type="small" style={{ color: theme.negative }}>
                  {saving === 'none' ? '…' : 'Unassign — run it yourself'}
                </ThemedText>
              </Pressable>
            ) : null}

            {candidates?.map((candidate) => {
              const current = candidate.id === site.supervisor_id;
              return (
                <Pressable
                  key={candidate.id}
                  accessibilityRole="button"
                  accessibilityState={{ selected: current }}
                  accessibilityLabel={`Assign ${candidate.name} to this site`}
                  disabled={current || saving !== null || !isOnline}
                  onPress={() => void assign(candidate.id)}
                  style={({ pressed }) => [styles.option, pressed && { opacity: 0.6 }]}>
                  <Avatar name={candidate.name} size={30} />
                  <View style={styles.optionBody}>
                    <ThemedText type="small" numberOfLines={1}>
                      {candidate.name}
                    </ThemedText>
                    <ThemedText type="small" themeColor="textSecondary" numberOfLines={1}>
                      {candidate.phone ?? 'No mobile number'}
                    </ThemedText>
                  </View>
                  <ThemedText type="small" style={{ color: current ? theme.positive : theme.tint }}>
                    {saving === candidate.id ? '…' : current ? 'Current' : 'Assign'}
                  </ThemedText>
                </Pressable>
              );
            })}
          </View>
        )
      ) : null}

      {picking && !isOnline ? (
        <ThemedText type="small" style={{ color: theme.warning }}>
          You are offline. Assigning a supervisor is not queued — it needs a connection.
        </ThemedText>
      ) : null}
    </Card>
  );
}

const styles = StyleSheet.create({
  card: {
    gap: Spacing.two,
  },
  head: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
  },
  body: {
    flex: 1,
    gap: 1,
  },
  options: {
    gap: Spacing.two,
    paddingTop: Spacing.one,
  },
  option: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two + 2,
  },
  optionBody: {
    flex: 1,
    gap: 1,
  },
});
