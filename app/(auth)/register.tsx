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
  // 'admin' on the wire; 'Contractor' is the word the user recognises.
  { value: 'admin', label: 'Contractor' },
  { value: 'supervisor', label: 'Supervisor' },
  { value: 'worker', label: 'Worker' },
];

const BLURB: Record<UserRole, string> = {
  admin: 'Contractors manage a crew, every site, and all the money.',
  supervisor:
    'A supervisor runs one site: attendance, tools, deliveries and machinery. They never see the cash box or payroll.',
  worker: 'Workers see their own ledger and nothing else.',
};

/**
 * Create an account. The chosen role decides which dashboard the user lands
 * on, via the same guard that handles login.
 *
 * A supervisor is the only role that has to say who they work for at sign-up.
 * A contractor belongs to nobody, and a worker is normally created FOR them
 * from the contractor's Workers screen, which fills the link in server-side.
 * A supervisor has no such screen — they are the account a contractor then
 * assigns to a site — so the id is asked for here.
 */
export default function RegisterScreen() {
  const theme = useTheme();
  const router = useRouter();
  const { signUp } = useAuth();

  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [role, setRole] = useState<UserRole>('admin');
  const [contractorId, setContractorId] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function submit() {
    setError(null);

    if (!name.trim()) {
      setError('Enter your name');
      return;
    }

    let linkedTo: number | null = null;
    if (role === 'supervisor') {
      linkedTo = Number.parseInt(contractorId.trim(), 10);
      if (!Number.isFinite(linkedTo) || linkedTo <= 0) {
        setError('Enter the contractor id you were given');
        return;
      }
    }

    setSubmitting(true);
    try {
      await signUp({ name, phone, password, role, contractor_id: linkedTo });
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
              {BLURB[role]}
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
            {role === 'supervisor' ? (
              <Field
                label="Contractor id"
                value={contractorId}
                onChangeText={setContractorId}
                keyboardType="number-pad"
                placeholder="1"
                hint="Ask your contractor for this. It links your account to their sites."
                returnKeyType="next"
              />
            ) : null}

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
