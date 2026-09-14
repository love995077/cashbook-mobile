import { Image } from 'expo-image';
import * as ImagePicker from 'expo-image-picker';
import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { API_BASE_URL } from '@/api/client';
import { ThemedText } from '@/components/themed-text';
import { Button, Card, EmptyState, Field } from '@/components/ui-kit';
import { MaxContentWidth, Radius, Spacing } from '@/constants/theme';
import { useStore } from '@/data/store';
import type { MachineryLog, MachineryTotals } from '@/data/types';
import { useTheme } from '@/hooks/use-theme';
import { confirm, notify } from '@/lib/dialog';
import { CURRENCY, formatMoney, formatRelativeDate, toISODate } from '@/lib/money';

/** Uploaded at 70% JPEG, same as the challan and the site gallery. */
const QUALITY = 0.7;

type Pending = { uri: string; mimeType?: string; name?: string };

/**
 * Plant and the diesel it drinks.
 *
 * The cost that surprises a contractor at the end of a job is rarely the
 * wages — those are counted every day — it is the fuel nobody wrote down. So
 * this tab is deliberately reachable by a supervisor: the person who can say
 * how long the mixer ran is the person standing next to it.
 *
 * Litres are asked for alongside the cost rather than instead of it. A rising
 * fuel bill is either the machine or the market, and only the litres separate
 * the two — which is the whole reason to write any of this down.
 *
 * The totals come from their own request rather than a sum over the list: the
 * list is capped, and a long job would otherwise show a header that added up
 * only the page it drew.
 */
export function MachineryTab({ siteId }: { siteId: number }) {
  const theme = useTheme();
  const { getMachineryLogs, getMachineryTotals, removeMachineryLog } = useStore();

  const [logs, setLogs] = useState<MachineryLog[]>([]);
  const [totals, setTotals] = useState<MachineryTotals | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);

  const load = useCallback(
    async (controller?: AbortController) => {
      try {
        const [rows, sums] = await Promise.all([
          getMachineryLogs(siteId, controller?.signal),
          getMachineryTotals(siteId, controller?.signal),
        ]);
        if (controller?.signal.aborted) return;
        setLogs(rows);
        setTotals(sums);
      } catch (caught) {
        if (!controller?.signal.aborted) setError((caught as Error).message);
      } finally {
        if (!controller?.signal.aborted) setLoading(false);
      }
    },
    [siteId, getMachineryLogs, getMachineryTotals]
  );

  useEffect(() => {
    const controller = new AbortController();
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load(controller);
    return () => controller.abort();
  }, [load]);

  async function confirmRemove(log: MachineryLog) {
    const ok = await confirm({
      title: 'Delete this log?',
      message:
        `${log.machine_name} on ${formatRelativeDate(log.date)} — ` +
        `${log.hours_operated} h, ${CURRENCY}${formatMoney(log.fuel_cost)} of fuel.`,
      confirmLabel: 'Delete',
      cancelLabel: 'Keep',
      destructive: true,
    });
    if (!ok) return;

    try {
      await removeMachineryLog(siteId, log.id);
      await load();
    } catch (caught) {
      const message = (caught as Error).message;
      setError(message);
      notify('Could not delete', message);
    }
  }

  return (
    <View style={styles.wrap}>
      <View style={styles.header}>
        <ThemedText type="smallBold" themeColor="textSecondary">
          PLANT AND DIESEL
        </ThemedText>
        <ThemedText type="small" themeColor="textSecondary">
          {totals?.log_count ?? 0} log{(totals?.log_count ?? 0) === 1 ? '' : 's'}
        </ThemedText>
      </View>

      {totals && totals.log_count > 0 ? (
        <Card style={styles.totals}>
          <View style={styles.totalsRow}>
            <Total label="Fuel spent" value={`${CURRENCY}${formatMoney(totals.fuel_cost)}`} tone={theme.negative} />
            <Total label="Diesel" value={`${totals.diesel_litres} L`} tone={theme.text} />
            <Total label="Hours run" value={`${totals.hours_operated} h`} tone={theme.text} />
          </View>

          {totals.by_machine.length > 1 ? (
            <>
              <View style={[styles.divider, { backgroundColor: theme.border }]} />
              {totals.by_machine.map((machine) => (
                <View key={machine.machine_name} style={styles.machineRow}>
                  <ThemedText type="small" numberOfLines={1} style={styles.machineName}>
                    {machine.machine_name}
                  </ThemedText>
                  <ThemedText type="small" themeColor="textSecondary">
                    {machine.hours_operated} h · {machine.diesel_litres} L
                  </ThemedText>
                  <ThemedText type="smallBold">
                    {CURRENCY}
                    {formatMoney(machine.fuel_cost)}
                  </ThemedText>
                </View>
              ))}
            </>
          ) : null}
        </Card>
      ) : null}

      <Button title="🚜  Log a machine" onPress={() => setShowForm(true)} />

      {error ? (
        <ThemedText type="small" style={{ color: theme.negative }}>
          {error}
        </ThemedText>
      ) : null}

      {loading ? (
        <ActivityIndicator color={theme.tint} style={styles.loading} />
      ) : logs.length === 0 ? (
        <EmptyState
          title="No machinery logged"
          message="Record the hours a machine ran and what its diesel cost, and the fuel stops being the number nobody wrote down."
        />
      ) : (
        <Card style={styles.list}>
          {logs.map((log, index) => (
            <View key={log.id}>
              {index > 0 ? (
                <View style={[styles.divider, { backgroundColor: theme.border }]} />
              ) : null}
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`Delete the ${log.machine_name} log`}
                onLongPress={() => void confirmRemove(log)}
                style={({ pressed }) => [styles.logRow, pressed && { opacity: 0.7 }]}>
                {log.receipt_image_url ? (
                  <Image
                    source={{ uri: absolute(log.receipt_image_url) }}
                    style={styles.thumb}
                    contentFit="cover"
                  />
                ) : (
                  <View style={[styles.thumb, styles.thumbEmpty, { borderColor: theme.border }]}>
                    <ThemedText type="small" themeColor="textSecondary">
                      🚜
                    </ThemedText>
                  </View>
                )}

                <View style={styles.logBody}>
                  <ThemedText type="smallBold" numberOfLines={1}>
                    {log.machine_name}
                  </ThemedText>
                  <ThemedText type="small" themeColor="textSecondary" numberOfLines={1}>
                    {[
                      formatRelativeDate(log.date),
                      log.hours_operated ? `${log.hours_operated} h` : null,
                      log.diesel_litres ? `${log.diesel_litres} L` : null,
                      log.logged_by_name,
                    ]
                      .filter(Boolean)
                      .join(' · ')}
                  </ThemedText>
                </View>

                <ThemedText type="smallBold" style={{ color: theme.negative }}>
                  {CURRENCY}
                  {formatMoney(log.fuel_cost)}
                </ThemedText>
              </Pressable>
            </View>
          ))}
        </Card>
      )}

      {logs.length > 0 ? (
        <ThemedText type="small" themeColor="textSecondary">
          Press and hold a log to delete it.
        </ThemedText>
      ) : null}

      <LogMachineryModal
        siteId={siteId}
        visible={showForm}
        onClose={() => setShowForm(false)}
        onLogged={() => void load()}
      />
    </View>
  );
}

function Total({ label, value, tone }: { label: string; value: string; tone: string }) {
  return (
    <View style={styles.total}>
      <ThemedText type="smallBold" style={{ color: tone }} numberOfLines={1} adjustsFontSizeToFit>
        {value}
      </ThemedText>
      <ThemedText type="small" themeColor="textSecondary" numberOfLines={1}>
        {label}
      </ThemedText>
    </View>
  );
}

/**
 * The log form.
 *
 * All three numbers default to zero and at least one must be filled: a site
 * can record fuel without hours (a tanker delivery) or hours without fuel (a
 * machine on the hire company's own diesel), but a log where everything is
 * zero is a form submitted before it was filled in, and the API refuses it.
 *
 * The receipt photo is asked for and not required, same as the delivery
 * challan — a pump at nine at night with no printer still has to be
 * recordable.
 */
function LogMachineryModal({
  siteId,
  visible,
  onClose,
  onLogged,
}: {
  siteId: number;
  visible: boolean;
  onClose: () => void;
  onLogged: () => void;
}) {
  const theme = useTheme();
  const { addMachineryLog, isOnline } = useStore();

  const [machineName, setMachineName] = useState('');
  const [hours, setHours] = useState('');
  const [litres, setLitres] = useState('');
  const [cost, setCost] = useState('');
  const [note, setNote] = useState('');
  const [receipt, setReceipt] = useState<Pending | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function reset() {
    setMachineName('');
    setHours('');
    setLitres('');
    setCost('');
    setNote('');
    setReceipt(null);
    setError(null);
  }

  async function capture(from: 'camera' | 'library') {
    setError(null);

    const permission =
      from === 'camera'
        ? await ImagePicker.requestCameraPermissionsAsync()
        : await ImagePicker.requestMediaLibraryPermissionsAsync();

    if (!permission.granted) {
      notify(
        from === 'camera' ? 'Camera needed' : 'Photos needed',
        'Allow access in Settings to photograph the diesel receipt.'
      );
      return;
    }

    const options: ImagePicker.ImagePickerOptions = {
      mediaTypes: ['images'],
      quality: QUALITY,
      // No editor: a cropped receipt loses the pump reading and the total,
      // which are the two things anybody ever goes back to it for.
      allowsEditing: false,
    };

    const result =
      from === 'camera'
        ? await ImagePicker.launchCameraAsync(options)
        : await ImagePicker.launchImageLibraryAsync(options);

    if (result.canceled || !result.assets?.length) return;

    const asset = result.assets[0];
    setReceipt({
      uri: asset.uri,
      mimeType: asset.mimeType ?? 'image/jpeg',
      name: asset.fileName ?? 'diesel-receipt.jpg',
    });
  }

  /** Blank reads as zero; anything unparseable reads as invalid. */
  function readNumber(value: string): number | null {
    if (!value.trim()) return 0;
    const parsed = Number.parseFloat(value);
    return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
  }

  async function save() {
    setError(null);

    const name = machineName.trim();
    if (!name) {
      setError('Name the machine — JCB, mixer, hoist');
      return;
    }

    const hoursValue = readNumber(hours);
    const litresValue = readNumber(litres);
    const costValue = readNumber(cost);

    if (hoursValue === null || litresValue === null || costValue === null) {
      setError('Hours, litres and cost must be numbers, and none can be negative');
      return;
    }
    if (hoursValue > 24) {
      setError('A machine cannot run more than 24 hours in one day');
      return;
    }
    if (!hoursValue && !litresValue && !costValue) {
      setError('Record at least one of hours run, diesel taken or fuel cost');
      return;
    }

    setSaving(true);
    try {
      const log = await addMachineryLog(
        siteId,
        {
          machine_name: name,
          hours_operated: hoursValue,
          diesel_litres: litresValue,
          fuel_cost: costValue,
          date: toISODate(new Date()),
          note: note.trim() || null,
        },
        receipt
      );

      onLogged();
      reset();
      onClose();
      notify(
        'Machine logged',
        `${log.machine_name}: ${log.hours_operated} h run, ${log.diesel_litres} L of diesel, ` +
          `${CURRENCY}${formatMoney(log.fuel_cost)}.`
      );
    } catch (caught) {
      setError((caught as Error).message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet">
      <SafeAreaView style={[styles.modal, { backgroundColor: theme.background }]}>
        <View style={styles.titleBar}>
          <ThemedText type="smallBold">Log a machine</ThemedText>
          <Button title="Cancel" variant="ghost" onPress={onClose} disabled={saving} />
        </View>

        <ScrollView contentContainerStyle={styles.modalContent} keyboardShouldPersistTaps="handled">
          <Field
            label="Machine"
            value={machineName}
            onChangeText={setMachineName}
            placeholder="JCB"
            hint="Free text — whatever was on site today."
            maxLength={120}
            autoCapitalize="words"
            returnKeyType="next"
          />

          <Field
            label="Hours run"
            value={hours}
            onChangeText={setHours}
            keyboardType="decimal-pad"
            placeholder="7.5"
            returnKeyType="next"
          />

          <Field
            label="Diesel taken (litres)"
            value={litres}
            onChangeText={setLitres}
            keyboardType="decimal-pad"
            placeholder="42"
            hint="Worth filling in even when the cost is known: a rising bill is either the machine or the market, and only the litres tell you which."
            returnKeyType="next"
          />

          <Field
            label="Fuel cost"
            value={cost}
            onChangeText={setCost}
            keyboardType="decimal-pad"
            placeholder="3990"
            hint="What the receipt says, not litres times a rate — the rate changes between pumps."
            returnKeyType="next"
          />

          <Field
            label="Note (optional)"
            value={note}
            onChangeText={setNote}
            placeholder="Foundation dig, north side"
            maxLength={255}
            returnKeyType="done"
          />

          <View style={styles.section}>
            <ThemedText type="smallBold" themeColor="textSecondary">
              DIESEL RECEIPT
            </ThemedText>

            {receipt ? (
              <View style={[styles.receiptCard, { borderColor: theme.border }]}>
                <Image source={{ uri: receipt.uri }} style={styles.preview} contentFit="cover" />
                <Button title="Retake" variant="ghost" onPress={() => void capture('camera')} />
              </View>
            ) : (
              <View style={styles.actions}>
                <View style={styles.action}>
                  <Button title="📷 Photograph receipt" onPress={() => void capture('camera')} />
                </View>
                <View style={styles.action}>
                  <Button
                    title="Choose"
                    variant="secondary"
                    onPress={() => void capture('library')}
                  />
                </View>
              </View>
            )}
          </View>

          {!isOnline ? (
            <ThemedText type="small" style={{ color: theme.warning }}>
              You are offline. A machinery log carries a photo and is not queued — it needs a
              connection.
            </ThemedText>
          ) : null}

          {error ? (
            <ThemedText type="small" style={{ color: theme.negative }}>
              {error}
            </ThemedText>
          ) : null}

          <Button
            title={saving ? 'Logging…' : 'Log the machine'}
            loading={saving}
            disabled={!isOnline}
            onPress={() => void save()}
          />
        </ScrollView>
      </SafeAreaView>
    </Modal>
  );
}

/** The API returns app-relative media paths so links survive a host change. */
function absolute(url: string): string {
  return url.startsWith('http') ? url : `${API_BASE_URL}${url}`;
}

const styles = StyleSheet.create({
  wrap: {
    gap: Spacing.three,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  totals: {
    gap: Spacing.three,
  },
  totalsRow: {
    flexDirection: 'row',
    gap: Spacing.two,
  },
  total: {
    flex: 1,
    gap: 1,
  },
  machineRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.two,
    paddingVertical: Spacing.one,
  },
  machineName: {
    flex: 1,
  },
  loading: {
    paddingVertical: Spacing.four,
  },
  list: {
    padding: 0,
    paddingHorizontal: Spacing.three,
  },
  logRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
    paddingVertical: Spacing.two + 2,
  },
  logBody: {
    flex: 1,
    gap: 1,
  },
  thumb: {
    width: 40,
    height: 40,
    borderRadius: Radius.small,
  },
  thumbEmpty: {
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: StyleSheet.hairlineWidth,
  },
  divider: {
    height: StyleSheet.hairlineWidth,
  },
  modal: {
    flex: 1,
  },
  titleBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
  },
  modalContent: {
    gap: Spacing.three,
    padding: Spacing.three,
    paddingBottom: Spacing.six,
    maxWidth: MaxContentWidth,
    width: '100%',
    alignSelf: 'center',
  },
  section: {
    gap: Spacing.two,
  },
  receiptCard: {
    gap: Spacing.two,
    padding: Spacing.two,
    borderRadius: Radius.medium,
    borderWidth: StyleSheet.hairlineWidth,
  },
  preview: {
    width: '100%',
    height: 180,
    borderRadius: Radius.small,
  },
  actions: {
    flexDirection: 'row',
    gap: Spacing.two,
  },
  action: {
    flex: 1,
  },
});
