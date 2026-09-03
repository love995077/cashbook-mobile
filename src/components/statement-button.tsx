import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Button } from '@/components/ui-kit';
import { Spacing } from '@/constants/theme';
import { useAuth } from '@/auth/auth-context';
import { useTheme } from '@/hooks/use-theme';
import { downloadStatement } from '@/lib/statement';

/**
 * Downloads the worker's PDF statement and opens the share sheet.
 *
 * Used from both sides: the worker sharing their own statement, and the
 * contractor sharing one worker's.
 */
export function StatementButton({
  workerId,
  workerName,
  startDate,
  endDate,
  variant = 'secondary',
}: {
  workerId: number;
  workerName: string;
  startDate?: string | null;
  endDate?: string | null;
  variant?: 'primary' | 'secondary';
}) {
  const theme = useTheme();
  const { token } = useAuth();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function run() {
    setError(null);
    setMessage(null);
    setBusy(true);

    try {
      const outcome = await downloadStatement({
        token: token ?? '',
        workerId,
        workerName,
        startDate,
        endDate,
      });

      if (outcome.kind === 'saved') {
        // No share sheet on this device — at least say where the file went.
        setMessage(`Saved to ${outcome.uri}`);
      } else if (outcome.kind === 'downloaded') {
        setMessage('Statement downloaded.');
      }
      // 'shared' needs no message: the share sheet was the feedback.
    } catch (caught) {
      setError((caught as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <View style={styles.wrap}>
      <Button
        title={busy ? 'Preparing…' : 'Download statement'}
        variant={variant}
        loading={busy}
        onPress={() => void run()}
      />
      {error ? (
        <ThemedText type="small" style={[styles.note, { color: theme.negative }]}>
          {error}
        </ThemedText>
      ) : null}
      {message ? (
        <ThemedText type="small" themeColor="textSecondary" style={styles.note}>
          {message}
        </ThemedText>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    gap: Spacing.two,
  },
  note: {
    textAlign: 'center',
  },
});
