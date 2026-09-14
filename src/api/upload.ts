/**
 * Turning a picked file into a multipart part, on both runtimes.
 *
 * React Native's FormData is not the browser's. RN accepts a
 * `{ uri, name, type }` object and streams the bytes off disk — the reason
 * every upload here hands it a uri instead of reading a 4 MB camera JPEG into
 * memory first. The browser's FormData has no such affordance: `append` runs
 * anything that is not a Blob through `String()`, so that same object arrives
 * as the literal "[object Object]" in an ordinary text field, and FastAPI
 * answers 422:
 *
 *     image: Value error, Expected UploadFile, received: <class 'str'>
 *
 * So on web the uri (a `blob:` or `data:` URL from expo-image-picker) has to
 * be read back into a Blob and appended with a filename, which is what makes
 * it a file part rather than a text one. Native keeps the streaming path.
 *
 * The content type carries real weight: `app/services/storage.py` picks the
 * stored extension off the allow-list by content type and ignores the
 * client's filename, so a part with no type is rejected as unsupported media
 * rather than saved under a guessed name.
 */

import { Platform } from 'react-native';

/** What the pickers and the recorder hand back. */
export type PickedFile = {
  uri: string;
  name?: string;
  mimeType?: string;
};

type Defaults = { name: string; type: string };

/**
 * Append `file` to `form` under `field` as a multipart file part.
 *
 * Async only because the web branch has to read the blob back; on native it
 * resolves without touching the file.
 */
export async function appendFile(
  form: FormData,
  field: string,
  file: PickedFile,
  defaults: Defaults
): Promise<void> {
  const name = file.name?.trim() || defaults.name;
  const declared = file.mimeType?.trim() || defaults.type;

  if (Platform.OS !== 'web') {
    // RN's file entry is not a web File; the cast keeps TS honest about that
    // without pretending the shapes match.
    form.append(field, { uri: file.uri, name, type: declared } as unknown as Blob);
    return;
  }

  const blob = await (await fetch(file.uri)).blob();
  // The blob's own type is read from the real bytes, so it beats the picker's
  // guess; `slice` is how you stamp a type onto one that arrived without.
  const typed = blob.type ? blob : blob.slice(0, blob.size, declared);
  form.append(field, typed, name);
}
