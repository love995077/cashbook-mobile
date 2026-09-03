/**
 * Download a worker's PDF statement and hand it to the native share sheet.
 *
 * The endpoint needs a bearer token, so the file cannot simply be opened in a
 * browser — it is fetched with an Authorization header, written to the cache
 * directory, and then shared from there.
 */

import { File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import { Platform } from 'react-native';

import { API_BASE_URL } from '@/api/client';

export type StatementOutcome =
  /** The native share sheet opened (WhatsApp, email, …). */
  | { kind: 'shared'; uri: string }
  /** Sharing is unavailable on this device; the file is on disk. */
  | { kind: 'saved'; uri: string }
  /** Web build: handed to the browser's downloader. */
  | { kind: 'downloaded' };

export type StatementRequest = {
  token: string;
  workerId: number;
  workerName: string;
  startDate?: string | null;
  endDate?: string | null;
};

function buildUrl({ workerId, startDate, endDate }: StatementRequest): string {
  const params = new URLSearchParams();
  if (startDate) params.set('start_date', startDate);
  if (endDate) params.set('end_date', endDate);
  const query = params.toString();
  return `${API_BASE_URL}/api/reports/worker/${workerId}/pdf${query ? `?${query}` : ''}`;
}

/** Mirrors the server's filename so a shared file is recognisable. */
function buildFilename(workerName: string, endDate?: string | null): string {
  const safe =
    workerName
      .split(/[^A-Za-z0-9]+/)
      .filter(Boolean)
      .join('-') || 'worker';
  const stamp = endDate ?? new Date().toISOString().slice(0, 10);
  return `${safe}-statement-${stamp}.pdf`;
}

export async function downloadStatement(request: StatementRequest): Promise<StatementOutcome> {
  const url = buildUrl(request);
  const filename = buildFilename(request.workerName, request.endDate);
  const headers = { Authorization: `Bearer ${request.token}` };

  if (Platform.OS === 'web') {
    // expo-file-system's download and expo-sharing are both no-ops on web, so
    // go through the browser: fetch the bytes, then click an object URL.
    const response = await fetch(url, { headers });
    if (!response.ok) throw new Error(await describeFailure(response));

    const blob = await response.blob();
    const objectUrl = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = objectUrl;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(objectUrl);
    return { kind: 'downloaded' };
  }

  const target = new File(Paths.cache, filename);
  const file = await File.downloadFileAsync(url, target, {
    headers,
    // Statements are regenerated on every tap, so overwrite rather than
    // erroring on a file left behind by a previous download.
    idempotent: true,
  });

  // A downloader will happily write an error body to disk under a .pdf name.
  // Check the magic bytes so a 401 JSON payload cannot masquerade as a
  // statement in the share sheet. Statements are small, so reading them back
  // costs little.
  const bytes = await file.bytes();
  const isPdf =
    bytes.length > 4 &&
    bytes[0] === 0x25 && // %
    bytes[1] === 0x50 && // P
    bytes[2] === 0x44 && // D
    bytes[3] === 0x46 && // F
    bytes[4] === 0x2d; //  -

  if (!isPdf) {
    file.delete();
    throw new Error('The server did not return a statement. Please sign in again and retry.');
  }

  if (!(await Sharing.isAvailableAsync())) {
    return { kind: 'saved', uri: file.uri };
  }

  await Sharing.shareAsync(file.uri, {
    mimeType: 'application/pdf',
    UTI: 'com.adobe.pdf', // iOS needs the uniform type identifier as well
    dialogTitle: `${request.workerName} — cashbook statement`,
  });

  return { kind: 'shared', uri: file.uri };
}

async function describeFailure(response: Response): Promise<string> {
  try {
    const body = await response.json();
    if (typeof body?.detail === 'string') return body.detail;
  } catch {
    // Not JSON.
  }
  return `Could not download the statement (${response.status}).`;
}
