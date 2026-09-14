import { Image } from 'expo-image';
import * as ImagePicker from 'expo-image-picker';
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Modal, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { Button, Card, EmptyState, Field, Segmented } from '@/components/ui-kit';
import { MaxContentWidth, Radius, Spacing } from '@/constants/theme';
import { useStore } from '@/data/store';
import type { MaterialUnit, SiteInventoryItem } from '@/data/types';
import { useTheme } from '@/hooks/use-theme';
import { choose, notify } from '@/lib/dialog';
import { formatRelativeDate, toISODate } from '@/lib/money';

/**
 * How a material is counted, and what to call it on screen.
 *
 * A short list rather than all ten the API accepts: these are what actually
 * turns up at a site gate, and a picker with ten options is a picker nobody
 * scrolls. An item already tracked in another unit keeps that unit — the
 * server refuses a change rather than converting, because nobody here knows
 * how many kg are in a brass of sand.
 */
const UNITS: { value: MaterialUnit; label: string }[] = [
  { value: 'bag', label: 'Bags' },
  { value: 'ton', label: 'Tons' },
  { value: 'piece', label: 'Pieces' },
  { value: 'brass', label: 'Brass' },
];

export const UNIT_LABELS: Record<MaterialUnit, string> = {
  bag: 'bags',
  ton: 'tons',
  kg: 'kg',
  litre: 'litres',
  piece: 'pieces',
  cubic_feet: 'cu ft',
  cubic_metre: 'cu m',
  brass: 'brass',
  square_feet: 'sq ft',
  running_feet: 'rft',
};

/** Uploaded at 70% JPEG, same as the site gallery — see that file for why. */
const QUALITY = 0.7;

type Pending = { uri: string; mimeType?: string; name?: string };

/**
 * Live stock at the site, and the button that adds to it.
 *
 * Accepting a delivery files the receipt and moves the stock in one
 * server-side transaction, so the two can never disagree about what arrived.
 */
export function SiteStock({ siteId }: { siteId: number }) {
  const theme = useTheme();
  const { getSiteInventory } = useStore();

  const [stock, setStock] = useState<SiteInventoryItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);

  const load = useCallback(
    async (controller?: AbortController) => {
      try {
        const rows = await getSiteInventory(siteId, controller?.signal);
        if (!controller?.signal.aborted) setStock(rows);
      } catch (caught) {
        if (!controller?.signal.aborted) setError((caught as Error).message);
      } finally {
        if (!controller?.signal.aborted) setLoading(false);
      }
    },
    [siteId, getSiteInventory]
  );

  useEffect(() => {
    const controller = new AbortController();
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load(controller);
    return () => controller.abort();
  }, [load]);

  return (
    <View style={styles.wrap}>
      <View style={styles.header}>
        <ThemedText type="smallBold" themeColor="textSecondary">
          SITE STOCK
        </ThemedText>
        <ThemedText type="small" themeColor="textSecondary">
          {stock.length} item{stock.length === 1 ? '' : 's'}
        </ThemedText>
      </View>

      <Button title="📦  Receive material" onPress={() => setShowForm(true)} />

      {error ? (
        <ThemedText type="small" style={{ color: theme.negative }}>
          {error}
        </ThemedText>
      ) : null}

      {loading ? (
        <ActivityIndicator color={theme.tint} style={styles.loading} />
      ) : stock.length === 0 ? (
        <EmptyState
          title="Nothing in stock"
          message="Record a delivery and its challan photo, and what is on the ground gets counted here."
        />
      ) : (
        <Card style={styles.stockCard}>
          {stock.map((item, index) => (
            <View key={item.id}>
              {index > 0 ? (
                <View style={[styles.separator, { backgroundColor: theme.border }]} />
              ) : null}
              <View style={styles.stockRow}>
                <View style={styles.stockBody}>
                  <ThemedText type="small" numberOfLines={1}>
                    {item.item_name}
                  </ThemedText>
                  <ThemedText type="small" themeColor="textSecondary">
                    Updated {formatRelativeDate(item.updated_at.slice(0, 10))}
                  </ThemedText>
                </View>
                <ThemedText type="smallBold">
                  {item.quantity_in_stock} {UNIT_LABELS[item.unit]}
                </ThemedText>
              </View>
            </View>
          ))}
        </Card>
      )}

      <ReceiveMaterialModal
        siteId={siteId}
        visible={showForm}
        onClose={() => setShowForm(false)}
        onReceived={() => void load()}
      />
    </View>
  );
}

/**
 * The Goods Receipt Note form.
 *
 * The challan photo is pushed hard for and not strictly required: a delivery
 * arriving in the rain with no paper still has to be recordable. But a GRN
 * nobody photographed is a number somebody typed, and that difference matters
 * when the supplier's invoice turns up, so saving without one asks first.
 */
function ReceiveMaterialModal({
  siteId,
  visible,
  onClose,
  onReceived,
}: {
  siteId: number;
  visible: boolean;
  onClose: () => void;
  onReceived: () => void;
}) {
  const theme = useTheme();
  const { receiveMaterial, isOnline } = useStore();

  const [itemName, setItemName] = useState('');
  const [quantity, setQuantity] = useState('');
  const [unit, setUnit] = useState<MaterialUnit>('bag');
  const [supplier, setSupplier] = useState('');
  const [challan, setChallan] = useState<Pending | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function reset() {
    setItemName('');
    setQuantity('');
    setUnit('bag');
    setSupplier('');
    setChallan(null);
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
        'Allow access in Settings to photograph the delivery challan.'
      );
      return;
    }

    const options: ImagePicker.ImagePickerOptions = {
      mediaTypes: ['images'],
      quality: QUALITY,
      // No editor: a cropped challan loses the header and the totals, which
      // are the two parts anybody ever goes back to it for.
      allowsEditing: false,
    };

    const result =
      from === 'camera'
        ? await ImagePicker.launchCameraAsync(options)
        : await ImagePicker.launchImageLibraryAsync(options);

    if (result.canceled || !result.assets?.length) return;

    const asset = result.assets[0];
    setChallan({
      uri: asset.uri,
      mimeType: asset.mimeType ?? 'image/jpeg',
      name: asset.fileName ?? 'challan.jpg',
    });
  }

  async function save(force = false) {
    setError(null);

    const item = itemName.trim();
    if (!item) {
      setError('Name the material that arrived');
      return;
    }
    const value = Number.parseFloat(quantity);
    if (!Number.isFinite(value) || value <= 0) {
      setError('Enter how much arrived');
      return;
    }

    if (!challan && !force) {
      const answer = await choose<'photo' | 'anyway'>({
        title: 'No challan photo',
        message:
          'Without the paper this is just a typed number. Photograph the challan, or record it anyway.',
        options: [
          { label: 'Take photo', value: 'photo' },
          { label: 'Record anyway', value: 'anyway', destructive: true },
        ],
      });
      if (answer === 'photo') await capture('camera');
      // Backing out leaves the form exactly as it was, so the delivery can be
      // saved once the photo is taken.
      if (answer !== 'anyway') return;
    }

    setSaving(true);
    try {
      const receipt = await receiveMaterial(
        siteId,
        {
          item_name: item,
          quantity_received: value,
          unit,
          date: toISODate(new Date()),
          supplier: supplier.trim() || null,
        },
        challan
      );

      onReceived();
      reset();
      onClose();
      notify(
        'Delivery recorded',
        `${receipt.quantity_received} ${UNIT_LABELS[receipt.unit]} of ${receipt.item_name} received.` +
          (receipt.quantity_in_stock !== null
            ? `\n\nOn site now: ${receipt.quantity_in_stock} ${UNIT_LABELS[receipt.unit]}.`
            : '')
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
          <ThemedText type="smallBold">Receive material</ThemedText>
          <Button title="Cancel" variant="ghost" onPress={onClose} disabled={saving} />
        </View>

        <ScrollView contentContainerStyle={styles.modalContent} keyboardShouldPersistTaps="handled">
          <Field
            label="Item"
            value={itemName}
            onChangeText={setItemName}
            placeholder="Cement"
            maxLength={120}
            returnKeyType="next"
          />

          <Field
            label="Quantity received"
            value={quantity}
            onChangeText={setQuantity}
            keyboardType="decimal-pad"
            placeholder="40"
            hint="Adds straight to this site's stock."
            returnKeyType="next"
          />

          <View style={styles.section}>
            <ThemedText type="smallBold" themeColor="textSecondary">
              COUNTED IN
            </ThemedText>
            <Segmented options={UNITS} value={unit} onChange={setUnit} />
            <ThemedText type="small" themeColor="textSecondary">
              Fixed the first time an item arrives here. A later delivery in a different unit is
              refused rather than converted.
            </ThemedText>
          </View>

          <Field
            label="Supplier (optional)"
            value={supplier}
            onChangeText={setSupplier}
            placeholder="Shree Traders"
            maxLength={120}
            returnKeyType="done"
          />

          <View style={styles.section}>
            <ThemedText type="smallBold" themeColor="textSecondary">
              DELIVERY CHALLAN
            </ThemedText>

            {challan ? (
              <View style={[styles.challanCard, { borderColor: theme.border }]}>
                <Image source={{ uri: challan.uri }} style={styles.preview} contentFit="cover" />
                <Button title="Retake" variant="ghost" onPress={() => void capture('camera')} />
              </View>
            ) : (
              <View style={styles.actions}>
                <View style={styles.action}>
                  <Button title="📷 Photograph challan" onPress={() => void capture('camera')} />
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
              You are offline. A delivery moves stock on the server and is not queued — it needs
              a connection.
            </ThemedText>
          ) : null}

          {error ? (
            <ThemedText type="small" style={{ color: theme.negative }}>
              {error}
            </ThemedText>
          ) : null}

          <Button
            title={saving ? 'Recording…' : 'Record delivery'}
            loading={saving}
            disabled={!isOnline}
            onPress={() => void save()}
          />
        </ScrollView>
      </SafeAreaView>
    </Modal>
  );
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
  loading: {
    paddingVertical: Spacing.four,
  },
  stockCard: {
    padding: 0,
    paddingHorizontal: Spacing.three,
  },
  stockRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
    paddingVertical: Spacing.two + 2,
  },
  stockBody: {
    flex: 1,
    gap: 1,
  },
  separator: {
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
    paddingHorizontal: Spacing.three,
    paddingBottom: Spacing.six,
    maxWidth: MaxContentWidth,
    width: '100%',
    alignSelf: 'center',
  },
  section: {
    gap: Spacing.two,
  },
  actions: {
    flexDirection: 'row',
    gap: Spacing.two,
  },
  action: {
    flex: 1,
  },
  challanCard: {
    gap: Spacing.two,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: Radius.large,
    padding: Spacing.three,
  },
  preview: {
    width: '100%',
    height: 220,
    borderRadius: Radius.medium,
  },
});
