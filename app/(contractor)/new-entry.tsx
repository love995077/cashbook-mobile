import { useLocalSearchParams, useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { AudioNoteButton } from '@/components/audio-note-button';
import { DatePicker } from '@/components/date-picker';
import { PaymentModePicker } from '@/components/payment-mode-picker';
import { ThemedText } from '@/components/themed-text';
import { TradeBadge } from '@/components/trade-badge';
import { Avatar, Button, Card, Field, Segmented } from '@/components/ui-kit';
import { MaxContentWidth, Radius, Spacing } from '@/constants/theme';
import { useStore } from '@/data/store';
import type { AttendanceStatus, PaymentMode } from '@/data/types';
import { useTheme } from '@/hooks/use-theme';
import { ATTENDANCE_LABELS, CURRENCY, formatDate, formatMoney, toISODate } from '@/lib/money';

type Action = 'advance' | 'attendance';

const ACTIONS: { value: Action; label: string }[] = [
  { value: 'advance', label: 'Give advance' },
  { value: 'attendance', label: 'Mark attendance' },
];

const STATUSES: { value: AttendanceStatus; label: string }[] = [
  { value: 'present', label: ATTENDANCE_LABELS.present },
  { value: 'half_day', label: ATTENDANCE_LABELS.half_day },
  { value: 'absent', label: ATTENDANCE_LABELS.absent },
];

/**
 * Modal for logging one entry against one worker.
 *
 * Presented over the tabs (see `(contractor)/_layout.tsx`) so dismissing it
 * returns to whichever tab launched it. A `workerId` param preselects the
 * worker when it is opened from a row in the Workers list.
 */
export default function NewEntryScreen() {
  const theme = useTheme();
  const router = useRouter();
  const { workers, giveAdvance, markAttendance, getAttendanceOn, isOnline } = useStore();
  const params = useLocalSearchParams<{ workerId?: string }>();

  const [workerId, setWorkerId] = useState<number | null>(() => {
    const fromParams = Number(params.workerId);
    return Number.isFinite(fromParams) && fromParams > 0 ? fromParams : null;
  });
  const [action, setAction] = useState<Action>('advance');
  const [amount, setAmount] = useState('');
  const [status, setStatus] = useState<AttendanceStatus>('present');
  // Cash is the default because it is how most of a site is actually paid,
  // and it is what the API assumes when nothing is sent.
  const [paymentMode, setPaymentMode] = useState<PaymentMode>('cash');
  // Uploaded on release, so the path is already stored by the time Save is
  // tapped. Null until something is recorded.
  const [audioNotePath, setAudioNotePath] = useState<string | null>(null);
  const [note, setNote] = useState('');
  // "Recover via daily installments". Off by default: most advances are
  // settled against the next payout rather than clawed back day by day.
  const [recoverDaily, setRecoverDaily] = useState(false);
  const [dailyDeduction, setDailyDeduction] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const today = useMemo(() => toISODate(new Date()), []);
  /**
   * The day this advance or attendance is recorded against.
   *
   * Was always `today`, with no way to say otherwise. An advance handed over
   * on site on Saturday and entered on Monday landed on Monday, which puts
   * the money in the wrong week of every report - and the API has always
   * taken an arbitrary `date`, so only the form was insisting.
   */
  const [date, setDate] = useState(today);
  const worker = workers.find((candidate) => candidate.id === workerId) ?? null;
  const alreadyMarked = worker ? getAttendanceOn(worker.id, today) : undefined;

  // "25 working days to clear" is the question a contractor actually asks
  // about an installment plan, so the form answers it while they type rather
  // than making them divide two numbers on the back of a delivery note.
  const installmentHint = useMemo(() => {
    const total = Number.parseFloat(amount);
    const perDay = Number.parseFloat(dailyDeduction);
    if (!Number.isFinite(total) || !Number.isFinite(perDay) || perDay <= 0) return undefined;
    if (perDay > total) return 'That is more than the advance itself.';
    const days = Math.ceil(total / perDay);
    return `Clears in ${days} working day${days === 1 ? '' : 's'}.`;
  }, [amount, dailyDeduction]);

  async function submit() {
    setError(null);

    if (!worker) {
      setError('Pick a worker first');
      return;
    }

    // Validate before the request so the obvious mistakes never leave the
    // device; the API enforces the same rule with `amount: Decimal(gt=0)`.
    let value = 0;
    let deduction: number | null = null;
    if (action === 'advance') {
      value = Number.parseFloat(amount);
      if (!Number.isFinite(value) || value <= 0) {
        setError('Enter an amount greater than zero');
        return;
      }

      if (recoverDaily) {
        deduction = Number.parseFloat(dailyDeduction);
        if (!Number.isFinite(deduction) || deduction <= 0) {
          setError('Enter how much to recover each day');
          return;
        }
        if (deduction > value) {
          // The first day would clear the whole plan, which is a lump sum
          // with extra steps. The API refuses it too; catching it here keeps
          // the typed form on screen.
          setError('The daily amount cannot be more than the advance itself');
          return;
        }
      }
    }

    setSubmitting(true);
    try {
      if (action === 'advance') {
        await giveAdvance({
          worker_id: worker.id,
          amount: value,
          date,
          payment_mode: paymentMode,
          audio_note_path: audioNotePath,
          note: note.trim() || null,
          daily_deduction: deduction,
        });
      } else {
        await markAttendance({
          worker_id: worker.id,
          date,
          status,
          note: note.trim() || null,
        });
      }
    } catch (caught) {
      // Stay on the form so the entry is not lost — a 409 on a duplicate
      // attendance date is the common one here.
      setSubmitting(false);
      setError((caught as Error).message);
      return;
    }

    router.back();
  }

  return (
    <SafeAreaView style={[styles.screen, { backgroundColor: theme.background }]}>
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <View style={styles.titleBar}>
          <ThemedText type="smallBold">New entry</ThemedText>
          <Pressable
            accessibilityRole="button"
            onPress={() => router.back()}
            hitSlop={12}
            style={({ pressed }) => pressed && { opacity: 0.6 }}>
            <ThemedText type="smallBold" style={{ color: theme.tint }}>
              Cancel
            </ThemedText>
          </Pressable>
        </View>

        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          <View style={styles.section}>
            <ThemedText type="smallBold" themeColor="textSecondary">
              WORKER
            </ThemedText>
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.workerStrip}>
              {workers.map((candidate) => {
                const selected = candidate.id === workerId;
                return (
                  <Pressable
                    key={candidate.id}
                    accessibilityRole="button"
                    accessibilityState={{ selected }}
                    onPress={() => setWorkerId(candidate.id)}
                    style={({ pressed }) => [
                      styles.workerChip,
                      {
                        borderColor: selected ? theme.tint : theme.border,
                        backgroundColor: selected ? `${theme.tint}1A` : theme.backgroundElement,
                        opacity: pressed ? 0.7 : 1,
                      },
                    ]}>
                    <Avatar name={candidate.name} size={36} />
                    <ThemedText type="small" numberOfLines={1} style={styles.workerChipName}>
                      {candidate.name.split(' ')[0]}
                    </ThemedText>
                    <TradeBadge trade={candidate.trade} compact />
                  </Pressable>
                );
              })}
            </ScrollView>
          </View>

          <View style={styles.section}>
            <ThemedText type="smallBold" themeColor="textSecondary">
              ACTION
            </ThemedText>
            <Segmented options={ACTIONS} value={action} onChange={setAction} />
          </View>

          <Card style={styles.form}>
            <View style={styles.dateRow}>
              <ThemedText type="small" themeColor="textSecondary">
                Date
              </ThemedText>
              <ThemedText type="smallBold">{formatDate(today)}</ThemedText>
            </View>

            {action === 'advance' ? (
              <>
                {/* Back-dating, the same control the attendance grid uses. */}
                <DatePicker value={date} onChange={setDate} label="Date" />

                <Field
                  label="Amount"
                  value={amount}
                  onChangeText={setAmount}
                  keyboardType="decimal-pad"
                  placeholder={`${CURRENCY}0`}
                  hint={
                    worker?.daily_wage
                      ? `${worker.name.split(' ')[0]}'s day rate is ${CURRENCY}${formatMoney(
                          worker.daily_wage
                        )}`
                      : undefined
                  }
                  returnKeyType="done"
                />
                {/* Directly under the amount: how much, then how it was handed
                    over, in the order the contractor would say it aloud. */}
                <PaymentModePicker value={paymentMode} onChange={setPaymentMode} />

                {/* And then how it comes back. Last, because it is the least
                    common answer and the one that needs the amount above it
                    already decided. */}
                <View style={styles.section}>
                  <View style={styles.switchRow}>
                    <View style={styles.switchLabel}>
                      <ThemedText type="smallBold">Recover via daily installments</ThemedText>
                      <ThemedText type="small" themeColor="textSecondary">
                        Take a fixed amount off each day {worker?.name.split(' ')[0] ?? 'they'}{' '}
                        works, instead of holding the whole advance against their next payout.
                      </ThemedText>
                    </View>
                    <Switch
                      value={recoverDaily}
                      onValueChange={setRecoverDaily}
                      disabled={!isOnline}
                      accessibilityLabel="Recover this advance via daily installments"
                      trackColor={{ true: theme.tint, false: theme.border }}
                    />
                  </View>

                  {recoverDaily ? (
                    <>
                      <Field
                        label="Deduct each day"
                        value={dailyDeduction}
                        onChangeText={setDailyDeduction}
                        keyboardType="decimal-pad"
                        placeholder={`${CURRENCY}0`}
                        hint={installmentHint}
                        returnKeyType="done"
                      />
                      <ThemedText type="small" themeColor="textSecondary">
                        Nothing is deducted on a day they do not work, and a half day
                        recovers half.
                      </ThemedText>
                    </>
                  ) : null}

                  {!isOnline ? (
                    <ThemedText type="small" style={{ color: theme.warning }}>
                      Installments need a connection — the plan has to be recorded against the
                      advance itself, and that cannot be queued. You can still save the advance
                      without them.
                    </ThemedText>
                  ) : null}
                </View>
              </>
            ) : (
              <View style={styles.section}>
                <ThemedText type="smallBold" themeColor="textSecondary">
                  Status
                </ThemedText>
                <Segmented options={STATUSES} value={status} onChange={setStatus} />
                {alreadyMarked ? (
                  <ThemedText type="small" style={{ color: theme.warning }}>
                    {worker?.name.split(' ')[0]} is already marked{' '}
                    {ATTENDANCE_LABELS[alreadyMarked.status].toLowerCase()} today.
                  </ThemedText>
                ) : null}
              </View>
            )}

            <Field
              label="Note (optional)"
              value={note}
              onChangeText={setNote}
              placeholder={action === 'advance' ? 'What is it for?' : 'Anything to add?'}
              maxLength={255}
              returnKeyType="done"
            />

            {action === 'advance' ? (
              // Beside the note field, not instead of it: some contractors
              // type, and on a noisy site most would rather say it.
              <AudioNoteButton
                value={audioNotePath}
                onChange={setAudioNotePath}
                label="Hold to say what it is for"
              />
            ) : null}
          </Card>

          {error ? (
            <ThemedText type="small" style={{ color: theme.negative }}>
              {error}
            </ThemedText>
          ) : null}

          <Button
            title={action === 'advance' ? 'Save advance' : 'Save attendance'}
            onPress={submit}
            loading={submitting}
            disabled={!worker}
          />
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
  titleBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.three,
  },
  content: {
    gap: Spacing.four,
    paddingHorizontal: Spacing.three,
    paddingBottom: Spacing.five,
    maxWidth: MaxContentWidth,
    width: '100%',
    alignSelf: 'center',
  },
  section: {
    gap: Spacing.two,
  },
  workerStrip: {
    gap: Spacing.two,
    paddingVertical: Spacing.half,
  },
  workerChip: {
    width: 86,
    alignItems: 'center',
    gap: Spacing.one,
    paddingVertical: Spacing.two,
    paddingHorizontal: Spacing.one,
    borderRadius: Radius.medium,
    borderWidth: 1,
  },
  workerChipName: {
    textAlign: 'center',
  },
  form: {
    gap: Spacing.three,
  },
  dateRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  switchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
  },
  switchLabel: {
    flex: 1,
    gap: 2,
  },
});
