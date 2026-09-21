import { Ionicons } from '@expo/vector-icons';
import { StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { Button } from '@/components/ui-kit';
import { Spacing } from '@/constants/theme';
import { useAppLock } from '@/auth/app-lock';
import { useAuth } from '@/auth/auth-context';
import { useTheme } from '@/hooks/use-theme';

/**
 * Covers the app while it is locked.
 *
 * The prompt fires automatically when this appears, so the button is only for
 * a cancelled or failed scan. Sign out is the way past a sensor that will not
 * cooperate at all - it clears the session, and the next login is by password.
 */
export function LockScreen() {
  const theme = useTheme();
  const { unlock, support } = useAppLock();
  const { user, signOut } = useAuth();

  const method = support?.label ?? 'Biometrics';

  return (
    <SafeAreaView style={[styles.screen, { backgroundColor: theme.background }]}>
      <View style={styles.body}>
        <View style={[styles.badge, { backgroundColor: `${theme.tint}1A` }]}>
          <Ionicons
            name={method === 'Face ID' ? 'scan-outline' : 'finger-print-outline'}
            size={40}
            color={theme.tint}
          />
        </View>

        <ThemedText type="smallBold">MoneyMate is locked</ThemedText>
        <ThemedText type="small" themeColor="textSecondary" style={styles.message}>
          {user ? `Unlock with ${method} to see ${user.name}'s books.` : `Unlock with ${method}.`}
        </ThemedText>

        <View style={styles.actions}>
          <Button title={`Unlock with ${method}`} onPress={() => void unlock()} />
          <Button title="Sign out instead" variant="ghost" onPress={() => void signOut()} />
        </View>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
  },
  body: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.two,
    paddingHorizontal: Spacing.four,
  },
  badge: {
    width: 88,
    height: 88,
    borderRadius: 44,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: Spacing.two,
  },
  message: {
    textAlign: 'center',
  },
  actions: {
    alignSelf: 'stretch',
    gap: Spacing.two,
    marginTop: Spacing.four,
    maxWidth: 320,
    width: '100%',
    alignItems: 'stretch',
  },
});
