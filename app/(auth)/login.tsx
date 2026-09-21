import { Link } from 'expo-router';
import { useState } from 'react';
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { Button, Card, Field } from '@/components/ui-kit';
import { UserManualModal } from '@/components/user-manual-modal';
import { MaxContentWidth, Spacing } from '@/constants/theme';
import { API_BASE_URL } from '@/api/client';
import { useAuth } from '@/auth/auth-context';
import { useTheme } from '@/hooks/use-theme';

/**
 * Sign in with phone + password.
 *
 * No redirect happens here — `signIn` sets the user, and `(auth)/_layout.tsx`
 * sees the session and sends them to the dashboard for their role.
 */
export default function LoginScreen() {
  const theme = useTheme();
  const { signIn } = useAuth();

  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [manualOpen, setManualOpen] = useState(false);

  async function submit() {
    setError(null);
    setSubmitting(true);
    try {
      await signIn(phone, password);
    } catch (caught) {
      setError((caught as Error).message);
      setSubmitting(false);
    }
  }

  return (
    <SafeAreaView style={[styles.screen, { backgroundColor: theme.background }]}>
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          <View style={styles.intro}>
            <ThemedText type="subtitle">MoneyMate</ThemedText>
            <ThemedText type="small" themeColor="textSecondary">
              Attendance and wages, in one place.
            </ThemedText>
          </View>

          <Card style={styles.form}>
            <Field
              label="Phone number"
              value={phone}
              onChangeText={setPhone}
              keyboardType="phone-pad"
              autoComplete="tel"
              placeholder="9990001111"
              returnKeyType="next"
            />
            <Field
              label="Password"
              value={password}
              onChangeText={setPassword}
              secureTextEntry
              autoComplete="current-password"
              placeholder="••••••••"
              returnKeyType="done"
              onSubmitEditing={submit}
            />

            {error ? (
              <ThemedText type="small" style={{ color: theme.negative }}>
                {error}
              </ThemedText>
            ) : null}

            <Button title="Log in" onPress={submit} loading={submitting} />
          </Card>

          {/* Below the form, not inside it: this is for someone deciding
              whether the app does what they need, and it should not sit
              between the password field and the button that uses it. */}
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="How to use this app"
            onPress={() => setManualOpen(true)}
            hitSlop={8}
            style={({ pressed }) => [styles.manualLink, pressed && { opacity: 0.6 }]}>
            <ThemedText type="smallBold" style={{ color: theme.tint }}>
              How to Use This App
            </ThemedText>
          </Pressable>

          <View style={styles.footer}>
            <ThemedText type="small" themeColor="textSecondary">
              New here?
            </ThemedText>
            <Link href="/(auth)/register" asChild>
              <Pressable hitSlop={8}>
                <ThemedText type="smallBold" style={{ color: theme.tint }}>
                  Create an account
                </ThemedText>
              </Pressable>
            </Link>
          </View>

          {/* Which backend this build talks to — the most common setup
              problem is a stale LAN IP, so make it visible. */}
          <ThemedText type="small" themeColor="textSecondary" style={styles.apiNote}>
            {API_BASE_URL.replace(/^https?:\/\//, '')}
          </ThemedText>
        </ScrollView>
      </KeyboardAvoidingView>

      <UserManualModal visible={manualOpen} onClose={() => setManualOpen(false)} />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
  },
  flex: {
    flex: 1,
  },
  content: {
    flexGrow: 1,
    justifyContent: 'center',
    gap: Spacing.four,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.five,
    maxWidth: MaxContentWidth,
    width: '100%',
    alignSelf: 'center',
  },
  intro: {
    gap: Spacing.one,
  },
  form: {
    gap: Spacing.three,
  },
  manualLink: {
    alignSelf: 'center',
    // Negative pull against the container's gap: the link belongs to the form
    // above it, not to the sign-up row below.
    marginTop: -Spacing.two,
  },
  footer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.two,
  },
  apiNote: {
    textAlign: 'center',
  },
});
