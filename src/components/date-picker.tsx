import { useMemo, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { formatRelativeDate, toISODate } from '@/lib/money';

/**
 * Pick a day, for a screen that records something which happened on one.
 *
 * BUILT HERE RATHER THAN INSTALLED
 * --------------------------------
 * No date library is in this project, and the obvious one
 * (@react-native-community/datetimepicker) is a native module: adding it means
 * a new dev-client build before anyone can run the app, which is a heavy price
 * for a control that is a month grid and two arrows. This is plain RN and
 * works in the client already on the phone.
 *
 * It also keeps the app's own look. The native picker is a different control
 * on each platform and neither matches the chips and cards around it.
 *
 * LOCAL DATES, NEVER UTC
 * ----------------------
 * Every date here is a `YYYY-MM-DD` string in the LOCAL calendar, built with
 * `toISODate`. `toISOString().slice(0, 10)` is UTC and east of Greenwich it
 * reports the previous day for the first hours of every day — which on this
 * screen would file a day's attendance against yesterday. Parsing goes through
 * `${iso}T00:00:00`, which is local midnight, for the same reason.
 *
 * THE FUTURE IS CLOSED
 * --------------------
 * `maxISO` defaults to today and days past it are not selectable. Attendance
 * is a record of what happened; marking Thursday's crew on Tuesday is a typo
 * with a payroll consequence, not a feature.
 */

const WEEKDAYS = ['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su'];

/** Local midnight for an ISO day. */
function parseISO(iso: string): Date {
  return new Date(`${iso}T00:00:00`);
}

function addDays(iso: string, days: number): string {
  const date = parseISO(iso);
  date.setDate(date.getDate() + days);
  return toISODate(date);
}

function startOfMonth(iso: string): Date {
  const date = parseISO(iso);
  return new Date(date.getFullYear(), date.getMonth(), 1);
}

function addMonths(anchor: Date, months: number): Date {
  return new Date(anchor.getFullYear(), anchor.getMonth() + months, 1);
}

/**
 * The days to draw for one month, Monday first, padded with nulls so the
 * first of the month lands under its own weekday.
 */
function monthGrid(anchor: Date): (string | null)[] {
  const year = anchor.getFullYear();
  const month = anchor.getMonth();

  // getDay() is Sunday-based; this app's weeks start on Monday.
  const lead = (new Date(year, month, 1).getDay() + 6) % 7;
  const days = new Date(year, month + 1, 0).getDate();

  const cells: (string | null)[] = Array(lead).fill(null);
  for (let day = 1; day <= days; day += 1) {
    cells.push(toISODate(new Date(year, month, day)));
  }
  return cells;
}

const MONTH_LABEL: Intl.DateTimeFormatOptions = { month: 'long', year: 'numeric' };

export function DatePicker({
  value,
  onChange,
  maxISO,
  label = 'Date',
}: {
  /** The selected day, `YYYY-MM-DD` in the local calendar. */
  value: string;
  onChange: (iso: string) => void;
  /** Latest selectable day. Defaults to today. */
  maxISO?: string;
  label?: string | null;
}) {
  const theme = useTheme();

  // Resolved once per render rather than held in state: a session left open
  // across midnight should not still be treating yesterday as the ceiling.
  const today = toISODate(new Date());
  const ceiling = maxISO ?? today;

  const [open, setOpen] = useState(false);
  // Which month the grid is showing. Seeded from the selection so opening the
  // calendar on a back-dated day lands on that day's month, not on this one.
  const [anchor, setAnchor] = useState(() => startOfMonth(value));

  const cells = useMemo(() => monthGrid(anchor), [anchor]);
  const yesterday = addDays(today, -1);

  const atCeiling = value >= ceiling;

  function select(iso: string) {
    if (iso > ceiling) return;
    onChange(iso);
  }

  function step(days: number) {
    const next = addDays(value, days);
    if (next > ceiling) return;
    select(next);
    // Keep the grid on the day that is now selected, so stepping from the 1st
    // back to the 31st does not leave the calendar on the wrong month.
    setAnchor(startOfMonth(next));
  }

  // The grid never needs to show a month that is entirely in the future.
  const canPageForward = startOfMonth(ceiling) > anchor;

  return (
    <View style={styles.wrap}>
      {label ? (
        <ThemedText type="smallBold" themeColor="textSecondary">
          {label}
        </ThemedText>
      ) : null}

      <View
        style={[
          styles.bar,
          { backgroundColor: theme.backgroundElement, borderColor: theme.border },
        ]}>
        <Arrow
          direction="back"
          label="Previous day"
          onPress={() => step(-1)}
          disabled={false}
        />

        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`${formatRelativeDate(value)}. Tap to open the calendar.`}
          accessibilityState={{ expanded: open }}
          onPress={() => {
            // Re-seed on open so the grid always starts where the selection is.
            if (!open) setAnchor(startOfMonth(value));
            setOpen((current) => !current);
          }}
          style={styles.current}
          hitSlop={6}>
          <ThemedText type="smallBold" numberOfLines={1}>
            {formatRelativeDate(value)}
          </ThemedText>
          <ThemedText type="small" themeColor="textSecondary">
            {open ? 'Tap to close' : 'Tap to pick a date'}
          </ThemedText>
        </Pressable>

        {/* Disabled at the ceiling rather than hidden: a control that vanishes
            is harder to understand than one that is visibly unavailable. */}
        <Arrow
          direction="forward"
          label="Next day"
          onPress={() => step(1)}
          disabled={atCeiling}
        />
      </View>

      <View style={styles.quick}>
        <Quick label="Today" active={value === today} onPress={() => select(today)} />
        <Quick
          label="Yesterday"
          active={value === yesterday}
          onPress={() => select(yesterday)}
        />
      </View>

      {open ? (
        <View
          style={[
            styles.calendar,
            { backgroundColor: theme.backgroundElement, borderColor: theme.border },
          ]}>
          <View style={styles.monthBar}>
            <Arrow
              direction="back"
              label="Previous month"
              onPress={() => setAnchor(addMonths(anchor, -1))}
              disabled={false}
            />
            <ThemedText type="smallBold">
              {anchor.toLocaleDateString('en-IN', MONTH_LABEL)}
            </ThemedText>
            <Arrow
              direction="forward"
              label="Next month"
              onPress={() => setAnchor(addMonths(anchor, 1))}
              disabled={!canPageForward}
            />
          </View>

          <View style={styles.week}>
            {WEEKDAYS.map((day) => (
              <ThemedText
                key={day}
                type="small"
                themeColor="textSecondary"
                style={styles.weekday}>
                {day}
              </ThemedText>
            ))}
          </View>

          <View style={styles.grid}>
            {cells.map((iso, index) => {
              if (!iso) {
                // Padding before the 1st. Keyed by position — these cells hold
                // no date, so there is nothing else to key them by.
                return <View key={`pad-${index}`} style={styles.cell} />;
              }

              const selected = iso === value;
              const isToday = iso === today;
              const future = iso > ceiling;

              return (
                <Pressable
                  key={iso}
                  accessibilityRole="button"
                  accessibilityState={{ selected, disabled: future }}
                  accessibilityLabel={formatRelativeDate(iso)}
                  disabled={future}
                  onPress={() => {
                    select(iso);
                    setOpen(false);
                  }}
                  style={({ pressed }) => [
                    styles.cell,
                    styles.day,
                    {
                      borderColor: selected ? theme.tint : 'transparent',
                      backgroundColor: selected ? `${theme.tint}22` : 'transparent',
                      opacity: future ? 0.25 : pressed ? 0.6 : 1,
                    },
                  ]}>
                  <ThemedText
                    type={selected || isToday ? 'smallBold' : 'small'}
                    style={{
                      color: selected
                        ? theme.tint
                        : isToday
                          ? theme.text
                          : theme.textSecondary,
                    }}>
                    {parseISO(iso).getDate()}
                  </ThemedText>
                </Pressable>
              );
            })}
          </View>
        </View>
      ) : null}
    </View>
  );
}

function Arrow({
  direction,
  label,
  onPress,
  disabled,
}: {
  direction: 'back' | 'forward';
  label: string;
  onPress: () => void;
  disabled: boolean;
}) {
  const theme = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      hitSlop={8}
      style={({ pressed }) => [
        styles.arrow,
        { borderColor: theme.border, opacity: disabled ? 0.3 : pressed ? 0.6 : 1 },
      ]}>
      <ThemedText type="smallBold" themeColor="textSecondary">
        {direction === 'back' ? '‹' : '›'}
      </ThemedText>
    </Pressable>
  );
}

function Quick({
  label,
  active,
  onPress,
}: {
  label: string;
  active: boolean;
  onPress: () => void;
}) {
  const theme = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected: active }}
      onPress={onPress}
      style={({ pressed }) => [
        styles.quickChip,
        {
          borderColor: active ? theme.tint : theme.border,
          backgroundColor: active ? `${theme.tint}1A` : 'transparent',
          opacity: pressed ? 0.7 : 1,
        },
      ]}>
      <ThemedText
        type="small"
        style={{
          color: active ? theme.tint : theme.textSecondary,
          fontWeight: active ? '700' : '500',
        }}>
        {label}
      </ThemedText>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  wrap: {
    gap: Spacing.two,
  },
  bar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    paddingHorizontal: Spacing.two,
    paddingVertical: Spacing.two,
    borderRadius: Radius.medium,
    borderWidth: StyleSheet.hairlineWidth,
  },
  current: {
    flex: 1,
    alignItems: 'center',
  },
  arrow: {
    width: 36,
    height: 36,
    borderRadius: Radius.small,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  quick: {
    flexDirection: 'row',
    gap: Spacing.two,
  },
  quickChip: {
    paddingVertical: Spacing.one,
    paddingHorizontal: Spacing.two + 2,
    borderRadius: Radius.medium,
    borderWidth: 1,
  },
  calendar: {
    gap: Spacing.two,
    padding: Spacing.two,
    borderRadius: Radius.medium,
    borderWidth: StyleSheet.hairlineWidth,
  },
  monthBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  week: {
    flexDirection: 'row',
  },
  weekday: {
    // Sevenths, so the header sits over the grid below it.
    width: `${100 / 7}%`,
    textAlign: 'center',
  },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
  },
  cell: {
    width: `${100 / 7}%`,
    height: 38,
  },
  day: {
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: Radius.small,
    borderWidth: 1,
  },
});
