import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
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
import { Button, Card, Field, Segmented } from '@/components/ui-kit';
import { MaxContentWidth, Radius, Spacing } from '@/constants/theme';
import { useStore } from '@/data/store';
import type { CashDirection } from '@/data/types';
import { useTheme } from '@/hooks/use-theme';
import { CURRENCY, formatDate, toISODate } from '@/lib/money';

const DIRECTIONS: { value: CashDirection; label: string }[] = [
  { value: 'out', label: 'Money spent' },
  { value: 'in', label: 'Money received' },
];

/**
 * Modal for a general expense or a site advance received.
 *
 * Deliberately not the same screen as `new-entry`: that one always concerns a
 * worker, this one never does. Mixing them would put a worker picker in front
 * of someone recording a diesel bill.
 *
 * THE CATEGORY IS OPTIONAL, AND HAS TO BE
 * ---------------------------------------
 * Save used to be disabled until a category was picked. `POST
 * /contractor/cash-entries` has never required one — it takes an explicit
 * `direction` instead and files the row as uncategorised — so the form was
 * refusing something the API accepts. That was survivable while the chips were
 * on screen, and fatal when they were not: a contractor whose category fetch
 * failed, or who is on a cold offline start with nothing cached, got a form
 * with no chips and a dead button, which is exactly "cash entry is not
 * working" with no error to read.
 *
 * So the entry saves with or without a category, and the strip below says what
 * happened when there is nothing to pick.
 */
export default function NewExpenseScreen() {
  const theme = useTheme();
  const router = useRouter();
  const { categories, addCashEntry, isOnline } = useStore();

  const [direction, setDirection] = useState<CashDirection>('out');
  const [categoryId, setCategoryId] = useState<number | null>(null);
  const [amount, setAmount] = useState('');
  const [note, setNote] = useState('');
  const [daysAgo, setDaysAgo] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const visible = useMemo(
    () => categories.filter((category) => category.direction === direction && category.is_active),
    [categories, direction]
  );

  const date = useMemo(() => {
    const day = new Date();
    day.setDate(day.getDate() - daysAgo);
    return toISODate(day);
  }, [daysAgo]);

  // A category from the other side of the ledger must not stay selected when
  // the direction flips.
  const selected = visible.find((category) => category.id === categoryId) ?? null;

  async function submit() {
    setError(null);

    const value = Number.parseFloat(amount);
    if (!Number.isFinite(value) || value <= 0) {
      setError('Enter an amount greater than zero');
      return;
    }

    setSubmitting(true);
    try {
      await addCashEntry({
        // Null files it as uncategorised. `direction` is always sent, which is
        // what the API needs to place an entry with no category on the right
        // side of the ledger.
        category_id: selected?.id ?? null,
        direction,
        amount: value,
        date,
        note: note.trim() || null,
      });
    } catch (caught) {
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
          <ThemedText type="smallBold">New expense</ThemedText>
          <Pressable
            accessibilityRole="button"
            onPress={() => router.back()}
            hitSlop={12}
            style={({ pressed }) => (pressed ? { opacity: 0.6 } : null)}>
            <ThemedText type="smallBold" style={{ color: theme.tint }}>
              Cancel
            </ThemedText>
          </Pressable>
        </View>

        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          <Segmented
            options={DIRECTIONS}
            value={direction}
            onChange={(next) => {
              setDirection(next);
              setCategoryId(null);
            }}
          />

          <View style={styles.section}>
            <View style={styles.sectionHead}>
              <ThemedText type="smallBold" themeColor="textSecondary">
                CATEGORY (OPTIONAL)
              </ThemedText>
              <Pressable
                accessibilityRole="button"
                onPress={() => router.push('/(contractor)/categories')}>
                <ThemedText type="small" style={{ color: theme.tint }}>
                  Manage
                </ThemedText>
              </Pressable>
            </View>

            <View style={styles.chips}>
              {visible.map((category) => {
                const isSelected = category.id === selected?.id;
                const accent = category.color ?? theme.tint;
                return (
                  <Pressable
                    key={category.id}
                    accessibilityRole="button"
                    accessibilityState={{ selected: isSelected }}
                    onPress={() => setCategoryId(category.id)}
                    style={({ pressed }) => [
                      styles.chip,
                      {
                        borderColor: isSelected ? accent : theme.border,
                        backgroundColor: isSelected ? `${accent}1A` : theme.backgroundElement,
                        opacity: pressed ? 0.7 : 1,
                      },
                    ]}>
                    <Ionicons
                      name={
                        (category.icon as keyof typeof Ionicons.glyphMap) ?? 'pricetag-outline'
                      }
                      size={16}
                      color={accent}
                    />
                    <ThemedText type="small" numberOfLines={1}>
                      {category.name}
                    </ThemedText>
                  </Pressable>
                );
              })}

              <Pressable
                accessibilityRole="button"
                onPress={() => router.push('/(contractor)/categories')}
                style={({ pressed }) => [
                  styles.chip,
                  {
                    borderColor: theme.border,
                    borderStyle: 'dashed',
                    backgroundColor: 'transparent',
                    opacity: pressed ? 0.7 : 1,
                  },
                ]}>
                <Ionicons name="add" size={16} color={theme.textSecondary} />
                <ThemedText type="small" themeColor="textSecondary">
                  New category
                </ThemedText>
              </Pressable>
            </View>

            {/* Says why the strip is bare rather than leaving the contractor
                looking at an empty row wondering what they did wrong. The
                entry still saves — it just files as uncategorised. */}
            {visible.length === 0 ? (
              <ThemedText type="small" style={{ color: theme.warning }}>
                {isOnline
                  ? 'No categories loaded yet. You can still save this — it will be filed as uncategorised.'
                  : 'Offline, so your categories have not loaded. You can still save this — it will be filed as uncategorised.'}
              </ThemedText>
            ) : null}
          </View>

          <Card style={styles.form}>
            <View style={styles.dateRow}>
              <ThemedText type="small" themeColor="textSecondary">
                Date
              </ThemedText>
              <View style={styles.dateChoices}>
                {[0, 1, 2].map((offset) => {
                  const isSelected = offset === daysAgo;
                  return (
                    <Pressable
                      key={offset}
                      accessibilityRole="button"
                      accessibilityState={{ selected: isSelected }}
                      onPress={() => setDaysAgo(offset)}
                      style={[
                        styles.dateChip,
                        {
                          backgroundColor: isSelected
                            ? theme.backgroundSelected
                            : 'transparent',
                        },
                      ]}>
                      <ThemedText type="small" themeColor={isSelected ? 'text' : 'textSecondary'}>
                        {offset === 0 ? 'Today' : offset === 1 ? 'Yesterday' : '2 days ago'}
                      </ThemedText>
                    </Pressable>
                  );
                })}
              </View>
            </View>
            <ThemedText type="small" themeColor="textSecondary">
              {formatDate(date)}
            </ThemedText>

            <Field
              label="Amount"
              value={amount}
              onChangeText={setAmount}
              keyboardType="decimal-pad"
              placeholder={`${CURRENCY}0`}
              returnKeyType="done"
            />

            <Field
              label="Note (optional)"
              value={note}
              onChangeText={setNote}
              placeholder={direction === 'out' ? 'What was it for?' : 'Who paid it in?'}
              maxLength={255}
              returnKeyType="done"
            />
          </Card>

          {!isOnline ? (
            <ThemedText type="small" style={{ color: theme.warning }}>
              You are offline. This will be saved on the device and sent when you are back.
            </ThemedText>
          ) : null}

          {error ? (
            <ThemedText type="small" style={{ color: theme.negative }}>
              {error}
            </ThemedText>
          ) : null}

          {/* Not disabled on a missing category any more — see the note at the
              top of the file. The amount is validated in `submit` so the
              reason a tap did nothing is always written on screen. */}
          <Button
            title={direction === 'out' ? 'Save expense' : 'Save receipt'}
            onPress={submit}
            loading={submitting}
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
  sectionHead: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  chips: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.two,
  },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.one + 2,
    paddingVertical: Spacing.two,
    paddingHorizontal: Spacing.three,
    borderRadius: 999,
    borderWidth: 1,
  },
  form: {
    gap: Spacing.three,
  },
  dateRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.two,
  },
  dateChoices: {
    flexDirection: 'row',
    gap: Spacing.one,
  },
  dateChip: {
    paddingVertical: Spacing.one,
    paddingHorizontal: Spacing.two,
    borderRadius: Radius.small,
  },
});
