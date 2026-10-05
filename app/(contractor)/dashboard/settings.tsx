import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Switch, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { AppearanceCard } from '@/components/appearance-card';
import { ScreenHeader } from '@/components/screen-header';
import { ThemedText } from '@/components/themed-text';
import { Avatar, Badge, Button, Card } from '@/components/ui-kit';
import { BottomTabInset, MaxContentWidth, Spacing } from '@/constants/theme';
import { API_BASE_URL } from '@/api/client';
import { useAppLock } from '@/auth/app-lock';
import { useAuth } from '@/auth/auth-context';
import { useStore } from '@/data/store';
import { isAdmin } from '@/data/types';
import { useTheme } from '@/hooks/use-theme';

/**
 * Settings, for whoever is signed in.
 *
 * The money rows — expense categories, reports and exports, invoicing — are
 * admin only and are not rendered at all for a supervisor, who would get a
 * 403 from every one of them. The rows that remain (appearance, biometrics,
 * the API, sign out) belong to the device rather than to the business.
 */
export default function SettingsScreen() {
  const theme = useTheme();
  const router = useRouter();
  const { user, signOut } = useAuth();
  const { workers, categories } = useStore();
  const { enabled, support, setEnabled } = useAppLock();

  const admin = isAdmin(user?.role);

  const [lockBusy, setLockBusy] = useState(false);
  const [lockError, setLockError] = useState<string | null>(null);

  const method = support?.label ?? 'Biometrics';
  const unavailable = support ? !support.hasHardware : false;

  async function toggleLock(next: boolean) {
    setLockError(null);
    setLockBusy(true);
    const result = await setEnabled(next);
    setLockBusy(false);
    if (!result.ok && result.message) setLockError(result.message);
  }

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
          {/* "Contractor" rather than "Admin": the role is called admin on
              the wire, but the word the user recognises for themselves is the
              one they put on their invoices. */}
          <Badge label={admin ? 'Contractor' : 'Supervisor'} color={theme.tint} />
        </Card>

        <AppearanceCard />

        <Card style={styles.rows}>
          <View style={styles.lockRow}>
            <View style={styles.lockBody}>
              <ThemedText type="small">Biometric authentication</ThemedText>
              <ThemedText type="small" themeColor="textSecondary">
                {unavailable
                  ? 'Not available on this device.'
                  : `Lock the app with ${method} when you have been away for a while.`}
              </ThemedText>
            </View>
            <Switch
              accessibilityLabel="Biometric authentication"
              value={enabled === true}
              onValueChange={(next) => void toggleLock(next)}
              disabled={lockBusy || enabled === null || unavailable}
              trackColor={{ true: theme.tint, false: theme.backgroundSelected }}
            />
          </View>
          {lockError ? (
            <ThemedText type="small" style={[styles.lockError, { color: theme.negative }]}>
              {lockError}
            </ThemedText>
          ) : null}
        </Card>

        {admin ? (
          <Card style={styles.rows}>
            <LinkRow
              icon="pricetags-outline"
              label="Expense categories"
              value={`${categories.filter((category) => category.is_active).length}`}
              onPress={() => router.push('/(contractor)/categories')}
            />
            <View style={[styles.divider, { backgroundColor: theme.border }]} />
            <LinkRow
              icon="document-text-outline"
              label="Client invoicing"
              value="Bill a site"
              onPress={() => router.push('/(contractor)/invoices')}
            />
            <View style={[styles.divider, { backgroundColor: theme.border }]} />
            <LinkRow
              icon="download-outline"
              label="Reports and exports"
              value="PDF, Excel"
              onPress={() => router.push('/(contractor)/reports')}
            />
            <View style={[styles.divider, { backgroundColor: theme.border }]} />
            <LinkRow
              icon="checkmark-done-outline"
              label="Check the books"
              value="Wages vs attendance"
              onPress={() => router.push('/(contractor)/ledger-check')}
            />
          </Card>
        ) : null}

        <Card style={styles.rows}>
          <Row label={admin ? 'Workers' : 'Crew on your site'} value={String(workers.length)} />
          <View style={[styles.divider, { backgroundColor: theme.border }]} />
          <Row label="API" value={API_BASE_URL.replace(/^https?:\/\//, '')} />
          <View style={[styles.divider, { backgroundColor: theme.border }]} />
          <Row label="App version" value="1.0.0" />
        </Card>

        <Button title="Sign out" variant="destructive" onPress={() => void signOut()} />

        <ThemedText type="small" themeColor="textSecondary" style={styles.footnote}>
          Signed in with a token stored on this device. Signing out clears it, along with the
          cached ledger.
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

function LinkRow({
  icon,
  label,
  value,
  onPress,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  value?: string;
  onPress: () => void;
}) {
  const theme = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => [styles.row, pressed ? { opacity: 0.6 } : null]}>
      <View style={styles.linkLabel}>
        <Ionicons name={icon} size={18} color={theme.tint} />
        <ThemedText type="small">{label}</ThemedText>
      </View>
      <View style={styles.linkValue}>
        {value ? (
          <ThemedText type="small" themeColor="textSecondary">
            {value}
          </ThemedText>
        ) : null}
        <Ionicons name="chevron-forward" size={16} color={theme.textSecondary} />
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
  },
  content: {
    gap: Spacing.three,
    paddingHorizontal: Spacing.three,
    paddingBottom: BottomTabInset + Spacing.five,
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
  lockRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.three,
    paddingVertical: Spacing.two,
  },
  lockBody: {
    flex: 1,
    gap: 1,
  },
  lockError: {
    paddingBottom: Spacing.two,
  },
  linkLabel: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
  },
  linkValue: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.one,
  },
  divider: {
    height: StyleSheet.hairlineWidth,
  },
  footnote: {
    textAlign: 'center',
  },
});
