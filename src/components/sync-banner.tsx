import { Pressable, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Radius, Spacing } from '@/constants/theme';
import { useStore } from '@/data/store';
import { useTheme } from '@/hooks/use-theme';

/**
 * One line explaining the connection and anything waiting to sync.
 *
 * Renders nothing when everything is online and settled — a permanent
 * "connected" badge is noise. It deliberately does NOT fake the balance for
 * queued entries: the number on screen stays the one the server last
 * confirmed, and this says what has not reached it yet.
 */
export function SyncBanner() {
  const theme = useTheme();
  const { isOnline, pending, syncing, failures, dismissFailures, isStale, cachedAt } = useStore();

  if (failures.length > 0) {
    return (
      <Pressable onPress={dismissFailures} style={[styles.banner, { backgroundColor: `${theme.negative}1A` }]}>
        <ThemedText type="smallBold" style={{ color: theme.negative }}>
          {failures.length} {failures.length === 1 ? 'entry' : 'entries'} could not be saved
        </ThemedText>
        {failures.slice(0, 2).map((item) => (
          <ThemedText key={item.clientRef} type="small" themeColor="textSecondary">
            • {item.failure ?? 'Unknown error'}
          </ThemedText>
        ))}
        <ThemedText type="small" themeColor="textSecondary">
          Tap to dismiss.
        </ThemedText>
      </Pressable>
    );
  }

  if (syncing) {
    return (
      <View style={[styles.banner, { backgroundColor: `${theme.tint}1A` }]}>
        <ThemedText type="smallBold" style={{ color: theme.tint }}>
          Syncing {pending.length} {pending.length === 1 ? 'entry' : 'entries'}…
        </ThemedText>
      </View>
    );
  }

  if (!isOnline) {
    return (
      <View style={[styles.banner, { backgroundColor: `${theme.warning}1A` }]}>
        <ThemedText type="smallBold" style={{ color: theme.warning }}>
          Offline
        </ThemedText>
        <ThemedText type="small" themeColor="textSecondary">
          {pending.length > 0
            ? `${pending.length} ${pending.length === 1 ? 'entry' : 'entries'} will be sent when you are back online.`
            : 'Showing the last saved copy. New entries will be saved and sent later.'}
          {cachedAt ? ` Last updated ${describeAge(cachedAt)}.` : ''}
        </ThemedText>
      </View>
    );
  }

  if (pending.length > 0) {
    return (
      <View style={[styles.banner, { backgroundColor: `${theme.warning}1A` }]}>
        <ThemedText type="smallBold" style={{ color: theme.warning }}>
          {pending.length} {pending.length === 1 ? 'entry' : 'entries'} waiting to sync
        </ThemedText>
      </View>
    );
  }

  if (isStale) {
    return (
      <View style={[styles.banner, { backgroundColor: `${theme.warning}1A` }]}>
        <ThemedText type="small" themeColor="textSecondary">
          Could not reach the server. Showing the last saved copy
          {cachedAt ? ` from ${describeAge(cachedAt)}` : ''}.
        </ThemedText>
      </View>
    );
  }

  return null;
}

function describeAge(timestamp: number): string {
  const minutes = Math.round((Date.now() - timestamp) / 60_000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} ${hours === 1 ? 'hour' : 'hours'} ago`;
  const days = Math.round(hours / 24);
  return `${days} ${days === 1 ? 'day' : 'days'} ago`;
}

const styles = StyleSheet.create({
  banner: {
    gap: Spacing.half,
    paddingVertical: Spacing.two,
    paddingHorizontal: Spacing.three,
    borderRadius: Radius.medium,
  },
});
