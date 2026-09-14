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
import type { CashCategory, CashDirection } from '@/data/types';
import { useTheme } from '@/hooks/use-theme';

const DIRECTIONS: { value: CashDirection; label: string }[] = [
  { value: 'out', label: 'Spending' },
  { value: 'in', label: 'Income' },
];

/**
 * Add, rename and remove the categories expenses are filed under.
 *
 * Removing one that has entries against it retires the category rather than
 * deleting it - the server keeps the rows and drops the name from the picker,
 * so an old report still reads correctly.
 */
export default function CategoriesScreen() {
  const theme = useTheme();
  const router = useRouter();
  const { categories, addCategory, renameCategory, removeCategory, isOnline } = useStore();

  const [direction, setDirection] = useState<CashDirection>('out');
  const [name, setName] = useState('');
  const [editing, setEditing] = useState<CashCategory | null>(null);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const visible = useMemo(
    () => categories.filter((category) => category.direction === direction),
    [categories, direction]
  );

  async function run(action: () => Promise<void>) {
    setError(null);
    setBusy(true);
    try {
      await action();
    } catch (caught) {
      setError((caught as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <SafeAreaView style={[styles.screen, { backgroundColor: theme.background }]}>
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <View style={styles.titleBar}>
          <ThemedText type="smallBold">Categories</ThemedText>
          <Pressable
            accessibilityRole="button"
            onPress={() => router.back()}
            hitSlop={12}
            style={({ pressed }) => (pressed ? { opacity: 0.6 } : null)}>
            <ThemedText type="smallBold" style={{ color: theme.tint }}>
              Done
            </ThemedText>
          </Pressable>
        </View>

        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          <Segmented options={DIRECTIONS} value={direction} onChange={setDirection} />

          {!isOnline ? (
            <ThemedText type="small" style={{ color: theme.warning }}>
              Categories need a connection - an expense has to reference one that the server
              already knows about.
            </ThemedText>
          ) : null}

          <Card style={styles.list}>
            {visible.map((category, index) => (
              <View key={category.id}>
                {index > 0 ? (
                  <View style={[styles.divider, { backgroundColor: theme.border }]} />
                ) : null}

                {editing?.id === category.id ? (
                  <View style={styles.editRow}>
                    <Field
                      label="Name"
                      value={draft}
                      onChangeText={setDraft}
                      autoFocus
                      maxLength={60}
                      returnKeyType="done"
                      onSubmitEditing={() =>
                        void run(async () => {
                          await renameCategory(category.id, draft);
                          setEditing(null);
                        })
                      }
                    />
                    <View style={styles.editActions}>
                      <View style={styles.flex}>
                        <Button
                          title="Cancel"
                          variant="secondary"
                          onPress={() => setEditing(null)}
                        />
                      </View>
                      <View style={styles.flex}>
                        <Button
                          title="Save"
                          loading={busy}
                          disabled={!draft.trim()}
                          onPress={() =>
                            void run(async () => {
                              await renameCategory(category.id, draft);
                              setEditing(null);
                            })
                          }
                        />
                      </View>
                    </View>
                  </View>
                ) : (
                  <View style={styles.row}>
                    <View
                      style={[
                        styles.icon,
                        { backgroundColor: `${category.color ?? theme.tint}1A` },
                      ]}>
                      <Ionicons
                        name={
                          (category.icon as keyof typeof Ionicons.glyphMap) ?? 'pricetag-outline'
                        }
                        size={18}
                        color={category.color ?? theme.tint}
                      />
                    </View>

                    <ThemedText type="small" numberOfLines={1} style={styles.flex}>
                      {category.name}
                    </ThemedText>

                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel={`Rename ${category.name}`}
                      hitSlop={8}
                      onPress={() => {
                        setEditing(category);
                        setDraft(category.name);
                      }}>
                      <Ionicons name="pencil-outline" size={18} color={theme.textSecondary} />
                    </Pressable>

                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel={`Remove ${category.name}`}
                      hitSlop={8}
                      onPress={() => void run(() => removeCategory(category.id))}>
                      <Ionicons name="trash-outline" size={18} color={theme.negative} />
                    </Pressable>
                  </View>
                )}
              </View>
            ))}
          </Card>

          <Card style={styles.addCard}>
            <ThemedText type="smallBold" themeColor="textSecondary">
              NEW {direction === 'out' ? 'SPENDING' : 'INCOME'} CATEGORY
            </ThemedText>
            <Field
              label="Name"
              value={name}
              onChangeText={setName}
              placeholder={direction === 'out' ? 'Scaffolding' : 'Owner advance'}
              maxLength={60}
              returnKeyType="done"
            />
            <Button
              title="Add category"
              loading={busy}
              disabled={!name.trim() || !isOnline}
              onPress={() =>
                void run(async () => {
                  await addCategory({ name, direction });
                  setName('');
                })
              }
            />
          </Card>

          {error ? (
            <ThemedText type="small" style={{ color: theme.negative }}>
              {error}
            </ThemedText>
          ) : null}

          <ThemedText type="small" themeColor="textSecondary" style={styles.footnote}>
            Removing a category that already has expenses against it hides it from the picker
            and keeps the entries, so past reports still read correctly.
          </ThemedText>
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
    gap: Spacing.three,
    paddingHorizontal: Spacing.three,
    paddingBottom: Spacing.five,
    maxWidth: MaxContentWidth,
    width: '100%',
    alignSelf: 'center',
  },
  list: {
    padding: 0,
    paddingVertical: Spacing.one,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
    paddingVertical: Spacing.two,
    paddingHorizontal: Spacing.three,
  },
  editRow: {
    gap: Spacing.two,
    padding: Spacing.three,
  },
  editActions: {
    flexDirection: 'row',
    gap: Spacing.two,
  },
  icon: {
    width: 36,
    height: 36,
    borderRadius: Radius.medium,
    alignItems: 'center',
    justifyContent: 'center',
  },
  divider: {
    height: StyleSheet.hairlineWidth,
    marginLeft: Spacing.three,
  },
  addCard: {
    gap: Spacing.three,
  },
  footnote: {
    textAlign: 'center',
  },
});
