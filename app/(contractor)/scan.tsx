import { CameraView, useCameraPermissions } from 'expo-camera';
import { useRouter } from 'expo-router';
import { useCallback, useRef, useState } from 'react';
import { Platform, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ScreenHeader } from '@/components/screen-header';
import { ThemedText } from '@/components/themed-text';
import { Avatar, Button, Card, EmptyState } from '@/components/ui-kit';
import { MaxContentWidth, Radius, Spacing } from '@/constants/theme';
import { useStore } from '@/data/store';
import { useTheme } from '@/hooks/use-theme';

/** How long the same code is ignored after a successful scan. */
const COOLDOWN_MS = 2500;

type Scanned = { workerId: number; name: string; at: number };

/**
 * Mark the crew present by scanning their ID at the gate.
 *
 * THE DEBOUNCE IS THE WHOLE PROBLEM
 * ---------------------------------
 * `onBarcodeScanned` fires every frame the code is in view — thirty times a
 * second for as long as someone holds their phone up. Without a guard that is
 * thirty POSTs per worker.
 *
 * Two guards, because they cover different failures. `busyRef` is a synchronous
 * ref rather than state: setState is async, so two frames can both read
 * `busy === false` before either render lands, and a ref closes that window.
 * `lastRef` then ignores the SAME id for a couple of seconds afterwards, which
 * is what stops a contractor walking down a line from re-marking the person
 * they just did.
 *
 * The endpoint is an idempotent upsert as well, so a scan that slips through
 * both is still harmless — this only saves the network round trips.
 */
export default function ScanScreen() {
  const theme = useTheme();
  const router = useRouter();
  const { workers, scanAttendance, isOnline } = useStore();

  const [permission, requestPermission] = useCameraPermissions();
  const [recent, setRecent] = useState<Scanned[]>([]);
  const [error, setError] = useState<string | null>(null);

  const busyRef = useRef(false);
  const lastRef = useRef<{ value: string; at: number } | null>(null);

  const onScanned = useCallback(
    ({ data }: { data: string }) => {
      const now = Date.now();
      if (busyRef.current) return;
      if (lastRef.current?.value === data && now - lastRef.current.at < COOLDOWN_MS) return;

      // The QR carries the bare worker id and nothing else.
      const workerId = Number.parseInt(data.trim(), 10);
      if (!Number.isFinite(workerId) || workerId <= 0) {
        setError('That is not a MoneyMate worker code.');
        lastRef.current = { value: data, at: now };
        return;
      }

      busyRef.current = true;
      lastRef.current = { value: data, at: now };

      void (async () => {
        setError(null);
        try {
          const marked = await scanAttendance(workerId);
          const name =
            workers.find((worker) => worker.id === marked.worker_id)?.name ??
            `Worker #${marked.worker_id}`;
          setRecent((current) => [
            { workerId: marked.worker_id, name, at: Date.now() },
            ...current.filter((row) => row.workerId !== marked.worker_id),
          ]);
        } catch (caught) {
          // A worker from another crew reads as a 404, which is the right
          // answer to show: this badge is not yours to mark.
          setError((caught as Error).message);
        } finally {
          busyRef.current = false;
        }
      })();
    },
    [scanAttendance, workers]
  );

  const canScan = permission?.granted && isOnline;

  return (
    <SafeAreaView style={[styles.screen, { backgroundColor: theme.background }]} edges={['top']}>
      <ScreenHeader
        title="Scan"
        subtitle={recent.length ? `${recent.length} marked present` : 'Point at a worker’s ID'}
        onBack={() => router.back()}
      />

      <View style={styles.content}>
        {!permission ? null : !permission.granted ? (
          <EmptyState
            title="Camera access needed"
            message="The scanner reads a worker's ID code to mark them present. Nothing is recorded until a code is read."
            action={{ label: 'Allow camera', onPress: () => void requestPermission() }}
          />
        ) : Platform.OS === 'web' ? (
          // The web build has no expo-camera barcode pipeline; saying so beats
          // rendering a dead black rectangle.
          <EmptyState
            title="Scanning needs the mobile app"
            message="Open MoneyMate on your phone to scan worker IDs. Everything else on this screen works here."
          />
        ) : (
          <View style={[styles.viewfinder, { borderColor: theme.border }]}>
            <CameraView
              style={StyleSheet.absoluteFill}
              facing="back"
              barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
              onBarcodeScanned={canScan ? onScanned : undefined}
            />
            <View style={[styles.reticle, { borderColor: theme.tint }]} />
          </View>
        )}

        {!isOnline ? (
          <ThemedText type="small" style={{ color: theme.warning }}>
            You are offline. Marking attendance by scan needs a connection.
          </ThemedText>
        ) : null}

        {error ? (
          <ThemedText type="small" style={{ color: theme.negative }}>
            {error}
          </ThemedText>
        ) : null}

        {recent.length ? (
          <Card style={styles.recent}>
            <ThemedText type="smallBold" themeColor="textSecondary">
              MARKED PRESENT
            </ThemedText>
            {recent.slice(0, 6).map((row) => (
              <View key={row.workerId} style={styles.recentRow}>
                <Avatar name={row.name} size={30} />
                <ThemedText type="small" numberOfLines={1} style={styles.recentName}>
                  {row.name}
                </ThemedText>
                <ThemedText type="small" style={{ color: theme.positive }}>
                  ✓
                </ThemedText>
              </View>
            ))}
          </Card>
        ) : null}

        <Button title="Done" variant="secondary" onPress={() => router.back()} />
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
  },
  content: {
    flex: 1,
    gap: Spacing.three,
    paddingHorizontal: Spacing.three,
    paddingBottom: Spacing.four,
    maxWidth: MaxContentWidth,
    width: '100%',
    alignSelf: 'center',
  },
  viewfinder: {
    flex: 1,
    borderRadius: Radius.large,
    borderWidth: StyleSheet.hairlineWidth,
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
  },
  reticle: {
    width: '65%',
    aspectRatio: 1,
    borderWidth: 3,
    borderRadius: Radius.medium,
    opacity: 0.9,
  },
  recent: {
    gap: Spacing.two,
  },
  recentRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two + 2,
  },
  recentName: {
    flex: 1,
  },
});
