import { useMemo } from 'react';
import { Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Radius, Spacing } from '@/constants/theme';
import type { WorkerTrade } from '@/data/types';
import { useTheme } from '@/hooks/use-theme';
import { TRADES, normaliseTrade } from '@/lib/trades';

/**
 * Type a worker's post, or tap one of the common ones.
 *
 * FREE TEXT, WITH SUGGESTIONS
 * ---------------------------
 * This used to be thirteen chips and nothing else, because `users.trade` was
 * an enum. It is a VARCHAR now: a real crew turns up with posts that list
 * never had — shuttering carpenter, chowkidar, bar-bending helper — and a post
 * that cannot be typed gets recorded as something else, or not at all.
 *
 * So the input is the control and the chips are a shortcut. Tapping one fills
 * the field rather than replacing it, which keeps a single answer on screen:
 * there is one post, and it is whatever the box says.
 *
 * WHY THE CHIPS ARE STILL HERE
 * ----------------------------
 * Most workers hold one of these thirteen, and tapping is faster and more
 * consistent than typing. The consistency matters beyond convenience — the
 * server folds "Mason", "mason" and "MASON" to one value so a breakdown by
 * post still groups, and a chip lands on that value without relying on it.
 *
 * The chip for the current value shows as selected even when the post was
 * typed by hand, because `normaliseTrade` matches the way the server does. So
 * typing "bar bender" lights the Bar bender chip, and the contractor can see
 * that what they typed is the post the app already knows.
 */
export function TradePicker({
  value,
  onChange,
  label = 'Worker post (optional)',
}: {
  value: WorkerTrade | null;
  onChange: (trade: WorkerTrade | null) => void;
  label?: string | null;
}) {
  const theme = useTheme();

  // What the server would store for what is currently typed. Used only to
  // decide which chip reads as selected.
  const normalised = useMemo(() => (value ? normaliseTrade(value) : null), [value]);

  return (
    <View style={styles.wrap}>
      {label ? (
        <ThemedText type="smallBold" themeColor="textSecondary">
          {label}
        </ThemedText>
      ) : null}

      <TextInput
        value={value ?? ''}
        // Empty is not a post, it is an unset one — matched to the API, which
        // takes null and folds a blank string to it.
        onChangeText={(text) => onChange(text.length ? text : null)}
        placeholder="Mason, shuttering carpenter, chowkidar…"
        placeholderTextColor={theme.textSecondary}
        autoCapitalize="words"
        autoCorrect={false}
        maxLength={50}
        accessibilityLabel="Worker post"
        style={[
          styles.input,
          {
            color: theme.text,
            backgroundColor: theme.backgroundElement,
            borderColor: theme.border,
          },
        ]}
      />

      <ScrollView
        // Caps the height at roughly three rows on a small phone so the chips
        // cannot push the PIN field off the bottom of the modal.
        style={styles.scroll}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}>
        <View style={styles.grid}>
          {TRADES.map((trade) => {
            const selected = trade.value === normalised;
            return (
              <Pressable
                key={trade.value}
                accessibilityRole="radio"
                accessibilityState={{ selected }}
                accessibilityLabel={trade.label}
                // Tapping the selected chip clears the field, so a wrong tap
                // undoes itself the same way it was made.
                onPress={() => onChange(selected ? null : trade.label)}
                style={({ pressed }) => [
                  styles.chip,
                  {
                    borderColor: selected ? trade.color : theme.border,
                    backgroundColor: selected ? `${trade.color}22` : theme.backgroundElement,
                    opacity: pressed ? 0.7 : 1,
                  },
                ]}>
                <ThemedText style={styles.icon}>{trade.icon}</ThemedText>
                <ThemedText
                  type="small"
                  numberOfLines={1}
                  style={{
                    color: selected ? trade.color : theme.textSecondary,
                    fontWeight: selected ? '700' : '500',
                  }}>
                  {trade.label}
                </ThemedText>
              </Pressable>
            );
          })}
        </View>
      </ScrollView>

      <ThemedText type="small" themeColor="textSecondary">
        {value
          ? 'Type any post, or tap a suggestion. Tap it again to clear.'
          : 'Leave blank if it varies. You can set it later.'}
      </ThemedText>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    gap: Spacing.two,
  },
  input: {
    minHeight: 44,
    borderRadius: Radius.small,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: Spacing.two,
    fontSize: 16,
  },
  scroll: {
    maxHeight: 150,
  },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.two,
  },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.one,
    paddingVertical: Spacing.two,
    paddingHorizontal: Spacing.two + 2,
    borderRadius: Radius.medium,
    borderWidth: 1,
  },
  icon: {
    fontSize: 14,
    lineHeight: 18,
  },
});
