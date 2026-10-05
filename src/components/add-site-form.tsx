import { useRouter } from 'expo-router';
import { useState } from 'react';
import { StyleSheet } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Button, Card, Field } from '@/components/ui-kit';
import { Spacing } from '@/constants/theme';
import { useStore } from '@/data/store';
import { useTheme } from '@/hooks/use-theme';

/**
 * Two fields and a button: a new job.
 *
 * Inline rather than a modal - a site is a name and an address, and a
 * contractor setting up for the first time is looking at an empty Home with
 * nothing else to press. On success it goes straight into the new site,
 * because a site is created in order to do something on it: post the crew,
 * mark the first day.
 */
export function AddSiteForm({ onCancel }: { onCancel: () => void }) {
  const theme = useTheme();
  const router = useRouter();
  const { addSite, isOnline } = useStore();

  const [name, setName] = useState('');
  const [address, setAddress] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    const trimmed = name.trim();
    if (!trimmed) {
      setError('Give the site a name');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const created = await addSite({ name: trimmed, address: address.trim() || null });
      onCancel();
      router.push({ pathname: '/(contractor)/site/[id]', params: { id: String(created.id) } });
    } catch (caught) {
      // Stay open — a 409 on a duplicate name is the common one here.
      setError((caught as Error).message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card style={styles.form}>
      <Field
        label="Site name"
        value={name}
        onChangeText={setName}
        placeholder="Udaipur Villa"
        autoCapitalize="words"
        maxLength={120}
        returnKeyType="next"
      />
      <Field
        label="Address (optional)"
        value={address}
        onChangeText={setAddress}
        placeholder="Sector 4, Udaipur"
        maxLength={255}
        hint="Used for the directions button."
        returnKeyType="done"
        onSubmitEditing={() => void submit()}
      />
      {!isOnline ? (
        <ThemedText type="small" style={{ color: theme.warning }}>
          Adding a site needs a connection.
        </ThemedText>
      ) : null}
      {error ? (
        <ThemedText type="small" style={{ color: theme.negative }}>
          {error}
        </ThemedText>
      ) : null}
      <Button
        title="Add site"
        onPress={() => void submit()}
        loading={saving}
        disabled={!isOnline}
      />
      <Button title="Cancel" variant="ghost" onPress={onCancel} disabled={saving} />
    </Card>
  );
}

const styles = StyleSheet.create({
  form: {
    gap: Spacing.three,
  },
});
