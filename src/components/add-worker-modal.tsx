import { Ionicons } from '@expo/vector-icons';
import { useState } from 'react';
import {
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
} from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { TradePicker } from '@/components/trade-picker';
import { Button, Field, Segmented } from '@/components/ui-kit';
import { MaxContentWidth, Radius, Spacing } from '@/constants/theme';
import { useStore } from '@/data/store';
import type { WageType, WorkerTrade } from '@/data/types';
import { useTheme } from '@/hooks/use-theme';
import { CURRENCY } from '@/lib/money';

/**
 * Add one worker to the crew.
 *
 * A React Native `Modal` rather than an expo-router modal route, unlike the
 * other forms in this app: adding a worker is a detour from the list you are
 * already looking at, and this keeps that list underneath instead of replacing
 * it. It also renders as a real overlay on the web build, where a router modal
 * is just another full page.
 *
 * The write itself is `addWorker` in the store, which POSTs to
 * /contractor/workers with the session token - so the worker is bound to the
 * calling contractor server-side - and then refreshes the crew. Nothing here
 * reaches for the token or the list directly.
 *
 * ONLY THE NAME IS REQUIRED
 * -------------------------
 * Everything else describes a worker the contractor may not know much about on
 * the morning they first turn up. A form that refuses the booking until a
 * number and a PIN exist is a form that gets filled with 9999999999, and a
 * crew list full of placeholder numbers is worse than one with blanks in it.
 *
 * A worker saved without a phone number or a PIN cannot sign in - they are a
 * record their contractor keeps and pays. Both can be added later, and the
 * form says so rather than leaving it to be discovered.
 */

// Matches the API's `Phone` type in app/schemas/user.py. Validating here as
// well turns a 422 round trip into an instant inline message. Only applied
// when something was actually typed - blank is a valid answer now.
const PHONE_PATTERN = /^\+?[0-9\- ]{7,20}$/;

// bcrypt reads at most 72 bytes, and the API rejects anything under 6.
const WAGE_TYPES: { value: WageType; label: string }[] = [
  { value: 'daily', label: 'The day' },
  { value: 'piece_rate', label: 'The piece' },
];

const MIN_PASSWORD = 6;
const MAX_PASSWORD = 72;

export function AddWorkerModal({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const theme = useTheme();
  const { addWorker, sites, isOnline } = useStore();

  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [wage, setWage] = useState('');
  const [trade, setTrade] = useState<WorkerTrade | null>(null);
  // Daily is the default and the overwhelming majority; piece-rate is for
  // finishing trades engaged by output rather than by the day.
  const [wageType, setWageType] = useState<WageType>('daily');
  const [siteId, setSiteId] = useState<number | null>(null);
  const [password, setPassword] = useState('');
  const [reveal, setReveal] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  function reset() {
    setName('');
    setPhone('');
    setWage('');
    setTrade(null);
    setSiteId(null);
    setPassword('');
    setReveal(false);
    setError(null);
  }

  function dismiss() {
    if (submitting) return;
    reset();
    onClose();
  }

  async function submit() {
    setError(null);

    const trimmedName = name.trim();
    const trimmedPhone = phone.trim();
    const trimmedTrade = trade?.trim() ?? '';

    // The one thing a crew row cannot do without.
    if (!trimmedName) {
      setError('Enter the worker name');
      return;
    }

    // Optional, but a number that IS given has to be usable — it is what the
    // worker would sign in with, and a typo here is only discovered when they
    // try and cannot.
    if (trimmedPhone && !PHONE_PATTERN.test(trimmedPhone)) {
      setError('Enter a valid mobile number (7 to 20 digits), or leave it blank');
      return;
    }

    // Same reasoning: no PIN is fine, a PIN too short for the API to accept is
    // not.
    if (password && password.length < MIN_PASSWORD) {
      setError(`The PIN must be at least ${MIN_PASSWORD} characters, or leave it blank`);
      return;
    }

    // A PIN with no number to go with it can never be used: sign-in is by
    // phone. Worth saying now rather than letting it look like an account.
    if (password && !trimmedPhone) {
      setError('A PIN needs a mobile number to sign in with. Add one, or clear the PIN.');
      return;
    }

    // Blank is a legitimate answer: the API takes a null daily_wage for a
    // worker whose rate varies job to job.
    let dailyWage: number | null = null;
    if (wage.trim()) {
      dailyWage = Number.parseFloat(wage);
      if (!Number.isFinite(dailyWage) || dailyWage < 0) {
        setError('Enter a daily wage of zero or more, or leave it blank');
        return;
      }
    }

    setSubmitting(true);
    try {
      await addWorker({
        name: trimmedName,
        // Null rather than "" for all three: the API reads null as "not
        // recorded", and an empty string would be a phone number of no digits
        // and a PIN of no characters.
        phone: trimmedPhone || null,
        password: password || null,
        daily_wage: dailyWage,
        trade: trimmedTrade || null,
        wage_type: wageType,
        site_id: siteId,
      });
    } catch (caught) {
      // Stay open so the details are not lost - a 409 on a phone number that
      // already has an account is the common one here.
      setSubmitting(false);
      setError((caught as Error).message);
      return;
    }

    setSubmitting(false);
    reset();
    onClose();
  }

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      // Android hardware back and the iOS swipe both mean "cancel".
      onRequestClose={dismiss}>
      <View style={styles.backdrop}>
        {/* Tapping the dimmed area closes, the standard way out of a modal. */}
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Close"
          style={StyleSheet.absoluteFill}
          onPress={dismiss}
        />

        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          style={styles.centre}
          pointerEvents="box-none">
          <View
            style={[
              styles.sheet,
              { backgroundColor: theme.backgroundElement, borderColor: theme.border },
            ]}>
            <View style={styles.titleBar}>
              <ThemedText type="smallBold">Add worker</ThemedText>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Close"
                onPress={dismiss}
                hitSlop={12}
                style={({ pressed }) => (pressed ? { opacity: 0.6 } : null)}>
                <Ionicons name="close" size={22} color={theme.textSecondary} />
              </Pressable>
            </View>

            <ScrollView
              contentContainerStyle={styles.form}
              keyboardShouldPersistTaps="handled"
              showsVerticalScrollIndicator={false}>
              <Field
                label="Full name"
                value={name}
                onChangeText={setName}
                placeholder="Suresh Kumar"
                autoCapitalize="words"
                maxLength={120}
                returnKeyType="next"
              />

              <Field
                label="Mobile number (optional)"
                value={phone}
                onChangeText={setPhone}
                placeholder="9876543210"
                keyboardType="phone-pad"
                autoCapitalize="none"
                autoCorrect={false}
                maxLength={20}
                hint="What the worker signs in with, so it has to be unique. Leave blank to add them without an account."
                returnKeyType="next"
              />

              <View style={styles.wageType}>
                <ThemedText type="smallBold" themeColor="textSecondary">
                  Paid by
                </ThemedText>
                <Segmented
                  options={WAGE_TYPES}
                  value={wageType}
                  onChange={setWageType}
                />
                <ThemedText type="small" themeColor="textSecondary">
                  {wageType === 'daily'
                    ? 'Marked present or absent each day, and paid the day rate below.'
                    : 'Paid on quantity × rate. The attendance grid asks for those two instead of a present/absent toggle.'}
                </ThemedText>
              </View>

              {/* Only meaningful for a daily worker. A piece-rate worker's pay
                  comes from their logged quantity, so a day rate here would be
                  a number that never gets used. */}
              {wageType === 'daily' ? (
                <Field
                  label="Daily wage (optional)"
                  value={wage}
                  onChangeText={setWage}
                  placeholder={`${CURRENCY}0`}
                  keyboardType="decimal-pad"
                  hint="Leave blank if the rate changes from job to job."
                  returnKeyType="next"
                />
              ) : null}

              <TradePicker value={trade} onChange={setTrade} />

              {sites.length ? (
                <View style={styles.sitePicker}>
                  <ThemedText type="smallBold" themeColor="textSecondary">
                    Site (optional)
                  </ThemedText>
                  <View style={styles.siteChips}>
                    {sites.map((site) => {
                      const selected = site.id === siteId;
                      return (
                        <Pressable
                          key={site.id}
                          accessibilityRole="radio"
                          accessibilityState={{ selected }}
                          // Tapping the selected chip clears it, same as the
                          // trade picker above.
                          onPress={() => setSiteId(selected ? null : site.id)}
                          style={({ pressed }) => [
                            styles.siteChip,
                            {
                              borderColor: selected ? theme.tint : theme.border,
                              backgroundColor: selected ? `${theme.tint}1A` : 'transparent',
                              opacity: pressed ? 0.7 : 1,
                            },
                          ]}>
                          <ThemedText
                            type="small"
                            numberOfLines={1}
                            style={{
                              color: selected ? theme.tint : theme.textSecondary,
                              fontWeight: selected ? '700' : '500',
                            }}>
                            {site.name}
                          </ThemedText>
                        </Pressable>
                      );
                    })}
                  </View>
                  <ThemedText type="small" themeColor="textSecondary">
                    Posting them to a site is what puts them in its rain-out and crew list.
                  </ThemedText>
                </View>
              ) : null}

              <View>
                <Field
                  label="Login PIN (optional)"
                  value={password}
                  onChangeText={setPassword}
                  placeholder="At least 6 characters"
                  secureTextEntry={!reveal}
                  autoCapitalize="none"
                  autoCorrect={false}
                  maxLength={MAX_PASSWORD}
                  hint={
                    phone.trim()
                      ? 'Share this with the worker. They can sign in and see their own ledger. Leave blank to add them without an account.'
                      : 'Needs a mobile number to go with it — sign-in is by number.'
                  }
                  returnKeyType="done"
                  onSubmitEditing={() => void submit()}
                />
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={reveal ? 'Hide PIN' : 'Show PIN'}
                  onPress={() => setReveal((current) => !current)}
                  hitSlop={8}
                  style={styles.reveal}>
                  <Ionicons
                    name={reveal ? 'eye-off-outline' : 'eye-outline'}
                    size={20}
                    color={theme.textSecondary}
                  />
                </Pressable>
              </View>

              {!isOnline ? (
                <ThemedText type="small" style={{ color: theme.warning }}>
                  You are offline. A worker needs a server-assigned id before any entry can
                  reference them, so this one cannot be saved for later.
                </ThemedText>
              ) : null}

              {/* Said before saving, not after: "why can't he log in" is the
                  question this answers, and it is cheaper to answer here. */}
              {!phone.trim() ? (
                <ThemedText type="small" themeColor="textSecondary">
                  With no mobile number, {name.trim() || 'this worker'} goes on the crew and
                  can be paid and marked, but cannot sign in. You can add a number and a PIN
                  later.
                </ThemedText>
              ) : null}

              {error ? (
                <ThemedText type="small" style={{ color: theme.negative }}>
                  {error}
                </ThemedText>
              ) : null}

              <Button
                title="Add to crew"
                onPress={() => void submit()}
                loading={submitting}
                disabled={!isOnline}
              />
              <Button title="Cancel" variant="ghost" onPress={dismiss} disabled={submitting} />
            </ScrollView>
          </View>
        </KeyboardAvoidingView>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.45)',
  },
  centre: {
    flex: 1,
    justifyContent: 'center',
    padding: Spacing.three,
  },
  sheet: {
    width: '100%',
    maxWidth: MaxContentWidth - 200,
    alignSelf: 'center',
    // Leaves room for the keyboard on a small phone; the form scrolls inside.
    maxHeight: '90%',
    borderRadius: Radius.large,
    borderWidth: StyleSheet.hairlineWidth,
    overflow: 'hidden',
  },
  titleBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: Spacing.three,
    paddingTop: Spacing.three,
    paddingBottom: Spacing.two,
  },
  form: {
    gap: Spacing.three,
    paddingHorizontal: Spacing.three,
    paddingBottom: Spacing.four,
  },
  wageType: {
    gap: Spacing.two,
  },
  sitePicker: {
    gap: Spacing.two,
  },
  siteChips: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.two,
  },
  siteChip: {
    paddingVertical: Spacing.two,
    paddingHorizontal: Spacing.two + 2,
    borderRadius: Radius.medium,
    borderWidth: 1,
  },
  reveal: {
    position: 'absolute',
    right: Spacing.three,
    // Sits over the input, which is below the field's own label row.
    top: 34,
    padding: Spacing.one,
  },
});
