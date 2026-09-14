import { useState } from 'react';
import { KeyboardAvoidingView, Modal, Platform, ScrollView, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ScreenHeader } from '@/components/screen-header';
import { ThemedText } from '@/components/themed-text';
import { Button, Card, Field } from '@/components/ui-kit';
import { MaxContentWidth, Spacing } from '@/constants/theme';
import { useStore } from '@/data/store';
import { useTheme } from '@/hooks/use-theme';
import { useLanguage } from '@/i18n/language-context';
import { CURRENCY, formatMoney } from '@/lib/money';

/**
 * A worker asking for money before payday.
 *
 * NOTHING REACHES THE LEDGER HERE
 * -------------------------------
 * The amount only becomes a transaction if and when the contractor approves
 * it, which is why this does not touch the balance on screen and why the
 * copy says "asked for" rather than "taken". A worker who thinks the money is
 * already theirs will spend it.
 *
 * The API allows one open request at a time and answers 409 for a second. That
 * is surfaced as-is rather than pre-empted: the contractor may have just
 * answered the first one, and the server is the only thing that knows.
 */
export function RequestAdvanceModal({
  visible,
  onClose,
  onSubmitted,
}: {
  visible: boolean;
  onClose: () => void;
  onSubmitted?: () => void;
}) {
  const theme = useTheme();
  const { t } = useLanguage();
  const { requestAdvance, myLedger, isOnline } = useStore();

  const [amount, setAmount] = useState('');
  const [reason, setReason] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function reset() {
    setAmount('');
    setReason('');
    setError(null);
  }

  async function submit() {
    setError(null);

    const value = Number.parseFloat(amount);
    if (!Number.isFinite(value) || value <= 0) {
      setError('How much do you need?');
      return;
    }

    setSaving(true);
    try {
      await requestAdvance({ amount: value, reason: reason.trim() || null });
      reset();
      onSubmitted?.();
      onClose();
    } catch (caught) {
      setError((caught as Error).message);
    } finally {
      setSaving(false);
    }
  }

  const owed = myLedger?.balance.balance ?? 0;

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={onClose}>
      <SafeAreaView style={[styles.screen, { backgroundColor: theme.background }]}>
        <ScreenHeader
          title={t('worker.requestAdvanceTitle')}
          action={{ label: t('common.close'), onPress: onClose }}
        />

        <KeyboardAvoidingView
          style={styles.flex}
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
            {error ? (
              <ThemedText type="small" style={{ color: theme.negative }}>
                {error}
              </ThemedText>
            ) : null}

            {!isOnline ? (
              <ThemedText type="small" style={{ color: theme.warning }}>
                {t('common.offline')}
              </ThemedText>
            ) : null}

            <Card style={styles.form}>
              <Field
                label={t('worker.amount')}
                value={amount}
                onChangeText={setAmount}
                keyboardType="decimal-pad"
                placeholder="2000"
                returnKeyType="next"
              />
              <Field
                label={t('worker.reason')}
                value={reason}
                onChangeText={setReason}
                placeholder="Family expense"
                maxLength={255}
                returnKeyType="done"
              />

              <Button
                title={t('worker.send')}
                loading={saving}
                disabled={!isOnline}
                onPress={() => void submit()}
              />

              {/* Said plainly, because the gap between "asked" and "approved"
                  is where a worker gets into trouble. */}
              <ThemedText type="small" themeColor="textSecondary">
                Your contractor has to approve this. Nothing is added to your balance until they
                do.
              </ThemedText>
            </Card>

            {owed > 0 ? (
              <ThemedText type="small" themeColor="textSecondary" style={styles.owed}>
                You are currently owed {CURRENCY}
                {formatMoney(owed)}.
              </ThemedText>
            ) : null}
          </ScrollView>
        </KeyboardAvoidingView>
      </SafeAreaView>
    </Modal>
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
    gap: Spacing.three,
    paddingHorizontal: Spacing.three,
    paddingBottom: Spacing.six,
    maxWidth: MaxContentWidth,
    width: '100%',
    alignSelf: 'center',
  },
  form: {
    gap: Spacing.three,
  },
  owed: {
    textAlign: 'center',
  },
});
