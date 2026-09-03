/**
 * Thin fetch wrapper around the FastAPI backend.
 *
 * Uses fetch rather than axios: React Native ships fetch, the surface we need
 * is small, and it keeps one less dependency in the bundle.
 */

import Constants from 'expo-constants';
import { Platform } from 'react-native';

/** Fallback when EXPO_PUBLIC_API_URL is not set — this machine's LAN address. */
const DEFAULT_LAN_HOST = '192.168.29.10';
const PORT = 8000;

/**
 * Where the API lives.
 *
 * Order of preference:
 *  1. EXPO_PUBLIC_API_URL — set this in mobile/.env to override everything.
 *  2. The host serving the Metro bundle. On a physical device this is already
 *     the dev machine's LAN IP, so the app follows you between networks
 *     without an edit. (The LAN IP is DHCP-assigned and will change.)
 *  3. DEFAULT_LAN_HOST above.
 *
 * Note localhost only works for the web build and the iOS simulator; a real
 * device needs the LAN IP, and the backend must be started with
 * `--host 0.0.0.0` so it accepts connections from outside this machine.
 */
function resolveBaseUrl(): string {
  const fromEnv = process.env.EXPO_PUBLIC_API_URL;
  if (fromEnv) return fromEnv.replace(/\/+$/, '');

  if (Platform.OS === 'web') return `http://localhost:${PORT}`;

  // e.g. "192.168.29.10:8081" while running under Expo Go / dev client.
  const hostUri = Constants.expoConfig?.hostUri ?? Constants.expoGoConfig?.debuggerHost;
  const host = hostUri?.split(':')[0];
  if (host && host !== 'localhost' && host !== '127.0.0.1') {
    return `http://${host}:${PORT}`;
  }

  return `http://${DEFAULT_LAN_HOST}:${PORT}`;
}

export const API_BASE_URL = resolveBaseUrl();

/** Requests that hang past this are treated as unreachable. */
const TIMEOUT_MS = 15_000;

/** Audio upload plus transcription plus an LLM call takes a good deal longer. */
const UPLOAD_TIMEOUT_MS = 60_000;

export class ApiError extends Error {
  readonly status: number;
  /** True when the request never reached the server (offline, wrong IP, backend down). */
  readonly isNetworkError: boolean;

  constructor(message: string, status: number, isNetworkError = false) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.isNetworkError = isNetworkError;
  }

  /** The token is missing, expired or rejected — the caller should sign out. */
  get isUnauthorized(): boolean {
    return this.status === 401;
  }
}

/** FastAPI errors are `{"detail": ...}`; 422 nests field errors in a list. */
function extractDetail(body: unknown, fallback: string): string {
  if (!body || typeof body !== 'object') return fallback;
  const detail = (body as { detail?: unknown }).detail;

  if (typeof detail === 'string') return detail;

  if (Array.isArray(detail)) {
    const messages = detail
      .map((item) => {
        if (!item || typeof item !== 'object') return null;
        const { msg, loc } = item as { msg?: string; loc?: unknown[] };
        if (!msg) return null;
        const field = Array.isArray(loc) ? loc[loc.length - 1] : undefined;
        return field ? `${field}: ${msg}` : msg;
      })
      .filter(Boolean);
    if (messages.length) return messages.join('\n');
  }

  return fallback;
}

type RequestOptions = {
  method?: 'GET' | 'POST' | 'PATCH' | 'DELETE';
  /** Plain objects are sent as JSON; a FormData is sent as multipart. */
  body?: unknown;
  /** Bearer token; omitted for /auth/login and /auth/register. */
  token?: string | null;
  signal?: AbortSignal;
};

export async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const { method = 'GET', body, token, signal } = options;

  const controller = new AbortController();
  const timeout = setTimeout(
    () => controller.abort(),
    typeof FormData !== 'undefined' && body instanceof FormData ? UPLOAD_TIMEOUT_MS : TIMEOUT_MS
  );
  // Let a caller-supplied signal (screen unmounted) also cancel the request.
  const onAbort = () => controller.abort();
  signal?.addEventListener('abort', onAbort);

  // Multipart bodies must NOT get an explicit Content-Type — fetch has to set
  // it itself so the multipart boundary is included.
  const isMultipart = typeof FormData !== 'undefined' && body instanceof FormData;

  let response: Response;
  try {
    response = await fetch(`${API_BASE_URL}${path}`, {
      method,
      headers: {
        Accept: 'application/json',
        ...(body && !isMultipart ? { 'Content-Type': 'application/json' } : {}),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: isMultipart ? (body as FormData) : body ? JSON.stringify(body) : undefined,
      signal: controller.signal,
    });
  } catch (caught) {
    // Distinguish "we gave up waiting" from "the request was cancelled".
    if (signal?.aborted) throw caught;
    throw new ApiError(
      `Cannot reach the server at ${API_BASE_URL}. Check that the backend is running with --host 0.0.0.0 and that this device is on the same network.`,
      0,
      true
    );
  } finally {
    clearTimeout(timeout);
    signal?.removeEventListener('abort', onAbort);
  }

  if (response.status === 204) return undefined as T;

  const text = await response.text();
  let parsed: unknown = null;
  if (text) {
    try {
      parsed = JSON.parse(text);
    } catch {
      parsed = null;
    }
  }

  if (!response.ok) {
    throw new ApiError(
      extractDetail(parsed, `Request failed (${response.status})`),
      response.status
    );
  }

  return parsed as T;
}
