import { Ionicons } from '@expo/vector-icons';
import { Pressable, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Radius, Spacing } from '@/constants/theme';
import type { CashEntry } from '@/data/types';
import { useTheme } from '@/hooks/use-theme';
import { CURRENCY, formatMoney, formatRelativeDate } from '@/lib/money';

/**
 * One general expense or receipt in a list.
 *
 * The sign is the whole point of the row, so money in is green with a plus and
 * money out is red with a minus - the same reading as the cards above it.
 */
export function CashEntryRow({ entry, onPress }: { entry: CashEntry; onPress?: () => void }) {
  const theme = useTheme();
  const incoming = entry.direction === 'in';
  const tone = incoming ? theme.positive : theme.negative;
  const accent = entry.category_color ?? tone;

  return (
    <Pressable
      accessibilityRole={onPress ? 'button' : undefined}
      onPress={onPress}
      disabled={!onPress}
      style={({ pressed }) => [styles.row, pressed && onPress ? { opacity: 0.6 } : null]}>
      <View style={[styles.icon, { backgroundColor: `${accent}1A` }]}>
        <Ionicons
          name={(entry.category_icon as keyof typeof Ionicons.glyphMap) ?? 'pricetag-outline'}
          size={18}
          color={accent}
        />
      </View>

      <View style={styles.body}>
        <ThemedText type="smallBold" numberOfLines={1}>
          {entry.category_name ?? 'Uncategorised'}
        </ThemedText>
        <ThemedText type="small" themeColor="textSecondary" numberOfLines={1}>
          {formatRelativeDate(entry.date)}
          {entry.note ? ` - ${entry.note}` : ''}
        </ThemedText>
      </View>

      <ThemedText type="smallBold" style={{ color: tone }}>
        {incoming ? '+' : '-'}
        {CURRENCY}
        {formatMoney(entry.amount)}
      </ThemedText>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
    paddingVertical: Spacing.two + 2,
    paddingHorizontal: Spacing.three,
  },
  icon: {
    width: 40,
    height: 40,
    borderRadius: Radius.medium,
    alignItems: 'center',
    justifyContent: 'center',
  },
  body: {
    flex: 1,
    gap: 1,
  },
});
