import * as ImagePicker from 'expo-image-picker';
import { Image } from 'expo-image';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, View } from 'react-native';

import { API_BASE_URL } from '@/api/client';
import { ThemedText } from '@/components/themed-text';
import { Button, EmptyState, Field } from '@/components/ui-kit';
import { Radius, Spacing } from '@/constants/theme';
import { useStore } from '@/data/store';
import type { SitePhoto } from '@/data/types';
import { useTheme } from '@/hooks/use-theme';
import { confirm, notify } from '@/lib/dialog';
import { formatRelativeDate, toISODate } from '@/lib/money';

/**
 * The day's progress photos and material receipts for one site.
 *
 * Grouped by the date the photo is ABOUT rather than when it was uploaded —
 * a contractor with no signal on site uploads yesterday's slab the next
 * morning, and it belongs under yesterday.
 *
 * Camera first, library second. The overwhelmingly common action is "take a
 * picture of what is in front of me"; picking from the library is for the
 * receipt photographed an hour ago.
 */

/**
 * Uploaded at 70% JPEG. A modern phone camera produces 4-8 MB originals and
 * the server rejects anything over 12 MB; nobody is examining rebar spacing
 * at full resolution, and the contractor is on mobile data.
 */
const QUALITY = 0.7;

type Pending = { uri: string; mimeType?: string; name?: string };

export function SiteGallery({ siteId }: { siteId: number }) {
  const theme = useTheme();
  const { getSitePhotos, addSitePhoto, removeSitePhoto, isOnline } = useStore();

  const [photos, setPhotos] = useState<SitePhoto[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState<Pending | null>(null);
  const [caption, setCaption] = useState('');
  const [uploading, setUploading] = useState(false);

  const abortRef = useRef<AbortController | null>(null);

  const load = useCallback(
    async (controller: AbortController) => {
      try {
        const next = await getSitePhotos(siteId, controller.signal);
        if (!controller.signal.aborted) setPhotos(next);
      } catch (caught) {
        if (!controller.signal.aborted) setError((caught as Error).message);
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    },
    [siteId, getSitePhotos]
  );

  useEffect(() => {
    const controller = new AbortController();
    abortRef.current = controller;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load(controller);
    return () => controller.abort();
  }, [load]);

  async function pick(from: 'camera' | 'library') {
    setError(null);

    const permission =
      from === 'camera'
        ? await ImagePicker.requestCameraPermissionsAsync()
        : await ImagePicker.requestMediaLibraryPermissionsAsync();

    if (!permission.granted) {
      notify(
        from === 'camera' ? 'Camera needed' : 'Photos needed',
        `Allow access in Settings to add site photos.`
      );
      return;
    }

    const options: ImagePicker.ImagePickerOptions = {
      mediaTypes: ['images'],
      quality: QUALITY,
      // No editor: cropping a progress photo loses the context that makes it
      // evidence of what the site looked like.
      allowsEditing: false,
    };

    const result =
      from === 'camera'
        ? await ImagePicker.launchCameraAsync(options)
        : await ImagePicker.launchImageLibraryAsync(options);

    if (result.canceled || !result.assets?.length) return;

    const asset = result.assets[0];
    setPending({
      uri: asset.uri,
      mimeType: asset.mimeType ?? 'image/jpeg',
      name: asset.fileName ?? 'photo.jpg',
    });
  }

  async function upload() {
    if (!pending) return;
    setUploading(true);
    setError(null);
    try {
      const created = await addSitePhoto(siteId, pending, {
        date: toISODate(new Date()),
        description: caption.trim() || null,
      });
      setPhotos((current) => [created, ...current]);
      setPending(null);
      setCaption('');
    } catch (caught) {
      setError((caught as Error).message);
    } finally {
      setUploading(false);
    }
  }

  async function confirmRemove(photo: SitePhoto) {
    const ok = await confirm({
      title: 'Delete photo?',
      message: photo.description
        ? `"${photo.description}" will be removed from the site log.`
        : 'This photo will be removed from the site log.',
      confirmLabel: 'Delete',
      cancelLabel: 'Keep',
      destructive: true,
    });
    if (!ok) return;

    try {
      await removeSitePhoto(siteId, photo.id);
      setPhotos((current) => current.filter((row) => row.id !== photo.id));
    } catch (caught) {
      const message = (caught as Error).message;
      setError(message);
      notify('Could not delete the photo', message);
    }
  }

  // Newest day first; the API already sorts, this only groups.
  const days = photos.reduce<{ date: string; items: SitePhoto[] }[]>((groups, photo) => {
    const last = groups[groups.length - 1];
    if (last && last.date === photo.date) last.items.push(photo);
    else groups.push({ date: photo.date, items: [photo] });
    return groups;
  }, []);

  return (
    <View style={styles.wrap}>
      <View style={styles.header}>
        <ThemedText type="smallBold" themeColor="textSecondary">
          SITE GALLERY
        </ThemedText>
        <ThemedText type="small" themeColor="textSecondary">
          {photos.length} photo{photos.length === 1 ? '' : 's'}
        </ThemedText>
      </View>

      {pending ? (
        <View style={[styles.pendingCard, { borderColor: theme.border }]}>
          <Image source={{ uri: pending.uri }} style={styles.preview} contentFit="cover" />
          <Field
            label="Caption (optional)"
            value={caption}
            onChangeText={setCaption}
            placeholder="Slab poured, second floor"
            maxLength={255}
            returnKeyType="done"
          />
          <Button title="Upload photo" onPress={() => void upload()} loading={uploading} />
          <Button
            title="Discard"
            variant="ghost"
            onPress={() => {
              setPending(null);
              setCaption('');
            }}
            disabled={uploading}
          />
        </View>
      ) : (
        <View style={styles.actions}>
          <View style={styles.action}>
            <Button title="📷 Take Photo" onPress={() => void pick('camera')} disabled={!isOnline} />
          </View>
          <View style={styles.action}>
            <Button
              title="🖼 Choose from Gallery"
              variant="secondary"
              onPress={() => void pick('library')}
              disabled={!isOnline}
            />
          </View>
        </View>
      )}

      {!isOnline ? (
        <ThemedText type="small" style={{ color: theme.warning }}>
          You are offline. Photos are not queued for later — they need a
          connection.
        </ThemedText>
      ) : null}

      {error ? (
        <ThemedText type="small" style={{ color: theme.negative }}>
          {error}
        </ThemedText>
      ) : null}

      {loading ? (
        <ActivityIndicator color={theme.tint} style={styles.loading} />
      ) : days.length === 0 ? (
        <EmptyState
          title="No photos yet"
          message="Snap the day's progress or a material receipt so there is a record of it."
        />
      ) : (
        days.map((day) => (
          <View key={day.date} style={styles.day}>
            <ThemedText type="smallBold">{formatRelativeDate(day.date)}</ThemedText>
            <ScrollView horizontal showsHorizontalScrollIndicator={false}>
              <View style={styles.strip}>
                {day.items.map((photo) => (
                  <Pressable
                    key={photo.id}
                    accessibilityRole="button"
                    accessibilityLabel={photo.description ?? 'Site photo'}
                    accessibilityHint="Double tap to delete"
                    onLongPress={() => void confirmRemove(photo)}
                    style={({ pressed }) => [styles.tile, pressed && { opacity: 0.7 }]}>
                    <Image
                      source={{ uri: absolute(photo.url) }}
                      style={styles.thumb}
                      contentFit="cover"
                      transition={150}
                    />
                    {photo.description ? (
                      <ThemedText type="small" numberOfLines={2} style={styles.caption}>
                        {photo.description}
                      </ThemedText>
                    ) : null}
                  </Pressable>
                ))}
              </View>
            </ScrollView>
          </View>
        ))
      )}

      {photos.length ? (
        <ThemedText type="small" themeColor="textSecondary">
          Hold a photo to delete it.
        </ThemedText>
      ) : null}
    </View>
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
  actions: {
    flexDirection: 'row',
    gap: Spacing.two,
  },
  action: {
    flex: 1,
  },
  pendingCard: {
    gap: Spacing.three,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: Radius.large,
    padding: Spacing.three,
  },
  preview: {
    width: '100%',
    height: 200,
    borderRadius: Radius.medium,
  },
  loading: {
    paddingVertical: Spacing.four,
  },
  day: {
    gap: Spacing.two,
  },
  strip: {
    flexDirection: 'row',
    gap: Spacing.two,
    paddingVertical: Spacing.half,
  },
  tile: {
    width: 132,
    gap: Spacing.one,
  },
  thumb: {
    width: 132,
    height: 132,
    borderRadius: Radius.medium,
  },
  caption: {
    fontSize: 12,
    lineHeight: 16,
  },
});
