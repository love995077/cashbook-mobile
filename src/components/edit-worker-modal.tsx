/**
 * Correct a worker's details.
 *
 * WHY THIS EXISTS
 * ---------------
 * A worker record was write-once. A name typed wrong on the morning somebody
 * first turned up, a day rate agreed at 600 and entered as 60, a post left
 * blank because nobody had asked yet - none of it could be fixed, and a
 * record people cannot correct is one they stop trusting and start working
 * around.
 *
 * SAVES THE WHOLE FORM, NOT THE CHANGED FIELDS
 * --------------------------------------------
 * Goes through `PUT /contractor/workers/{id}`, so a field left empty is
 * SAVED as empty. That is the point: "clear this day rate" and "leave this
 * day rate alone" are different intentions, and a PATCH built from
 * `exclude_unset` cannot tell them apart - it can only ever overwrite, never
 * clear.
 *
 * WHAT IT DELIBERATELY CANNOT CHANGE
 * ----------------------------------
 * The phone number. It is the credential the worker signs in with and it is
 * UNIQUE across every account; changing it here would silently lock somebody
 * out of an app they are already using, which is not an edit to a detail. The
 * API's `WorkerReplace` leaves it out for the same reason.
 *
 * ON THE DAY RATE AND HISTORY
 * ---------------------------
 * Raising a rate does NOT reprice days already worked. Attendance writes its
 * wage as a transaction at the rate of that day, so last month's books keep
 * saying what they actually said. The note under the field says so, because a
 * contractor giving somebody a raise mid-job will otherwise wonder.
 */

import { useState } from 'react';
import { KeyboardAvoidingView, Modal, Platform, ScrollView, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { TradePicker } from '@/components/trade-picker';
import { Button, Card, Field, Segmented } from '@/components/ui-kit';
import { MaxContentWidth, Spacing } from '@/constants/theme';
import { useStore, type WorkerWithBalance } from '@/data/store';
import type { WageType, WorkerTrade } from '@/data/types';
import { useTheme } from '@/hooks/use-theme';
import { CURRENCY } from '@/lib/money';

const WAGE_TYPES: { value: WageType; label: string }[] = [
  { value: 'daily', label: 'The day' },
  { value: 'piece_rate', label: 'The piece' },
];

export function EditWorkerModal({
  worker,
  visible,
  onClose,
}: {
  worker: WorkerWithBalance;
  visible: boolean;
  onClose: () => void;
}) {
  const theme = useTheme();
  const { editWorker, sites, isOnline } = useStore();

  const [name, setName] = useState(worker.name);
  const [wage, setWage] = useState(
    worker.daily_wage == null ? '' : String(worker.daily_wage)
  );
  const [trade, setTrade] = useState<WorkerTrade | null>(worker.trade ?? null);
  const [wageType, setWageType] = useState<WageType>(worker.wage_type);
  const [siteId, setSiteId] = useState<number | null>(worker.site_id ?? null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    const trimmed = name.trim();
    if (!trimmed) {
      setError('A worker needs a name.');
      return;
    }

    // Empty is a real answer here - "no rate set" - and distinct from 0,
    // which would be a day rate of nothing.
    const typed = wage.trim();
    let rate: number | null = null;
    if (typed) {
      const parsed = Number.parseFloat(typed);
      if (!Number.isFinite(parsed) || parsed < 0) {
        setError('That day rate is not a number.');
        return;
      }
      rate = parsed;
    }

    setSaving(true);
    setError(null);
    try {
      await editWorker(worker.id, {
        name: trimmed,
        daily_wage: rate,
        trade,
        wage_type: wageType,
        site_id: siteId,
        is_active: worker.is_active,
      });
      onClose();
    } catch (caught) {
      // Stay open so the edit is not lost.
      setError((caught as Error).message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={styles.backdrop}>
        <View style={[styles.sheet, { backgroundColor: theme.background }]}>
          <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
            <ThemedText type="subtitle">Edit {worker.name.split(' ')[0]}</ThemedText>

            <Card style={styles.form}>
              <Field
                label="Full name"
                value={name}
                onChangeText={setName}
                autoCapitalize="words"
                maxLength={120}
              />

              <View style={styles.block}>
                <ThemedText type="smallBold" themeColor="textSecondary">
                  Paid by
                </ThemedText>
                <Segmented
                  options={WAGE_TYPES}
                  value={wageType}
                  onChange={(next) => setWageType(next)}
                />
              </View>

              <Field
                label="Day rate (optional)"
                value={wage}
                onChangeText={setWage}
                keyboardType="decimal-pad"
                placeholder={`${CURRENCY}0`}
                hint="Leave blank if it varies. Days already worked keep the rate they were worked at."
              />

              <TradePicker value={trade} onChange={setTrade} />

              <View style={styles.block}>
                <ThemedText type="smallBold" themeColor="textSecondary">
                  Site (optional)
                </ThemedText>
                {/* `Segmented` is string-valued, so the ids round-trip as
                    strings and '' is the unposted case. */}
                <Segmented
                  options={[
                    { value: '', label: 'None' },
                    ...sites.map((site) => ({ value: String(site.id), label: site.name })),
                  ]}
                  value={siteId == null ? '' : String(siteId)}
                  onChange={(next) => setSiteId(next ? Number(next) : null)}
                />
              </View>

              {/* The one field that is visible elsewhere and not editable
                  here, said out loud rather than left as a gap the
                  contractor hunts for. */}
              <ThemedText type="small" themeColor="textSecondary">
                {worker.phone
                  ? `Signs in with ${worker.phone}. The number cannot be changed here — it is what they log in with.`
                  : 'No phone number, so this worker cannot sign in. They are a record you keep and pay.'}
              </ThemedText>

              {error ? (
                <ThemedText type="small" style={{ color: theme.negative }}>
                  {error}
                </ThemedText>
              ) : null}

              {!isOnline ? (
                <ThemedText type="small" style={{ color: theme.warning }}>
                  You are offline. An edit changes a record on the server, so it cannot be
                  queued — try again once you have signal.
                </ThemedText>
              ) : null}
            </Card>

            <Button
              title="Save changes"
              onPress={() => void submit()}
              loading={saving}
              disabled={!isOnline}
            />
            <Button title="Cancel" variant="ghost" onPress={onClose} />
          </ScrollView>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.45)' },
  sheet: {
    maxHeight: '92%',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    width: '100%',
    maxWidth: MaxContentWidth,
    alignSelf: 'center',
  },
  content: { padding: Spacing.four, gap: Spacing.three },
  form: { gap: Spacing.three },
  block: { gap: Spacing.two },
});
