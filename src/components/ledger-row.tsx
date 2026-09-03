import { StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Radius, Spacing } from '@/constants/theme';
import type { LedgerEntry } from '@/data/types';
import { useTheme } from '@/hooks/use-theme';
import {
  ATTENDANCE_LABELS,
  CURRENCY,
  TRANSACTION_LABELS,
  formatMoney,
  formatRelativeDate,
} from '@/lib/money';

/**
 * One row of the mixed history: a cash movement or an attendance mark.
 *
 * Cash rows carry a signed amount on the right — the sign follows the effect
 * on the worker's balance, so a wage is +, an advance or payment is -.
 * Attendance rows carry a status pill instead, which keeps the two kinds
 * visually distinct while they share one list.
 */
export function LedgerRow({ entry }: { entry: LedgerEntry }) {
  const theme = useTheme();

  const isTransaction = entry.kind === 'transaction';
  const credit = isTransaction && entry.transaction.type === 'wage';

  const marker = isTransaction
    ? { glyph: credit ? '+' : '−', color: credit ? theme.positive : theme.warning }
    : {
        glyph: { present: 'P', half_day: '½', absent: 'A' }[entry.attendance.status],
        color: {
          present: theme.positive,
          half_day: theme.warning,
          absent: theme.negative,
        }[entry.attendance.status],
      };

  const title = isTransaction
    ? TRANSACTION_LABELS[entry.transaction.type]
    : ATTENDANCE_LABELS[entry.attendance.status];

  const note = isTransaction ? entry.transaction.note : entry.attendance.note;

  return (
    <View style={styles.row}>
      <View style={[styles.marker, { backgroundColor: `${marker.color}1F` }]}>
        <ThemedText style={[styles.markerGlyph, { color: marker.color }]}>
          {marker.glyph}
        </ThemedText>
      </View>

      <View style={styles.body}>
        <ThemedText type="smallBold" numberOfLines={1}>
          {title}
        </ThemedText>
        <ThemedText type="small" themeColor="textSecondary" numberOfLines={1}>
          {formatRelativeDate(entry.date)}
          {note ? ` · ${note}` : ''}
        </ThemedText>
      </View>

      {isTransaction ? (
        <ThemedText type="smallBold" style={{ color: credit ? theme.positive : theme.text }}>
          {credit ? '+' : '−'}
          {CURRENCY}
          {formatMoney(entry.transaction.amount)}
        </ThemedText>
      ) : (
        <ThemedText type="small" themeColor="textSecondary">
          Attendance
        </ThemedText>
      )}
    </View>
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
  marker: {
    width: 36,
    height: 36,
    borderRadius: Radius.small + 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  markerGlyph: {
    fontSize: 16,
    fontWeight: '700',
  },
  body: {
    flex: 1,
    gap: 1,
  },
});
