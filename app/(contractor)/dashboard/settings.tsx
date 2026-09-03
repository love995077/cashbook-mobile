import { ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ScreenHeader } from '@/components/screen-header';
import { ThemedText } from '@/components/themed-text';
import { Avatar, Badge, Button, Card } from '@/components/ui-kit';
import { MaxContentWidth, Spacing } from '@/constants/theme';
import { API_BASE_URL } from '@/api/client';
import { useAuth } from '@/auth/auth-context';
import { useStore } from '@/data/store';
import { useTheme } from '@/hooks/use-theme';

export default function SettingsScreen() {
  const theme = useTheme();
  const { user, signOut } = useAuth();
  const { workers } = useStore();

  return (
    <SafeAreaView style={[styles.screen, { backgroundColor: theme.background }]} edges={['top']}>
      <ScrollView contentContainerStyle={styles.content}>
        <ScreenHeader title="Settings" />

        <Card style={styles.profile}>
          <Avatar name={user?.name ?? '?'} size={56} />
          <View style={styles.profileBody}>
            <ThemedText type="smallBold" numberOfLines={1}>
              {user?.name}
            </ThemedText>
            <ThemedText type="small" themeColor="textSecondary">
              {user?.phone}
            </ThemedText>
          </View>
          <Badge label="Contractor" color={theme.tint} />
        </Card>

        <Card style={styles.rows}>
          <Row label="Workers" value={String(workers.length)} />
          <View style={[styles.divider, { backgroundColor: theme.border }]} />
          <Row label="API" value={API_BASE_URL.replace(/^https?:\/\//, '')} />
          <View style={[styles.divider, { backgroundColor: theme.border }]} />
          <Row label="App version" value="1.0.0" />
        </Card>

        <Button title="Sign out" variant="destructive" onPress={() => void signOut()} />

        <ThemedText type="small" themeColor="textSecondary" style={styles.footnote}>
          Signed in with a token stored on this device. Signing out clears it.
        </ThemedText>
      </ScrollView>
    </SafeAreaView>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.row}>
      <ThemedText type="small">{label}</ThemedText>
      <ThemedText type="small" themeColor="textSecondary">
        {value}
      </ThemedText>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
  },
  content: {
    gap: Spacing.three,
    paddingHorizontal: Spacing.three,
    paddingBottom: Spacing.five,
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
  rows: {
    paddingVertical: Spacing.one,
  },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: Spacing.two + 2,
  },
  divider: {
    height: StyleSheet.hairlineWidth,
  },
  footnote: {
    textAlign: 'center',
  },
});
