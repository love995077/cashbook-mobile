import { useRouter } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { AudioNotePlayer } from '@/components/audio-note-player';
import { PaymentModePicker } from '@/components/payment-mode-picker';
import { ScreenHeader } from '@/components/screen-header';
import { ThemedText } from '@/components/themed-text';
import { Avatar, Badge, Button, Card, EmptyState, Segmented } from '@/components/ui-kit';
import { MaxContentWidth, Spacing } from '@/constants/theme';
import { useStore } from '@/data/store';
import type { AdvanceRequest, AdvanceRequestStatus, PaymentMode } from '@/data/types';
import { useTheme } from '@/hooks/use-theme';
import { confirm, notify } from '@/lib/dialog';
import { CURRENCY, formatMoney, formatRelativeDate } from '@/lib/money';

type Scope = 'pending' | 'approved' | 'rejected';

const SCOPES: { value: Scope; label: string }[] = [
  { value: 'pending', label: 'Waiting' },
  { value: 'approved', label: 'Approved' },
  { value: 'rejected', label: 'Declined' },
];

/**
 * The approvals queue: who has asked for money, and the answer.
 *
 * Oldest first, because it is a queue — whoever has been waiting longest
 * belongs at the top. That ordering comes from the API rather than being
 * re-sorted here.
 *
 * APPROVING MOVES MONEY
 * ---------------------
 * The server writes the matching ADVANCE transaction in the same call, so an
 * approval is not a status change — it is a payment. The payment mode is
 * therefore asked for BEFORE the confirm, not after, and the confirmation
 * names the amount and the mode together.
 */
export default function ApprovalsScreen() {
  const theme = useTheme();
  const router = useRouter();
  const { getAdvanceRequests, decideAdvanceRequest, isOnline } = useStore();

  const [scope, setScope] = useState<Scope>('pending');
  const [requests, setRequests] = useState<AdvanceRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<number | null>(null);
  const [mode, setMode] = useState<PaymentMode>('cash');

  const load = useCallback(
    async (controller?: AbortController) => {
      try {
        const rows = await getAdvanceRequests(
          { status: scope as AdvanceRequestStatus },
          controller?.signal
        );
        if (!controller?.signal.aborted) setRequests(rows);
      } catch (caught) {
        if (!controller?.signal.aborted) setError((caught as Error).message);
      } finally {
        if (!controller?.signal.aborted) setLoading(false);
      }
    },
    [getAdvanceRequests, scope]
  );

  useEffect(() => {
    const controller = new AbortController();
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load(controller);
    return () => controller.abort();
  }, [load]);

  async function decide(
    request: AdvanceRequest,
    status: 'approved' | 'rejected'
  ) {
    setBusy(request.id);
    setError(null);
    try {
      await decideAdvanceRequest(request.id, {
        status,
        // Ignored server-side on a rejection - no money moves.
        payment_mode: status === 'approved' ? mode : null,
      });
      // The list is the one for `scope`, so an answered request no longer
      // belongs in it. Dropping it here rather than reloading keeps the
      // remaining cards still under the thumb that is working through them.
      setRequests((current) => current.filter((row) => row.id !== request.id));
    } catch (caught) {
      const message = (caught as Error).message;
      setError(message);
      // Money did not move and the row is still in the queue — that is worth
      // interrupting for, not just a line of red text at the top of a list
      // that may be scrolled well past it.
      notify(status === 'approved' ? 'Could not approve' : 'Could not decline', message);
    } finally {
      setBusy(null);
    }
  }

  async function confirmApprove(request: AdvanceRequest) {
    const name = request.worker_name ?? `Worker #${request.worker_id}`;
    const ok = await confirm({
      title: `Pay ${name} ${CURRENCY}${formatMoney(request.amount)}?`,
      message:
        `This is logged as an advance paid by ${mode.replace('_', ' ')} and comes straight off ` +
        'what you owe them. It cannot be undone from here.',
      confirmLabel: 'Approve',
      cancelLabel: 'Not yet',
    });
    if (!ok) return;
    await decide(request, 'approved');
  }

  async function confirmReject(request: AdvanceRequest) {
    const name = request.worker_name ?? `Worker #${request.worker_id}`;
    const ok = await confirm({
      title: `Decline ${name}'s request?`,
      message: 'They can raise a new one. This one stays on record as declined.',
      confirmLabel: 'Decline',
      destructive: true,
    });
    if (!ok) return;
    await decide(request, 'rejected');
  }

  return (
    <SafeAreaView style={[styles.screen, { backgroundColor: theme.background }]} edges={['top']}>
      <ScreenHeader
        title="Advance requests"
        subtitle={
          scope === 'pending' && requests.length
            ? `${requests.length} waiting on you`
            : undefined
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
            You are offline. Approving pays money out, so it needs a connection.
          </ThemedText>
        ) : null}

        <Segmented options={SCOPES} value={scope} onChange={setScope} />

        {/* Asked once for the whole screen rather than per card: a contractor
            settling the morning's requests is paying them the same way. */}
        {scope === 'pending' && requests.length ? (
          <PaymentModePicker value={mode} onChange={setMode} label="PAYING BY" />
        ) : null}

        {loading ? (
          <ActivityIndicator color={theme.tint} style={styles.loading} />
        ) : requests.length === 0 ? (
          <EmptyState
            title={scope === 'pending' ? 'Nothing waiting' : 'Nothing here'}
            message={
              scope === 'pending'
                ? 'When someone on your crew asks for an advance, it lands here.'
                : 'Requests you have answered will show up under this tab.'
            }
          />
        ) : (
          requests.map((request) => {
            const name = request.worker_name ?? `Worker #${request.worker_id}`;
            return (
              <Card key={request.id} style={styles.card}>
                <View style={styles.head}>
                  <Avatar name={name} size={38} />
                  <View style={styles.headBody}>
                    <ThemedText type="smallBold" numberOfLines={1}>
                      {name}
                    </ThemedText>
                    <ThemedText type="small" themeColor="textSecondary">
                      {formatRelativeDate(request.created_at.slice(0, 10))}
                    </ThemedText>
                  </View>
                  <ThemedText type="smallBold" style={{ color: theme.text }}>
                    {CURRENCY}
                    {formatMoney(request.amount)}
                  </ThemedText>
                </View>

                {request.reason ? (
                  <ThemedText type="small" themeColor="textSecondary">
                    {request.reason}
                  </ThemedText>
                ) : null}

                {/* A worker on a noisy site is likelier to say why than type
                    it, so the recording is part of the decision. */}
                {request.audio_note_url ? (
                  <AudioNotePlayer url={request.audio_note_url} />
                ) : null}

                {request.status === 'pending' ? (
                  <View style={styles.actions}>
                    <View style={styles.action}>
                      <Button
                        title={busy === request.id ? '…' : 'Approve'}
                        disabled={!isOnline || busy === request.id}
                        onPress={() => void confirmApprove(request)}
                      />
                    </View>
                    <View style={styles.action}>
                      <Button
                        title="Decline"
                        variant="ghost"
                        disabled={!isOnline || busy === request.id}
                        onPress={() => void confirmReject(request)}
                      />
                    </View>
                  </View>
                ) : (
                  <Badge
                    label={request.status === 'approved' ? 'Approved' : 'Declined'}
                    color={request.status === 'approved' ? theme.positive : theme.negative}
                  />
                )}
              </Card>
            );
          })
        )}
      </ScrollView>
    </SafeAreaView>
  );
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
  card: {
    gap: Spacing.two,
  },
  head: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two + 2,
  },
  headBody: {
    flex: 1,
    gap: 1,
  },
  actions: {
    flexDirection: 'row',
    gap: Spacing.two,
  },
  action: {
    flex: 1,
  },
});
