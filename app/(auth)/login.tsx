import { Link } from 'expo-router';
import { useState } from 'react';
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { Button, Card, Field } from '@/components/ui-kit';
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
            <ThemedText type="subtitle">Cashbook</ThemedText>
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
