import { Pressable, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Avatar } from '@/components/ui-kit';
import { Spacing } from '@/constants/theme';
import type { WorkerWithBalance } from '@/data/store';
import { useTheme } from '@/hooks/use-theme';
import { CURRENCY, formatMoney } from '@/lib/money';

/**
 * A worker and what they are owed, for the contractor's list.
 *
 * The balance is the point of the row, so it gets the emphasis; the day rate
 * sits underneath as context.
 */
export function WorkerRow({
  worker,
  onPress,
}: {
  worker: WorkerWithBalance;
  onPress?: () => void;
}) {
  const theme = useTheme();
  const { balance } = worker.balance;
  const owed = balance >= 0;

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${worker.name}, ${
        owed ? 'balance owed' : 'advance outstanding'
      } ${CURRENCY}${formatMoney(Math.abs(balance))}`}
      onPress={onPress}
      style={({ pressed }) => [styles.row, pressed && { opacity: 0.6 }]}>
      <Avatar name={worker.name} />

      <View style={styles.body}>
        <ThemedText type="smallBold" numberOfLines={1}>
          {worker.name}
        </ThemedText>
        <ThemedText type="small" themeColor="textSecondary" numberOfLines={1}>
          {worker.daily_wage ? `${CURRENCY}${formatMoney(worker.daily_wage)} / day` : 'No day rate set'}
        </ThemedText>
      </View>

      <View style={styles.amountColumn}>
        <ThemedText
          type="smallBold"
          style={{ color: owed ? theme.positive : theme.negative }}
          numberOfLines={1}>
          {CURRENCY}
          {formatMoney(Math.abs(balance))}
        </ThemedText>
        <ThemedText type="small" themeColor="textSecondary">
          {owed ? 'to pay' : 'advanced'}
        </ThemedText>
      </View>
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
  body: {
    flex: 1,
    gap: 1,
  },
  amountColumn: {
    alignItems: 'flex-end',
    gap: 1,
  },
});
