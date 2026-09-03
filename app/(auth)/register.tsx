import { useRouter } from 'expo-router';
import { useState } from 'react';
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { Button, Card, Field, Segmented } from '@/components/ui-kit';
import { MaxContentWidth, Spacing } from '@/constants/theme';
import { useAuth } from '@/auth/auth-context';
import type { UserRole } from '@/data/types';
import { useTheme } from '@/hooks/use-theme';

const ROLES: { value: UserRole; label: string }[] = [
  { value: 'contractor', label: 'Contractor' },
  { value: 'worker', label: 'Worker' },
];

/**
 * Create an account. The chosen role decides which dashboard the user lands
 * on, via the same guard that handles login.
 */
export default function RegisterScreen() {
  const theme = useTheme();
  const router = useRouter();
  const { signUp } = useAuth();

  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [role, setRole] = useState<UserRole>('contractor');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function submit() {
    setError(null);

    if (!name.trim()) {
      setError('Enter your name');
      return;
    }

    setSubmitting(true);
    try {
      await signUp({ name, phone, password, role });
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
            <ThemedText type="subtitle">Create account</ThemedText>
            <ThemedText type="small" themeColor="textSecondary">
              Contractors manage a crew. Workers see their own ledger.
            </ThemedText>
          </View>

          <Card style={styles.form}>
            <View style={styles.section}>
              <ThemedText type="smallBold" themeColor="textSecondary">
                I AM A
              </ThemedText>
              <Segmented options={ROLES} value={role} onChange={setRole} />
            </View>

            <Field
              label="Full name"
              value={name}
              onChangeText={setName}
              autoComplete="name"
              placeholder="Ramesh Yadav"
              returnKeyType="next"
            />
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
              autoComplete="new-password"
              placeholder="••••••••"
              hint="At least 6 characters"
              returnKeyType="done"
              onSubmitEditing={submit}
            />

            {error ? (
              <ThemedText type="small" style={{ color: theme.negative }}>
                {error}
              </ThemedText>
            ) : null}

            <Button title="Create account" onPress={submit} loading={submitting} />
          </Card>

          <View style={styles.footer}>
            <ThemedText type="small" themeColor="textSecondary">
              Already have an account?
            </ThemedText>
            <Pressable hitSlop={8} onPress={() => router.back()}>
              <ThemedText type="smallBold" style={{ color: theme.tint }}>
                Log in
              </ThemedText>
            </Pressable>
          </View>
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
  section: {
    gap: Spacing.two,
  },
  footer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.two,
  },
});
