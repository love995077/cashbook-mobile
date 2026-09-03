import { useLocalSearchParams, useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { Avatar, Button, Card, Field, Segmented } from '@/components/ui-kit';
import { MaxContentWidth, Radius, Spacing } from '@/constants/theme';
import { useStore } from '@/data/store';
import type { AttendanceStatus } from '@/data/types';
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
  const { workers, giveAdvance, markAttendance, getAttendanceOn } = useStore();
  const params = useLocalSearchParams<{ workerId?: string }>();

  const [workerId, setWorkerId] = useState<number | null>(() => {
    const fromParams = Number(params.workerId);
    return Number.isFinite(fromParams) && fromParams > 0 ? fromParams : null;
  });
  const [action, setAction] = useState<Action>('advance');
  const [amount, setAmount] = useState('');
  const [status, setStatus] = useState<AttendanceStatus>('present');
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const today = useMemo(() => toISODate(new Date()), []);
  const worker = workers.find((candidate) => candidate.id === workerId) ?? null;
  const alreadyMarked = worker ? getAttendanceOn(worker.id, today) : undefined;

  async function submit() {
    setError(null);

    if (!worker) {
      setError('Pick a worker first');
      return;
    }

    // Validate before the request so the obvious mistakes never leave the
    // device; the API enforces the same rule with `amount: Decimal(gt=0)`.
    let value = 0;
    if (action === 'advance') {
      value = Number.parseFloat(amount);
      if (!Number.isFinite(value) || value <= 0) {
        setError('Enter an amount greater than zero');
        return;
      }
    }

    setSubmitting(true);
    try {
      if (action === 'advance') {
        await giveAdvance({
          worker_id: worker.id,
          amount: value,
          date: today,
          note: note.trim() || null,
        });
      } else {
        await markAttendance({
          worker_id: worker.id,
          date: today,
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
});
