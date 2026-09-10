import { useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
import {
  FlatList,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  RefreshControl,
  StyleSheet,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { DatePicker } from '@/components/date-picker';
import { ErrorState, LoadingState } from '@/components/load-state';
import { ScreenHeader } from '@/components/screen-header';
import { SyncBanner } from '@/components/sync-banner';
import { ThemedText } from '@/components/themed-text';
import { TradeBadge } from '@/components/trade-badge';
import { Avatar, Button, EmptyState, Segmented } from '@/components/ui-kit';
import { MaxContentWidth, Radius, Spacing } from '@/constants/theme';
import { useStore, type WorkerWithBalance } from '@/data/store';
import type { AttendanceStatus, BulkAttendanceMark, WorkShift } from '@/data/types';
import { useTheme } from '@/hooks/use-theme';
import { choose, confirm, notify } from '@/lib/dialog';
import {
  ATTENDANCE_GLYPHS,
  CURRENCY,
  formatDate,
  formatMoney,
  toISODate,
} from '@/lib/money';
import { postLabel } from '@/lib/trades';

const OPTIONS: { value: AttendanceStatus; short: string }[] = [
  { value: 'present', short: ATTENDANCE_GLYPHS.present },
  { value: 'half_day', short: ATTENDANCE_GLYPHS.half_day },
  { value: 'absent', short: ATTENDANCE_GLYPHS.absent },
  // Reachable per worker as well as site-wide: one person sent home in a
  // shower is not the same event as the whole site standing down.
  { value: 'rain_out', short: ATTENDANCE_GLYPHS.rain_out },
];

const SHIFTS: { value: WorkShift; label: string }[] = [
  { value: 'day', label: 'Day shift' },
  { value: 'night', label: 'Night shift' },
];

/** What one row of the grid is holding before the day is submitted. */
type Draft = {
  status?: AttendanceStatus;
  quantity?: string;
  rate?: string;
  work?: string;
};

/**
 * Mark the whole crew for one day in a single pass.
 *
 * Reached from Home rather than the tab bar: it is a task you go and do, not a
 * place you browse, and a fifth tab would crowd the four that matter.
 *
 * ONE SUBMISSION, NOT ONE PER TAP
 * -------------------------------
 * Taps build a local draft and a single POST /contractor/attendance/bulk
 * sends the day. Twenty separate requests on site data could half-succeed and
 * leave the day partly marked with no way to tell which rows landed — and a
 * piece-rate row cannot be a tap at all, because it is a quantity and a rate
 * that have to be typed.
 *
 * A worker already marked is shown locked rather than editable. The server
 * leaves them alone unless `overwrite` is set, so a resubmission after a
 * dropped response changes nothing rather than rewriting the day.
 *
 * THE DAY IS CHOSEN, NOT ASSUMED
 * ------------------------------
 * The grid defaults to today, which is what it is used for nearly every time.
 * But a site that lost signal, or a contractor who was not there on Saturday,
 * has to be able to mark the day that actually happened — and until this
 * picker existed the only way to record Saturday was to be holding the phone
 * on Saturday.
 *
 * The date drives everything on the screen and not just the payload: which
 * workers read as already marked, what the rain-out confirmation names, and
 * what the header counts. A picker that changed only the submitted date would
 * show today's locks over another day's grid, which is worse than not having
 * one — the contractor would be told a worker was already marked for a day
 * they were not.
 *
 * The future is not selectable. See `DatePicker`.
 */
export default function AttendanceScreen() {
  const theme = useTheme();
  const router = useRouter();
  const {
    workers,
    sites,
    loading,
    refreshing,
    error,
    refresh,
    getAttendanceOn,
    submitBulkAttendance,
    markRainOut,
    isOnline,
  } = useStore();
  // The day being marked. Defaults to today; the picker below can move it
  // back. Named `date` rather than `today` because it frequently is not.
  const [date, setDate] = useState(() => toISODate(new Date()));
  const today = toISODate(new Date());
  const isBackDated = date !== today;
  // Day-level rather than per worker: a site runs one shift at a time, and a
  // toggle per row would be twenty taps to say the thing once. Half day stays
  // a per-worker STATUS below - it is a different question (how much of a day)
  // from this one (which part of the clock).
  const [shift, setShift] = useState<WorkShift>('day');
  const [raining, setRaining] = useState(false);
  const [saving, setSaving] = useState(false);
  const [rowError, setRowError] = useState<string | null>(null);

  /** worker id -> what has been entered for them, before submitting. */
  const [drafts, setDrafts] = useState<Record<number, Draft>>({});

  // Rain-out is a site-wide event, so it needs a site. With exactly one it is
  // unambiguous; with several the contractor is asked which one, because
  // guessing would mark the wrong crew.
  const sitesWithCrew = sites.filter((site) =>
    workers.some((worker) => worker.site_id === site.id)
  );

  const markedCount = workers.filter((worker) => getAttendanceOn(worker.id, date)).length;
  const hasData = workers.length > 0;

  function setDraft(workerId: number, patch: Draft) {
    setRowError(null);
    setDrafts((current) => ({ ...current, [workerId]: { ...current[workerId], ...patch } }));
  }

  /**
   * The rows that are actually ready to send.
   *
   * A piece-rate row needs BOTH a quantity and a rate — the API refuses half
   * of one, and half of one on screen means the contractor is mid-typing
   * rather than finished.
   *
   * `getAttendanceOn` reads the ledger the store already holds. For a day
   * older than that ledger reaches it finds nothing and the row draws
   * unlocked, which is a display limit rather than a hazard: `overwrite` is
   * not set, so the server leaves an existing mark alone and counts it as
   * `unchanged`, and the confirmation names that count.
   */
  const marks = useMemo<BulkAttendanceMark[]>(() => {
    const out: BulkAttendanceMark[] = [];

    for (const worker of workers) {
      if (getAttendanceOn(worker.id, date)) continue; // already marked, locked
      const draft = drafts[worker.id];
      if (!draft) continue;

      if (worker.wage_type === 'piece_rate') {
        const quantity = Number.parseFloat(draft.quantity ?? '');
        const rate = Number.parseFloat(draft.rate ?? '');
        if (!Number.isFinite(quantity) || quantity <= 0) continue;
        if (!Number.isFinite(rate) || rate <= 0) continue;
        out.push({
          worker_id: worker.id,
          quantity,
          rate,
          work_description: draft.work?.trim() || 'Piece work',
          // Somebody who laid 120 sq ft was evidently there. Sent explicitly
          // so the row reads the same whichever way it was entered.
          status: draft.status ?? 'present',
          shift,
        });
      } else if (draft.status) {
        out.push({ worker_id: worker.id, status: draft.status, shift });
      }
    }

    return out;
  }, [workers, drafts, getAttendanceOn, date, shift]);

  /** What the piece-rate rows in the draft come to, for the footer. */
  const draftPieceTotal = useMemo(
    () =>
      marks.reduce(
        (sum, mark) =>
          mark.quantity && mark.rate ? sum + mark.quantity * mark.rate : sum,
        0
      ),
    [marks]
  );

  async function save() {
    if (marks.length === 0) return;
    setSaving(true);
    setRowError(null);
    try {
      const result = await submitBulkAttendance({
        marks,
        date,
        // Only meaningful when the whole crew is on one site; the server
        // falls back to each worker's own posting for the rest.
        site_id: sitesWithCrew.length === 1 ? sitesWithCrew[0].id : null,
      });
      setDrafts({});

      notify(
        isBackDated ? `${formatDate(date)} recorded` : 'Day recorded',
        [
          `${result.created} marked${result.updated ? `, ${result.updated} changed` : ''}`,
          result.unchanged ? `${result.unchanged} were already marked` : null,
          result.piece_rate_logs.length
            ? `${CURRENCY}${formatMoney(result.piece_rate_total)} of piece work logged`
            : null,
          // Named explicitly. Money quietly coming off a worker's balance is
          // the thing they will ask about, and the contractor should not learn
          // it happened from the worker.
          result.deductions_applied
            ? `${CURRENCY}${formatMoney(
                result.deductions_applied
              )} recovered in installments`
            : null,
        ]
          .filter(Boolean)
          .join('\n')
      );
    } catch (caught) {
      // Stay on the grid so nothing typed is lost.
      const message = (caught as Error).message;
      setRowError(message);
      notify('Could not record the day', message);
    } finally {
      setSaving(false);
    }
  }

  async function runRainOut(siteId: number, siteName: string) {
    setRaining(true);
    setRowError(null);
    try {
      const result = await markRainOut(siteId, { date });
      notify(
        'Rain-out recorded',
        [
          `${result.created} newly marked at ${siteName} on ${formatDate(date)}`,
          result.updated ? `${result.updated} changed from an earlier status` : null,
          result.unchanged ? `${result.unchanged} already rained out` : null,
        ]
          .filter(Boolean)
          .join('\n')
      );
    } catch (caught) {
      const message = (caught as Error).message;
      setRowError(message);
      notify('Could not mark rain-out', message);
    } finally {
      setRaining(false);
    }
  }

  async function confirmRainOut() {
    if (sitesWithCrew.length === 0) {
      notify(
        'No site to mark',
        'Rain-out marks everyone posted to one site. Add a site and assign your crew to it first.'
      );
      return;
    }

    // One site: straight to the confirmation. Several: pick first, because
    // marking the wrong crew is silent and annoying to unpick.
    let target = sitesWithCrew[0];
    if (sitesWithCrew.length > 1) {
      const siteId = await choose<number>({
        title: 'Which site?',
        message: 'Rain-out applies to one site at a time.',
        options: sitesWithCrew.map((site) => ({ label: site.name, value: site.id })),
      });
      if (siteId === null) return;
      target = sitesWithCrew.find((site) => site.id === siteId) ?? target;
    }

    await askThenMark(target.id, target.name);
  }

  async function askThenMark(siteId: number, siteName: string) {
    const count = workers.filter((worker) => worker.site_id === siteId).length;
    const ok = await confirm({
      title: 'Mark all workers absent due to weather?',
      message:
        `All ${count} worker${count === 1 ? '' : 's'} at ${siteName} will be marked rained out ` +
        `for ${formatDate(date)}. Anyone already marked present that day will be changed.`,
      confirmLabel: 'Mark rain-out',
      destructive: true,
    });
    if (!ok) return;

    await runRainOut(siteId, siteName);
  }

  const body = () => {
    if (loading && !hasData) return <LoadingState label="Loading your crew…" />;
    if (error && !hasData) return <ErrorState message={error} onRetry={refresh} />;

    return (
      <FlatList
        data={workers}
        keyExtractor={(worker) => String(worker.id)}
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor={theme.tint} />
        }
        ListHeaderComponent={
          <View style={styles.header}>
            <SyncBanner />

            {/* Standing reminder while the grid is off today. Everything on
                this screen — the locks, the counts, the rain-out — is about
                the chosen day, and it should not be possible to submit a
                back-dated day believing it was today's. */}
            {isBackDated ? (
              <View
                style={[
                  styles.backDated,
                  { borderColor: theme.warning, backgroundColor: `${theme.warning}1A` },
                ]}>
                <ThemedText type="small" style={{ color: theme.warning }}>
                  Marking {formatDate(date)}, not today. Wages and any advance
                  installments are recorded against that day.
                </ThemedText>
              </View>
            ) : null}

            <Button
              title={raining ? 'Marking…' : '🌧  Mark Rain-Out'}
              variant="secondary"
              loading={raining}
              disabled={!isOnline || workers.length === 0}
              onPress={() => void confirmRainOut()}
            />
            {rowError || error ? (
              <ThemedText type="small" style={[styles.inlineError, { color: theme.negative }]}>
                {rowError ?? error}
              </ThemedText>
            ) : null}
            {!isOnline ? (
              <ThemedText type="small" style={{ color: theme.warning }}>
                You are offline. The day is sent as one request and is not queued — it needs
                a connection.
              </ThemedText>
            ) : null}
          </View>
        }
        renderItem={({ item }) => (
          <WorkerRow
            worker={item}
            existing={getAttendanceOn(item.id, date)?.status}
            backDated={isBackDated}
            draft={drafts[item.id]}
            onChange={(patch) => setDraft(item.id, patch)}
          />
        )}
        ItemSeparatorComponent={() => (
          <View style={[styles.separator, { backgroundColor: theme.border }]} />
        )}
        ListEmptyComponent={
          <EmptyState title="No workers yet" message="Add a worker before marking attendance." />
        }
        ListFooterComponent={
          <View style={styles.footer}>
            <ThemedText type="small" themeColor="textSecondary">
              {ATTENDANCE_GLYPHS.present} = present · {ATTENDANCE_GLYPHS.half_day} = half day ·{' '}
              {ATTENDANCE_GLYPHS.absent} = absent · {ATTENDANCE_GLYPHS.rain_out} = rained out.
              One entry per worker per day. Piece-rate workers are paid on quantity × rate
              instead.
            </ThemedText>
            {draftPieceTotal > 0 ? (
              <ThemedText type="small" themeColor="textSecondary">
                Piece work in this batch: {CURRENCY}
                {formatMoney(draftPieceTotal)}
              </ThemedText>
            ) : null}
          </View>
        }
      />
    );
  };

  return (
    <SafeAreaView style={[styles.screen, { backgroundColor: theme.background }]} edges={['top']}>
      <ScreenHeader
        title="Attendance"
        subtitle={`${formatDate(date)} · ${markedCount} of ${workers.length} marked`}
        onBack={() => router.back()}
      />

      <View style={styles.shiftBar}>
        <DatePicker
          value={date}
          onChange={(next) => {
            // Drafts belong to the day they were typed for. Carrying them
            // across would silently file Tuesday's typed quantities against
            // Saturday, so the grid starts clean on every change.
            setDate(next);
            setDrafts({});
            setRowError(null);
          }}
          label="Day being marked"
        />
        <Segmented options={SHIFTS} value={shift} onChange={setShift} />
      </View>
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        {body()}

        {marks.length > 0 ? (
          <View
            style={[
              styles.saveBar,
              { backgroundColor: theme.backgroundElement, borderColor: theme.border },
            ]}>
            <Button
              title={
                saving
                  ? 'Saving…'
                  : // Names the day when it is not today, so the last thing
                    // read before committing payroll is which day it lands on.
                    `Save ${marks.length} ${marks.length === 1 ? 'worker' : 'workers'}` +
                    (isBackDated ? ` for ${formatDate(date)}` : '')
              }
              loading={saving}
              disabled={!isOnline}
              onPress={() => void save()}
            />
          </View>
        ) : null}
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

/**
 * One worker's row.
 *
 * Split out of the list so a keystroke in a piece-rate field re-renders that
 * row rather than the whole crew — on a twenty-person site the difference is
 * the keyboard feeling attached to the input or not.
 */
function WorkerRow({
  worker,
  existing,
  backDated,
  draft,
  onChange,
}: {
  worker: WorkerWithBalance;
  existing?: AttendanceStatus;
  /** Only to word the row correctly — "Marked" rather than "Marked for today". */
  backDated: boolean;
  draft?: Draft;
  onChange: (patch: Draft) => void;
}) {
  const theme = useTheme();
  const locked = existing !== undefined;
  const isPiece = worker.wage_type === 'piece_rate';

  const quantity = Number.parseFloat(draft?.quantity ?? '');
  const rate = Number.parseFloat(draft?.rate ?? '');
  const lineTotal =
    Number.isFinite(quantity) && Number.isFinite(rate) && quantity > 0 && rate > 0
      ? quantity * rate
      : null;

  const subtitle = [
    // `postLabel` rather than the catalogue's own label: posts are free text
    // now, and a custom one still has to name itself here.
    postLabel(worker.trade),
    locked
      ? backDated
        ? 'Already marked for this day'
        : 'Marked for today'
      : isPiece
        ? 'Paid by the piece'
        : 'Not marked yet',
  ]
    .filter(Boolean)
    .join(' · ');

  return (
    <View style={styles.row}>
      <View style={styles.rowTop}>
        <Avatar name={worker.name} size={40} />

        <View style={styles.rowBody}>
          <View style={styles.nameRow}>
            {/* Compact here: the controls already own the right half of the
                row, so the icon carries the trade and the label moves down. */}
            <TradeBadge trade={worker.trade} compact />
            <ThemedText type="smallBold" numberOfLines={1} style={styles.name}>
              {worker.name}
            </ThemedText>
          </View>
          <ThemedText type="small" themeColor="textSecondary" numberOfLines={1}>
            {subtitle}
          </ThemedText>
        </View>

        {/* A piece-rate worker still gets a status, but it is not what pays
            them, so it drops below the inputs rather than competing with the
            two numbers that do. */}
        {isPiece && !locked ? null : (
          <View style={styles.options}>
            {OPTIONS.map((option) => {
              const selected = locked
                ? existing === option.value
                : draft?.status === option.value;
              const dimmed = locked && !selected;
              const tint = {
                present: theme.positive,
                half_day: theme.warning,
                absent: theme.negative,
                rain_out: theme.tint,
              }[option.value];

              return (
                <Pressable
                  key={option.value}
                  accessibilityRole="button"
                  accessibilityLabel={`Mark ${worker.name} ${option.value.replace('_', ' ')}`}
                  accessibilityState={{ selected, disabled: locked }}
                  disabled={locked}
                  onPress={() => onChange({ status: option.value })}
                  style={({ pressed }) => [
                    styles.option,
                    {
                      borderColor: selected ? tint : theme.border,
                      backgroundColor: selected ? `${tint}22` : 'transparent',
                      opacity: dimmed ? 0.25 : pressed ? 0.6 : 1,
                    },
                  ]}>
                  <ThemedText
                    type="smallBold"
                    style={{ color: selected ? tint : theme.textSecondary }}>
                    {option.short}
                  </ThemedText>
                </Pressable>
              );
            })}
          </View>
        )}
      </View>

      {isPiece && !locked ? (
        <View style={styles.pieceBlock}>
          <View style={styles.pieceInputs}>
            <PieceField
              label="Quantity"
              placeholder="120"
              value={draft?.quantity ?? ''}
              onChangeText={(quantityText) => onChange({ quantity: quantityText })}
            />
            <ThemedText type="small" themeColor="textSecondary" style={styles.times}>
              ×
            </ThemedText>
            <PieceField
              label="Rate"
              placeholder={`${CURRENCY}18`}
              value={draft?.rate ?? ''}
              onChangeText={(rateText) => onChange({ rate: rateText })}
            />
            <View style={styles.lineTotal}>
              <ThemedText type="small" themeColor="textSecondary">
                Earns
              </ThemedText>
              <ThemedText
                type="smallBold"
                style={{ color: lineTotal ? theme.positive : theme.textSecondary }}>
                {lineTotal ? `${CURRENCY}${formatMoney(lineTotal)}` : '—'}
              </ThemedText>
            </View>
          </View>

          <TextInput
            value={draft?.work ?? ''}
            onChangeText={(work) => onChange({ work })}
            placeholder="What was measured? e.g. Tiling, 2nd floor bedrooms"
            placeholderTextColor={theme.textSecondary}
            maxLength={255}
            style={[
              styles.workInput,
              {
                color: theme.text,
                backgroundColor: theme.backgroundElement,
                borderColor: theme.border,
              },
            ]}
          />
        </View>
      ) : null}
    </View>
  );
}

function PieceField({
  label,
  value,
  placeholder,
  onChangeText,
}: {
  label: string;
  value: string;
  placeholder: string;
  onChangeText: (value: string) => void;
}) {
  const theme = useTheme();
  return (
    <View style={styles.pieceField}>
      <ThemedText type="small" themeColor="textSecondary">
        {label}
      </ThemedText>
      <TextInput
        value={value}
        onChangeText={onChangeText}
        keyboardType="decimal-pad"
        placeholder={placeholder}
        placeholderTextColor={theme.textSecondary}
        accessibilityLabel={label}
        style={[
          styles.pieceInput,
          {
            color: theme.text,
            backgroundColor: theme.backgroundElement,
            borderColor: theme.border,
          },
        ]}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
  },
  flex: {
    flex: 1,
  },
  content: {
    paddingBottom: Spacing.five,
    maxWidth: MaxContentWidth,
    width: '100%',
    alignSelf: 'center',
  },
  row: {
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two + 2,
    gap: Spacing.two,
  },
  rowTop: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
  },
  rowBody: {
    flex: 1,
    gap: 1,
  },
  nameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
  },
  name: {
    flexShrink: 1,
  },
  options: {
    flexDirection: 'row',
    gap: Spacing.two,
  },
  option: {
    width: 40,
    height: 36,
    borderRadius: Radius.small,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pieceBlock: {
    gap: Spacing.two,
    paddingLeft: 40 + Spacing.three,
  },
  pieceInputs: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: Spacing.two,
  },
  pieceField: {
    flex: 1,
    gap: 2,
  },
  pieceInput: {
    minHeight: 44,
    borderRadius: Radius.small,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: Spacing.two,
    fontSize: 16,
  },
  times: {
    paddingBottom: Spacing.three,
  },
  lineTotal: {
    minWidth: 78,
    alignItems: 'flex-end',
    gap: 2,
    paddingBottom: Spacing.two,
  },
  workInput: {
    minHeight: 40,
    borderRadius: Radius.small,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: Spacing.two,
    fontSize: 14,
  },
  separator: {
    height: StyleSheet.hairlineWidth,
    marginLeft: Spacing.three + 40 + Spacing.three,
  },
  footer: {
    gap: Spacing.two,
    paddingHorizontal: Spacing.three,
    paddingTop: Spacing.three,
  },
  inlineError: {
    paddingBottom: Spacing.two,
  },
  header: {
    gap: Spacing.two,
    paddingHorizontal: Spacing.three,
    paddingBottom: Spacing.two,
  },
  shiftBar: {
    gap: Spacing.three,
    paddingHorizontal: Spacing.three,
    paddingBottom: Spacing.three,
    maxWidth: MaxContentWidth,
    width: '100%',
    alignSelf: 'center',
  },
  backDated: {
    paddingHorizontal: Spacing.two,
    paddingVertical: Spacing.two,
    borderRadius: Radius.small,
    borderWidth: StyleSheet.hairlineWidth,
  },
  saveBar: {
    paddingHorizontal: Spacing.three,
    paddingTop: Spacing.two,
    paddingBottom: Spacing.three,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
});
