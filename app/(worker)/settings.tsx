import { useRouter } from 'expo-router';
import { ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { AppearanceCard } from '@/components/appearance-card';
import { ScreenHeader } from '@/components/screen-header';
import { ThemedText } from '@/components/themed-text';
import { Avatar, Badge, Button, Card } from '@/components/ui-kit';
import { MaxContentWidth, Spacing } from '@/constants/theme';
import { useAuth } from '@/auth/auth-context';
import { useTheme } from '@/hooks/use-theme';
import { useLanguage } from '@/i18n/language-context';

/**
 * The worker's settings: who they are, how the app looks, and the way out.
 *
 * Separate from the contractor's settings tab rather than shared, because
 * almost nothing on that screen applies here — no crew count, no categories,
 * no API host. What they do share is `AppearanceCard`, which is the part a
 * worker actually needs.
 */
export default function WorkerSettingsScreen() {
  const theme = useTheme();
  const router = useRouter();
  const { user, signOut } = useAuth();
  const { t } = useLanguage();

  return (
    <SafeAreaView style={[styles.screen, { backgroundColor: theme.background }]} edges={['top']}>
      <ScreenHeader title={t('worker.settings')} onBack={() => router.back()} />

      <ScrollView contentContainerStyle={styles.content}>
        <Card style={styles.profile}>
          <Avatar name={user?.name ?? '?'} size={56} />
          <View style={styles.profileBody}>
            <ThemedText type="smallBold" numberOfLines={1}>
              {user?.name}
            </ThemedText>
            {/* Nullable now. A signed-in worker always has one — it is what
                they signed in with — but the type does not know that, and an
                empty line under the name reads as a rendering fault. */}
            <ThemedText type="small" themeColor="textSecondary">
              {user?.phone ?? 'No mobile number'}
            </ThemedText>
          </View>
          <Badge label="Worker" color={theme.tint} />
        </Card>

        <AppearanceCard />

        <Button title={t('worker.signOut')} variant="destructive" onPress={() => void signOut()} />
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
  profile: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
  },
  profileBody: {
    flex: 1,
    gap: 1,
  },
});
