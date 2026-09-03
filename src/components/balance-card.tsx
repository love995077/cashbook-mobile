import { StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Card } from '@/components/ui-kit';
import { Radius, Spacing } from '@/constants/theme';
import type { BalanceSummary } from '@/data/types';
import { useTheme } from '@/hooks/use-theme';
import { CURRENCY, formatMoney } from '@/lib/money';

/**
 * The headline number on the worker dashboard.
 *
 * A positive balance is money the contractor still owes; negative means the
 * worker has drawn more than they have earned. The wording changes with the
 * sign because "-₹250" alone reads as an error to most people.
 */
export function BalanceCard({ balance }: { balance: BalanceSummary }) {
  const theme = useTheme();
  const owed = balance.balance >= 0;
  const accent = owed ? theme.positive : theme.negative;

  return (
    <Card style={styles.card}>
      <ThemedText type="smallBold" themeColor="textSecondary">
        {owed ? 'CURRENT BALANCE' : 'ADVANCE OUTSTANDING'}
      </ThemedText>

      <View style={styles.amountRow}>
        <ThemedText style={[styles.currency, { color: accent }]}>{CURRENCY}</ThemedText>
        <ThemedText style={[styles.amount, { color: accent }]} numberOfLines={1}>
          {formatMoney(Math.abs(balance.balance))}
        </ThemedText>
      </View>

      <ThemedText type="small" themeColor="textSecondary">
        {owed ? 'Payable to you' : 'You have been paid ahead'}
      </ThemedText>

      <View style={[styles.breakdown, { borderTopColor: theme.border }]}>
        <Stat label="Wages" value={balance.total_wages} color={theme.positive} />
        <View style={[styles.divider, { backgroundColor: theme.border }]} />
        <Stat label="Advances" value={balance.total_advances} color={theme.warning} />
        <View style={[styles.divider, { backgroundColor: theme.border }]} />
        <Stat label="Paid" value={balance.total_payments} color={theme.textSecondary} />
      </View>
    </Card>
  );
}

function Stat({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <View style={styles.stat}>
      <ThemedText type="small" themeColor="textSecondary">
        {label}
      </ThemedText>
      <ThemedText type="smallBold" style={{ color }} numberOfLines={1}>
        {CURRENCY}
        {formatMoney(value)}
      </ThemedText>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    gap: Spacing.one,
    paddingVertical: Spacing.four,
    borderRadius: Radius.large,
  },
  amountRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: Spacing.half,
  },
  currency: {
    fontSize: 28,
    lineHeight: 44,
    fontWeight: '600',
  },
  amount: {
    fontSize: 48,
    lineHeight: 56,
    fontWeight: '700',
    flexShrink: 1,
  },
  breakdown: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: Spacing.three,
    paddingTop: Spacing.three,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  stat: {
    flex: 1,
    gap: Spacing.half,
  },
  divider: {
    width: StyleSheet.hairlineWidth,
    alignSelf: 'stretch',
    marginHorizontal: Spacing.two,
  },
});
