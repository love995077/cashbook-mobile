import { useRouter } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { FlatList, RefreshControl, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import QRCode from 'react-native-qrcode-svg';

import type { WorkerProfile } from '@/api/endpoints';
import { BalanceCard } from '@/components/balance-card';
import { LedgerRow } from '@/components/ledger-row';
import { ErrorState, LoadingState } from '@/components/load-state';
import { MySiteCard } from '@/components/my-site-card';
import { RequestAdvanceModal } from '@/components/request-advance-modal';
import { ScreenHeader } from '@/components/screen-header';
import { SiteSnapButton } from '@/components/site-snap-button';
import { StatementButton } from '@/components/statement-button';
import { SyncBanner } from '@/components/sync-banner';
import { ThemedText } from '@/components/themed-text';
import { Badge, Button, Card, EmptyState } from '@/components/ui-kit';
import { MaxContentWidth, Radius, Spacing } from '@/constants/theme';
import { useStore } from '@/data/store';
import type { AdvanceRequest } from '@/data/types';
import { useTheme } from '@/hooks/use-theme';
import { useGreeting, useLanguage } from '@/i18n/language-context';
import { useAuth } from '@/auth/auth-context';
import { confirm, notify } from '@/lib/dialog';
import { CURRENCY, formatMoney, formatRelativeDate } from '@/lib/money';

/**
 * The worker's own screen: what they are owed, and the four things they can
 * actually do about it.
 *
 * Was read-only until Phase 6. The additions are all things a worker needs
 * without going through their contractor: their ID at the gate, where the
 * site is, asking for an advance, and flagging a day that was recorded wrong.
 *
 * The ID and the site come from GET /worker/me rather than the ledger, which
 * carries neither. It is fetched alongside rather than blocking: a worker with
 * no signal should still see the balance the cache already holds.
 */
export default function WorkerDashboardScreen() {
  const theme = useTheme();
  const router = useRouter();
  const { t } = useLanguage();
  const greeting = useGreeting();
  const { user } = useAuth();
  const {
    myLedger,
    loading,
    refreshing,
    error,
    refresh,
    getMyProfile,
    getMyAdvanceRequests,
    disputeAttendance,
    isOnline,
  } = useStore();

  const [profile, setProfile] = useState<WorkerProfile | null>(null);
  const [requests, setRequests] = useState<AdvanceRequest[]>([]);
  const [asking, setAsking] = useState(false);
  const [sideError, setSideError] = useState<string | null>(null);

  const loadSide = useCallback(
    async (controller?: AbortController) => {
      try {
        const [me, mine] = await Promise.all([
          getMyProfile(controller?.signal),
          getMyAdvanceRequests(controller?.signal),
        ]);
        if (controller?.signal.aborted) return;
        setProfile(me);
        setRequests(mine);
        setSideError(null);
      } catch (caught) {
        // Non-fatal: the balance and history below come from the ledger and
        // are already on screen.
        if (!controller?.signal.aborted) setSideError((caught as Error).message);
      }
    },
    [getMyProfile, getMyAdvanceRequests]
  );

  useEffect(() => {
    const controller = new AbortController();
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void loadSide(controller);
    return () => controller.abort();
  }, [loadSide]);

  async function confirmDispute(attendanceId: number) {
    const ok = await confirm({
      title: t('worker.disputeTitle'),
      message: t('worker.disputeBody'),
      confirmLabel: t('worker.flag'),
      cancelLabel: t('common.cancel'),
    });
    if (!ok) return;

    try {
      await disputeAttendance(attendanceId);
    } catch (caught) {
      const message = (caught as Error).message;
      setSideError(message);
      notify(t('worker.disputeTitle'), message);
    }
  }

  const pending = requests.find((request) => request.status === 'pending');
  // Profile first, session as the fallback: the QR must still draw on a cold
  // start with no signal, and the id is the one thing the session already has.
  const workerId = profile?.id ?? user?.id ?? null;

  const body = () => {
    if (loading && !myLedger) return <LoadingState label="Loading your ledger…" />;
    if (error && !myLedger) return <ErrorState message={error} onRetry={refresh} />;

    return (
      <FlatList
        data={myLedger?.entries ?? []}
        keyExtractor={(entry) => `${entry.kind}-${entry.id}`}
        contentContainerStyle={styles.content}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => {
              void refresh();
              void loadSide();
            }}
            tintColor={theme.tint}
          />
        }
        ListHeaderComponent={
          <View style={styles.headerBlock}>
            <View style={styles.cardWrap}>
              <SyncBanner />
            </View>

            {/* The gate pass.
                
                The QR encodes the bare worker id, which is exactly what
                POST /contractor/attendance/scan takes. Not a signed token or a
                URL: the contractor's app is already authenticated and proves
                the worker is on its own crew server-side, so there is nothing
                for a copied code to unlock — and a plain integer survives a
                cracked screen and a cheap camera far better.

                Always rendered on white with a dark foreground regardless of
                theme. Scanners read contrast, not palettes, and an inverted QR
                in dark mode is a code that will not scan. */}
            <View style={styles.cardWrap}>
              <Card style={styles.idCard}>
                <ThemedText type="smallBold" themeColor="textSecondary">
                  {t('worker.myId')}
                </ThemedText>

                {workerId ? (
                  <View style={styles.qrFrame}>
                    <QRCode
                      value={String(workerId)}
                      size={168}
                      backgroundColor="#FFFFFF"
                      color="#000000"
                    />
                  </View>
                ) : null}

                <ThemedText style={[styles.idNumber, { color: theme.tint }]}>
                  #{workerId ?? '—'}
                </ThemedText>
                <ThemedText type="small" themeColor="textSecondary" style={styles.idHint}>
                  {t('worker.showAtGate')}
                </ThemedText>
              </Card>
            </View>

            {myLedger ? (
              <View style={styles.cardWrap}>
                <BalanceCard balance={myLedger.balance} />
              </View>
            ) : null}

            <View style={styles.cardWrap}>
              <MySiteCard site={profile?.site ?? null} />
            </View>

            <View style={styles.cardWrap}>
              <SiteSnapButton
                hasSite={!!profile?.site}
                onUploaded={() => void loadSide()}
              />
            </View>

            <View style={styles.cardWrap}>
              <Button
                title={t('worker.requestAdvance')}
                disabled={!isOnline || !!pending}
                onPress={() => setAsking(true)}
              />
              {pending ? (
                <ThemedText
                  type="small"
                  themeColor="textSecondary"
                  style={styles.pendingNote}>
                  You asked for {CURRENCY}
                  {formatMoney(pending.amount)} on {formatRelativeDate(pending.created_at.slice(0, 10))}.
                  Waiting for an answer.
                </ThemedText>
              ) : null}
            </View>

            {requests.length ? (
              <View style={styles.cardWrap}>
                <Card style={styles.requestsCard}>
                  <ThemedText type="smallBold" themeColor="textSecondary">
                    {t('worker.myRequests')}
                  </ThemedText>
                  {requests.slice(0, 5).map((request) => (
                    <View key={request.id} style={styles.requestRow}>
                      <View style={styles.requestBody}>
                        <ThemedText type="small">
                          {CURRENCY}
                          {formatMoney(request.amount)}
                        </ThemedText>
                        <ThemedText type="small" themeColor="textSecondary" numberOfLines={1}>
                          {request.reason ?? formatRelativeDate(request.created_at.slice(0, 10))}
                        </ThemedText>
                      </View>
                      <Badge
                        label={t(`worker.${request.status}` as const)}
                        color={
                          {
                            pending: theme.warning,
                            approved: theme.positive,
                            rejected: theme.negative,
                          }[request.status]
                        }
                      />
                    </View>
                  ))}
                </Card>
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
            {(error && myLedger) || sideError ? (
              <ThemedText type="small" style={[styles.inlineError, { color: theme.negative }]}>
                {error ?? sideError}
              </ThemedText>
            ) : null}

            <ThemedText type="smallBold" themeColor="textSecondary" style={styles.sectionLabel}>
              {t('worker.history').toUpperCase()}
            </ThemedText>
          </View>
        }
        renderItem={({ item }) => (
          <LedgerRow
            entry={item}
            // Only attendance can be disputed, and only while online.
            onDispute={
              item.kind === 'attendance' && isOnline
                ? (attendanceId) => void confirmDispute(attendanceId)
                : undefined
            }
          />
        )}
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
        title={user?.name ?? 'Ledger'}
        greeting={{ name: user?.name ?? 'there', salutation: greeting }}
        icons={[
          {
            name: 'settings-outline',
            accessibilityLabel: t('worker.settings'),
            onPress: () => router.push('/(worker)/settings'),
          },
        ]}
      />
      {body()}

      <RequestAdvanceModal
        visible={asking}
        onClose={() => setAsking(false)}
        onSubmitted={() => void loadSide()}
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
  cardWrap: {
    paddingHorizontal: Spacing.three,
    gap: Spacing.two,
  },
  idCard: {
    alignItems: 'center',
    gap: Spacing.two,
  },
  qrFrame: {
    // The quiet zone. A QR printed hard against a coloured card loses its
    // margin and stops decoding on a cheap sensor.
    backgroundColor: '#FFFFFF',
    padding: Spacing.three,
    borderRadius: Radius.medium,
  },
  idNumber: {
    fontSize: 40,
    lineHeight: 46,
    fontWeight: '800',
    letterSpacing: -1,
  },
  idHint: {
    textAlign: 'center',
  },
  pendingNote: {
    textAlign: 'center',
  },
  requestsCard: {
    gap: Spacing.two,
  },
  requestRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
  },
  requestBody: {
    flex: 1,
    gap: 1,
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
