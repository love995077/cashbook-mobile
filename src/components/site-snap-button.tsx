import * as ImagePicker from 'expo-image-picker';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Button, Card } from '@/components/ui-kit';
import { Spacing } from '@/constants/theme';
import { useStore } from '@/data/store';
import { useTheme } from '@/hooks/use-theme';
import { notify } from '@/lib/dialog';
import { toISODate } from '@/lib/money';

/**
 * A worker photographing the day's progress on their own site.
 *
 * CAMERA FIRST, LIBRARY SECOND
 * ----------------------------
 * The point of a site snap is that it was taken on the site, today. The
 * library is offered as a fallback rather than the default because a worker
 * who took the photo an hour ago on the scaffold should still be able to post
 * it — but picking an old picture from the gallery should be the deliberate
 * choice, not the easy one. Hence two buttons, camera filled and library
 * quiet, rather than one button that opens a menu: the common case is one tap,
 * and a menu is a dialog, which the web build cannot draw.
 *
 * `quality: 0.6` and a 1600px cap: the API refuses anything over
 * `max_image_bytes`, and a modern phone camera clears that in one shot. This
 * is also the difference between a photo that uploads on site data and one
 * that times out.
 *
 * The site is never named here — the server reads it off the worker's record,
 * so there is nothing for this component to get wrong or for a caller to
 * override.
 */
export function SiteSnapButton({
  hasSite,
  onUploaded,
}: {
  hasSite: boolean;
  onUploaded?: () => void;
}) {
  const theme = useTheme();
  const { addMySitePhoto, isOnline } = useStore();

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function send(asset: ImagePicker.ImagePickerAsset) {
    setBusy(true);
    setError(null);
    try {
      await addMySitePhoto(
        {
          uri: asset.uri,
          name: asset.fileName ?? 'site-snap.jpg',
          mimeType: asset.mimeType ?? 'image/jpeg',
        },
        { date: toISODate(new Date()) }
      );
      onUploaded?.();
    } catch (caught) {
      const message = (caught as Error).message;
      setError(message);
      // The picker has closed by now and the card may be off screen; the
      // inline line alone is easy to walk away from.
      notify('Could not upload the photo', message);
    } finally {
      setBusy(false);
    }
  }

  async function capture() {
    const permission = await ImagePicker.requestCameraPermissionsAsync();
    if (!permission.granted) {
      setError('Camera access is needed to take a site photo.');
      return;
    }

    const result = await ImagePicker.launchCameraAsync({
      quality: 0.6,
      // Cropping a progress photo loses the context that makes it useful.
      allowsEditing: false,
    });
    if (result.canceled || !result.assets[0]) return;
    await send(result.assets[0]);
  }

  async function pick() {
    // Asked for the same way the camera is, so a refusal is a message rather
    // than a picker that opens onto nothing.
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      setError('Photo access is needed to choose a site photo.');
      return;
    }

    const result = await ImagePicker.launchImageLibraryAsync({
      quality: 0.6,
      mediaTypes: ['images'],
    });
    if (result.canceled || !result.assets[0]) return;
    await send(result.assets[0]);
  }


  return (
    <Card style={styles.card}>
      <ThemedText type="smallBold" themeColor="textSecondary">
        SITE PHOTO
      </ThemedText>

      {hasSite ? (
        <>
          <View style={styles.actions}>
            <View style={styles.action}>
              <Button
                title="📷 Take Photo"
                loading={busy}
                disabled={!isOnline}
                onPress={() => void capture()}
              />
            </View>
            <View style={styles.action}>
              <Button
                title="🖼 Choose from Gallery"
                variant="secondary"
                disabled={!isOnline || busy}
                onPress={() => void pick()}
              />
            </View>
          </View>
          <ThemedText type="small" themeColor="textSecondary">
            Goes to your site&apos;s gallery, dated today. Your contractor can see it.
          </ThemedText>
        </>
      ) : (
        // The API answers 409 for this; saying it up front beats letting
        // someone frame a shot and then be told it has nowhere to go.
        <ThemedText type="small" themeColor="textSecondary">
          You are not posted to a site yet, so there is nowhere to file a photo.
        </ThemedText>
      )}

      {error ? (
        <ThemedText type="small" style={{ color: theme.negative }}>
          {error}
        </ThemedText>
      ) : null}
    </Card>
  );
}

const styles = StyleSheet.create({
  card: {
    gap: Spacing.two,
  },
  actions: {
    flexDirection: 'row',
    gap: Spacing.two,
  },
  action: {
    flex: 1,
  },
});
