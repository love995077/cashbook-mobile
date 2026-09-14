/**
 * Download a report from the API and hand it to the native share sheet.
 *
 * Every reports endpoint needs a bearer token, so a file cannot simply be
 * opened in a browser: it is fetched with an Authorization header, written to
 * the cache directory, then shared from there. On web there is no cache
 * directory and no share sheet, so the bytes go to the browser downloader
 * instead.
 *
 * `downloadStatement` in `src/lib/statement.ts` is the worker-statement caller
 * of this; everything else on the reports screen goes through `downloadReport`
 * directly.
 */

import { File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import { Platform } from 'react-native';

import { API_BASE_URL } from '@/api/client';

export type DownloadOutcome =
  /** The native share sheet opened (WhatsApp, email, ...). */
  | { kind: 'shared'; uri: string }
  /** Sharing is unavailable on this device; the file is on disk. */
  | { kind: 'saved'; uri: string }
  /** Web build: handed to the browser downloader. */
  | { kind: 'downloaded' };

export type ReportFormat = 'pdf' | 'csv';

export type DownloadRequest = {
  token: string;
  /** Path under the API root, e.g. `/api/reports/attendance/csv`. */
  path: string;
  params?: Record<string, string | null | undefined>;
  filename: string;
  format: ReportFormat;
  /** Shown as the share sheet title. */
  title: string;
};

const MIME: Record<ReportFormat, string> = {
  pdf: 'application/pdf',
  csv: 'text/csv',
};

// iOS wants a uniform type identifier alongside the MIME type.
const UTI: Record<ReportFormat, string> = {
  pdf: 'com.adobe.pdf',
  csv: 'public.comma-separated-values-text',
};

function buildUrl(request: DownloadRequest): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(request.params ?? {})) {
    if (value) params.set(key, value);
  }
  const query = params.toString();
  return `${API_BASE_URL}${request.path}${query ? `?${query}` : ''}`;
}

export async function downloadReport(request: DownloadRequest): Promise<DownloadOutcome> {
  const url = buildUrl(request);
  const headers = { Authorization: `Bearer ${request.token}` };

  if (Platform.OS === 'web') {
    // expo-file-system downloads and expo-sharing are both no-ops on web, so
    // go through the browser: fetch the bytes, then click an object URL.
    const response = await fetch(url, { headers });
    if (!response.ok) throw new Error(await describeFailure(response));

    const blob = await response.blob();
    const objectUrl = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = objectUrl;
    link.download = request.filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(objectUrl);
    return { kind: 'downloaded' };
  }

  const target = new File(Paths.cache, request.filename);
  const file = await File.downloadFileAsync(url, target, {
    headers,
    // Reports are regenerated on every tap, so overwrite rather than erroring
    // on a file left behind by a previous download.
    idempotent: true,
  });

  // A downloader will happily write an error body to disk under a .pdf name.
  // Check the bytes so a 401 JSON payload cannot masquerade as a report in the
  // share sheet.
  const bytes = await file.bytes();
  if (!looksValid(bytes, request.format)) {
    file.delete();
    throw new Error('The server did not return a report. Please sign in again and retry.');
  }

  if (!(await Sharing.isAvailableAsync())) {
    return { kind: 'saved', uri: file.uri };
  }

  await Sharing.shareAsync(file.uri, {
    mimeType: MIME[request.format],
    UTI: UTI[request.format],
    dialogTitle: request.title,
  });

  return { kind: 'shared', uri: file.uri };
}

/**
 * Cheap sanity check on the downloaded bytes.
 *
 * A PDF has magic bytes. A CSV does not, so the test is that the server sent
 * the UTF-8 BOM every export starts with - which a JSON error body never does.
 */
function looksValid(bytes: Uint8Array, format: ReportFormat): boolean {
  if (format === 'pdf') {
    return (
      bytes.length > 4 &&
      bytes[0] === 0x25 && // %
      bytes[1] === 0x50 && // P
      bytes[2] === 0x44 && // D
      bytes[3] === 0x46 && // F
      bytes[4] === 0x2d //  -
    );
  }

  return (
    bytes.length > 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf
  );
}

async function describeFailure(response: Response): Promise<string> {
  try {
    const body = await response.json();
    if (typeof body?.detail === 'string') return body.detail;
  } catch {
    // Not JSON.
  }
  return `Could not download the report (${response.status}).`;
}

/** e.g. 'Ramesh-Builders-report-2026-09-03.pdf' */
export function reportFilename(owner: string, kind: string, format: ReportFormat): string {
  const safe =
    owner
      .split(/[^A-Za-z0-9]+/)
      .filter(Boolean)
      .join('-') || 'cashbook';
  const stamp = new Date().toISOString().slice(0, 10);
  return `${safe}-${kind}-${stamp}.${format}`;
}
