import { ActivityIndicator, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Button } from '@/components/ui-kit';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

/** Full-screen spinner for a first load, when there is nothing to show yet. */
export function LoadingState({ label = 'Loading…' }: { label?: string }) {
  const theme = useTheme();
  return (
    <View style={styles.centered}>
      <ActivityIndicator color={theme.tint} size="large" />
      <ThemedText type="small" themeColor="textSecondary">
        {label}
      </ThemedText>
    </View>
  );
}

/**
 * A failed load, with a way out. Network failures get the longer explanation
 * from the client (which host it tried) since a wrong IP is the most common
 * cause during development.
 */
export function ErrorState({ message, onRetry }: { message: string; onRetry: () => void }) {
  const theme = useTheme();
  return (
    <View style={styles.centered}>
      <ThemedText type="smallBold" style={{ color: theme.negative }}>
        Could not load
      </ThemedText>
      <ThemedText type="small" themeColor="textSecondary" style={styles.message}>
        {message}
      </ThemedText>
      <View style={styles.action}>
        <Button title="Try again" onPress={onRetry} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  centered: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.two,
    padding: Spacing.four,
  },
  message: {
    textAlign: 'center',
  },
  action: {
    marginTop: Spacing.two,
    alignSelf: 'stretch',
    maxWidth: 260,
  },
});
