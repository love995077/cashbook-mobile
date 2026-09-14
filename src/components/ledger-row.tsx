import { Ionicons } from '@expo/vector-icons';
import { Pressable, StyleSheet, View } from 'react-native';

import { AudioNotePlayer } from '@/components/audio-note-player';
import { ThemedText } from '@/components/themed-text';
import { Radius, Spacing } from '@/constants/theme';
import type { LedgerEntry } from '@/data/types';
import { useTheme } from '@/hooks/use-theme';
import {
  ATTENDANCE_GLYPHS,
  ATTENDANCE_LABELS,
  CURRENCY,
  TRANSACTION_LABELS,
  formatMoney,
  formatPaymentMode,
  formatRelativeDate,
} from '@/lib/money';

/**
 * One row of the mixed history: a cash movement or an attendance mark.
 *
 * Cash rows carry a signed amount on the right — the sign follows the effect
 * on the worker's balance, so a wage is +, an advance or payment is -.
 * Attendance rows carry a status pill instead, which keeps the two kinds
 * visually distinct while they share one list.
 *
 * DISPUTED ROWS ARE TINTED, NOT BADGED
 * ------------------------------------
 * A flagged day washes the whole row in warning yellow rather than adding a
 * chip on the end. The contractor scans this list to find the ones to settle
 * on site; a tint is findable at arm's length in sunlight and a chip is not.
 *
 * `onDispute` turns the row into the worker's flag control. Absent on the
 * contractor's side — they resolve a dispute in person, not by un-ticking it
 * behind the worker's back.
 *
 * `onDelete` is the contractor's way out of a typo, and it is a LONG press
 * rather than a trash icon on purpose. This list is scanned with a thumb on
 * site, often one-handed; a delete target sitting permanently beside the
 * amount is a mis-tap away from erasing a real payment on every row of every
 * worker, to save a rare correction two seconds. Long press cannot fire while
 * scrolling, and the confirmation names the amount before anything happens.
 * The affordance is invisible, so the screen says it in words above the list.
 *
 * Cash rows only: an attendance mark is corrected by re-marking the day, and
 * the API has no delete for it.
 */
export function LedgerRow({
  entry,
  onDispute,
  onDelete,
  deleting = false,
}: {
  entry: LedgerEntry;
  onDispute?: (attendanceId: number) => void;
  onDelete?: (transactionId: number) => void;
  /** This row's delete is in flight; dim it and refuse a second press. */
  deleting?: boolean;
}) {
  const theme = useTheme();

  const isTransaction = entry.kind === 'transaction';
  const credit = isTransaction && entry.transaction.type === 'wage';

  const marker = isTransaction
    ? { glyph: credit ? '+' : '−', color: credit ? theme.positive : theme.warning }
    : {
        glyph: ATTENDANCE_GLYPHS[entry.attendance.status],
        color: {
          present: theme.positive,
          half_day: theme.warning,
          absent: theme.negative,
          rain_out: theme.tint,
        }[entry.attendance.status],
      };

  const title = isTransaction
    ? TRANSACTION_LABELS[entry.transaction.type]
    : ATTENDANCE_LABELS[entry.attendance.status];

  const note = isTransaction ? entry.transaction.note : entry.attendance.note;

  const disputed = !isTransaction && entry.attendance.is_disputed;
  // Only worth saying when it is not the default; every row would otherwise
  // carry a redundant "Day".
  const nightShift = !isTransaction && entry.attendance.shift === 'night';

  // "Today · UPI · Advance for fees". The mode sits before the note because it
  // is the fixed, scannable part - a note is free text of any length.
  const subtitle = [
    formatRelativeDate(entry.date),
    nightShift ? 'Night shift' : null,
    isTransaction ? formatPaymentMode(entry.transaction.payment_mode) : null,
    note,
  ]
    .filter(Boolean)
    .join(' · ');

  // A recording attached to either kind of row: the reason for an advance, or
  // a worker's spoken explanation of a disputed day.
  const audioUrl = isTransaction
    ? entry.transaction.audio_note_url
    : entry.attendance.audio_note_url;

  const deletable = isTransaction && onDelete != null;

  const content = (
      <>
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
          {subtitle}
        </ThemedText>
        {audioUrl ? <AudioNotePlayer url={audioUrl} /> : null}
      </View>

      {isTransaction ? (
        <ThemedText type="smallBold" style={{ color: credit ? theme.positive : theme.text }}>
          {credit ? '+' : '−'}
          {CURRENCY}
          {formatMoney(entry.transaction.amount)}
        </ThemedText>
      ) : onDispute ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={
            disputed ? 'This day is already flagged' : `Flag ${formatRelativeDate(entry.date)}`
          }
          accessibilityState={{ disabled: disputed }}
          // Already flagged is a dead end on purpose: raising it twice does
          // nothing, and clearing it is the contractor's call, made in person.
          disabled={disputed}
          hitSlop={10}
          onPress={() => onDispute(entry.attendance.id)}
          style={({ pressed }) => [styles.flag, pressed && { opacity: 0.6 }]}>
          <Ionicons
            name={disputed ? 'flag' : 'flag-outline'}
            size={18}
            color={disputed ? theme.warning : theme.textSecondary}
          />
        </Pressable>
      ) : disputed ? (
        <ThemedText type="small" style={{ color: theme.warning, fontWeight: '600' }}>
          Flagged
        </ThemedText>
      ) : (
        <ThemedText type="small" themeColor="textSecondary">
          Attendance
        </ThemedText>
      )}
      </>
  );

  const rowStyle = [
    styles.row,
    disputed && { backgroundColor: `${theme.warning}1F` },
    deleting && styles.deleting,
  ];

  if (!deletable) return <View style={rowStyle}>{content}</View>;

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${title}, ${CURRENCY}${formatMoney(entry.transaction.amount)}, ${formatRelativeDate(entry.date)}`}
      accessibilityHint="Double tap and hold to delete this entry"
      accessibilityState={{ disabled: deleting }}
      disabled={deleting}
      delayLongPress={500}
      onLongPress={() => onDelete(entry.transaction.id)}
      style={({ pressed }) => [...rowStyle, pressed && { opacity: 0.6 }]}>
      {content}
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
  flag: {
    padding: Spacing.one,
  },
  deleting: {
    opacity: 0.45,
  },
});
