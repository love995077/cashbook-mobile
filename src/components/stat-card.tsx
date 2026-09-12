import { Ionicons } from '@expo/vector-icons';
import { Pressable, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Card } from '@/components/ui-kit';
import { Radius, Spacing } from '@/constants/theme';
import { CURRENCY, formatMoney } from '@/lib/money';

/**
 * One headline money figure: an icon, a label, the amount, and a line of
 * context under it.
 *
 * `emphasis` makes the amount large enough to be read across a site office;
 * used for the balance, which is the number a contractor actually looks for.
 *
 * `onPress` turns the card into a way into the detail behind the figure. It is
 * optional rather than always on: a card with nowhere to go should not respond
 * to a tap, because a card that highlights and then does nothing reads as a
 * broken screen. When it is set the whole card becomes one button — a chevron
 * would be a second, smaller target for the same thing.
 */
export function StatCard({
  label,
  amount,
  icon,
  tone,
  caption,
  emphasis = false,
  onPress,
  accessibilityHint,
}: {
  label: string;
  amount: number;
  icon: keyof typeof Ionicons.glyphMap;
  tone: string;
  caption?: string;
  emphasis?: boolean;
  onPress?: () => void;
  /** What opens on tap. Ignored unless `onPress` is set. */
  accessibilityHint?: string;
}) {
  const negative = amount < 0;

  const body = (
    <>
      <View style={styles.head}>
        <View style={[styles.icon, { backgroundColor: `${tone}1A` }]}>
          <Ionicons name={icon} size={16} color={tone} />
        </View>
        <ThemedText type="small" themeColor="textSecondary" numberOfLines={1} style={styles.label}>
          {label}
        </ThemedText>
        {onPress ? (
          <Ionicons name="chevron-forward" size={14} color={tone} />
        ) : null}
      </View>

      <ThemedText
        numberOfLines={1}
        adjustsFontSizeToFit
        style={[emphasis ? styles.amountLarge : styles.amount, { color: tone }]}>
        {negative ? '-' : ''}
        {CURRENCY}
        {formatMoney(Math.abs(amount))}
      </ThemedText>

      {caption ? (
        <ThemedText type="small" themeColor="textSecondary" numberOfLines={2}>
          {caption}
        </ThemedText>
      ) : null}
    </>
  );

  if (!onPress) return <Card style={styles.card}>{body}</Card>;

  // The Pressable carries the flex, not the Card: the two cards sit in a row
  // and an unflexed wrapper would collapse them to their content width.
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${label}, ${CURRENCY}${formatMoney(Math.abs(amount))}`}
      accessibilityHint={accessibilityHint}
      onPress={onPress}
      style={({ pressed }) => [styles.pressable, pressed && styles.pressed]}>
      <Card style={styles.card}>{body}</Card>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  pressable: {
    flex: 1,
  },
  pressed: {
    opacity: 0.7,
  },
  card: {
    flex: 1,
    gap: Spacing.two,
    padding: Spacing.three,
  },
  head: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
  },
  icon: {
    width: 28,
    height: 28,
    borderRadius: Radius.small,
    alignItems: 'center',
    justifyContent: 'center',
  },
  label: {
    flex: 1,
  },
  amount: {
    fontSize: 20,
    lineHeight: 26,
    fontWeight: '700',
  },
  amountLarge: {
    fontSize: 30,
    lineHeight: 36,
    fontWeight: '700',
  },
});
