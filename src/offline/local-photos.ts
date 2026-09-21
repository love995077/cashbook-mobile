/**
 * Site photos kept on this device and nowhere else.
 *
 * WHAT CHANGED AND WHY
 * --------------------
 * Photos used to be uploaded to the backend, which stored the bytes and
 * handed back a key. That is gone by request: nothing about a photo leaves
 * the phone now.
 *
 * The consequence is deliberate and worth stating where somebody will read it
 * before wondering: a photo is visible ONLY on the device that took it. A
 * contractor and their supervisor photographing the same slab end up with two
 * private galleries, and there is no server copy to reconcile them. The
 * worker-facing shared feed still renders whatever was uploaded before this
 * change and receives nothing new.
 *
 * And because there is no copy anywhere else, **uninstalling the app deletes
 * every photo**. That is the trade for not having a backend store them.
 *
 * WHERE THE BYTES GO
 * ------------------
 * Native: the file is COPIED into `Paths.document/site-photos/`. Copied, not
 * referenced - `expo-image-picker` hands back a URI inside a cache the OS is
 * free to empty, so a stored `file://` that merely pointed at the pick would
 * go dead at an unpredictable moment. The document directory is the one place
 * that survives.
 *
 * Web: there is no document directory at all (`Paths.document` has no
 * meaningful web implementation), so the image is held as a data URL in
 * AsyncStorage, which is IndexedDB-backed in a browser. Same promise - it
 * never leaves the machine - and it means the flow is testable in a browser
 * rather than only on a device.
 *
 * WHAT ASYNCSTORAGE HOLDS
 * -----------------------
 * The index: one JSON array per user, each entry carrying the site it belongs
 * to, the day it is ABOUT (not when it was taken), a caption, and either a
 * `file://` URI (native) or the data URL itself (web). Photos are grouped by
 * that date on screen, because a slab poured on Tuesday and photographed on
 * Wednesday morning belongs under Tuesday.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import { Platform } from 'react-native';

/** Bumped when the stored shape changes, so an old index is ignored not crashed. */
const VERSION = 1;

const indexKey = (userId: number) => `moneymate.localphotos.v${VERSION}.user.${userId}`;

export type LocalPhoto = {
  /** Local-only id. Negative so it can never collide with a server row's id. */
  id: number;
  site_id: number;
  /** The day the photo is about, YYYY-MM-DD. */
  date: string;
  description: string | null;
  /**
   * `file://…` on native, a `data:` URL on web. Either way it is something an
   * <Image source={{ uri }}> can render directly.
   */
  uri: string;
  /** When it was saved, for ordering within a day. */
  created_at: string;
};

const DIR_NAME = 'site-photos';

async function readIndex(userId: number): Promise<LocalPhoto[]> {
  try {
    const raw = await AsyncStorage.getItem(indexKey(userId));
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as LocalPhoto[]) : [];
  } catch {
    // A corrupt index must not take the gallery down with it - an empty list
    // is recoverable, a crash on mount is not.
    return [];
  }
}

async function writeIndex(userId: number, photos: LocalPhoto[]): Promise<void> {
  await AsyncStorage.setItem(indexKey(userId), JSON.stringify(photos));
}

/**
 * Copy a picked image into permanent local storage and return its URI.
 *
 * Split by platform because the two have nothing in common: native moves a
 * file, web encodes bytes.
 */
async function persistBytes(sourceUri: string, filename: string): Promise<string> {
  if (Platform.OS === 'web') {
    // The picker gives a blob: URL, which dies with the page. Read it out and
    // keep the data itself.
    const response = await fetch(sourceUri);
    const blob = await response.blob();
    return await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onerror = () => reject(new Error('Could not read the picked image'));
      reader.onload = () => resolve(String(reader.result));
      reader.readAsDataURL(blob);
    });
  }

  // Imported lazily: the module's native side does not exist on web, and a
  // top-level import would be evaluated there too.
  const { Directory, File, Paths } = await import('expo-file-system');
  const dir = new Directory(Paths.document, DIR_NAME);
  if (!dir.exists) dir.create({ intermediates: true });

  const source = new File(sourceUri);
  const target = new File(dir, filename);
  await source.copy(target);
  return target.uri;
}

/** Every photo this device holds for one site, newest day first. */
export async function listLocalPhotos(
  userId: number,
  siteId: number
): Promise<LocalPhoto[]> {
  const all = await readIndex(userId);
  return all
    .filter((photo) => photo.site_id === siteId)
    .sort((a, b) => (a.created_at < b.created_at ? 1 : -1));
}

/**
 * Save one photo against a site.
 *
 * The index entry is written only AFTER the bytes are safely copied, so a
 * failure part way through leaves nothing on screen pointing at a file that
 * is not there - the same ordering rule the server's uploads follow, for the
 * same reason.
 */
export async function saveLocalPhoto(
  userId: number,
  input: {
    siteId: number;
    uri: string;
    date: string;
    description?: string | null;
    mimeType?: string;
  }
): Promise<LocalPhoto> {
  const stamp = Date.now();
  const extension =
    input.mimeType && input.mimeType.includes('png')
      ? 'png'
      : input.mimeType && input.mimeType.includes('webp')
        ? 'webp'
        : 'jpg';
  const stored = await persistBytes(
    input.uri,
    `site-${input.siteId}-${stamp}.${extension}`
  );

  const photo: LocalPhoto = {
    // Negative, so nothing downstream can mistake a local row for a server
    // one - ids from the API are always positive.
    id: -stamp,
    site_id: input.siteId,
    date: input.date,
    description: input.description?.trim() || null,
    uri: stored,
    created_at: new Date(stamp).toISOString(),
  };

  const all = await readIndex(userId);
  await writeIndex(userId, [photo, ...all]);
  return photo;
}

/**
 * Forget a photo, and delete its file.
 *
 * The index entry goes first. An orphaned file wastes a few hundred kilobytes
 * and is collectable later; an index entry pointing at a file that is gone
 * renders as a permanent broken tile the user cannot clear.
 */
export async function deleteLocalPhoto(userId: number, photoId: number): Promise<void> {
  const all = await readIndex(userId);
  const photo = all.find((candidate) => candidate.id === photoId);
  await writeIndex(
    userId,
    all.filter((candidate) => candidate.id !== photoId)
  );
  if (!photo || Platform.OS === 'web') return;

  try {
    const { File } = await import('expo-file-system');
    const file = new File(photo.uri);
    if (file.exists) file.delete();
  } catch {
    // Best effort. The row is already gone, which is what the user asked for.
  }
}

/** How many photos this device holds for a site, for the site list's count. */
export async function countLocalPhotos(userId: number, siteId: number): Promise<number> {
  const all = await readIndex(userId);
  return all.filter((photo) => photo.site_id === siteId).length;
}
