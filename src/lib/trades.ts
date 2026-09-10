/**
 * The catalogue of well-known posts: label, icon and colour for each.
 *
 * Mirrors the `WorkerTrade` enum in `app/models/enums.py`, which is no longer
 * a constraint — `users.trade` is free text. So this list is the set of posts
 * the app can *decorate*, not the set it can *display*: a custom post renders
 * through `postLabel` with no icon, and that is a normal outcome rather than a
 * gap to be filled.
 *
 * The server sends the value; everything a screen needs to draw it lives here,
 * so a badge in the Workers list and the same badge in the attendance grid
 * cannot drift.
 *
 * The icons are emoji rather than Ionicons on purpose. A trade is recognised
 * at a glance by a contractor who may not read English comfortably, and 🧱
 * carries that meaning where a monochrome glyph does not. They also render
 * identically on both platforms without shipping an icon font.
 *
 * The colours are picked to stay legible against the badge's own 13% tint in
 * both themes — see `TradeBadge`. They are deliberately NOT theme tokens: a
 * trade should look the same colour in light and dark, the way a hard hat does.
 */

import type { KnownWorkerTrade, WorkerTrade } from '@/data/types';

export type TradeInfo = {
  value: KnownWorkerTrade;
  label: string;
  icon: string;
  color: string;
};

export const TRADES: TradeInfo[] = [
  { value: 'mason', label: 'Mason', icon: '🧱', color: '#C2410C' },
  { value: 'electrician', label: 'Electrician', icon: '⚡', color: '#B45309' },
  { value: 'plumber', label: 'Plumber', icon: '🚿', color: '#0369A1' },
  { value: 'carpenter', label: 'Carpenter', icon: '🔨', color: '#92400E' },
  { value: 'painter', label: 'Painter', icon: '🎨', color: '#7C3AED' },
  { value: 'welder', label: 'Welder', icon: '🔥', color: '#DC2626' },
  { value: 'bar_bender', label: 'Bar bender', icon: '⛓️', color: '#475569' },
  { value: 'plasterer', label: 'Plasterer', icon: '🪣', color: '#0F766E' },
  { value: 'tiler', label: 'Tiler', icon: '◻️', color: '#0891B2' },
  { value: 'operator', label: 'Operator', icon: '🚜', color: '#CA8A04' },
  { value: 'driver', label: 'Driver', icon: '🚚', color: '#1D4ED8' },
  { value: 'supervisor', label: 'Supervisor', icon: '📋', color: '#059669' },
  { value: 'general_labour', label: 'General labour', icon: '👷', color: '#525252' },
];

const BY_VALUE = new Map<string, TradeInfo>(TRADES.map((trade) => [trade.value, trade]));

/**
 * Fold a post to the form the catalogue is keyed by.
 *
 * Mirrors `_normalise_trade` in app/schemas/user.py. The server already
 * normalises on write, so anything arriving from the API is in this form
 * — but the add-worker form looks a post up as it is being typed, before the
 * server has seen it, and "Bar Bender" has to find `bar_bender` for the icon
 * to appear while the contractor types.
 */
export function normaliseTrade(trade: string): string {
  return trade.replace(/[-_]/g, ' ').trim().split(/\s+/).join('_').toLowerCase();
}

/**
 * The catalogue entry for a post, or null when none is recorded.
 *
 * Also returns null for a custom post — there is no icon or colour to give
 * it. Callers that need something on screen for those use `postLabel`, which
 * always produces readable text.
 */
export function tradeInfo(trade: WorkerTrade | null | undefined): TradeInfo | null {
  if (!trade) return null;
  return BY_VALUE.get(normaliseTrade(trade)) ?? null;
}

/**
 * A post as readable text — "Electrician", "Shuttering carpenter".
 *
 * The catalogue's own label when it is a known post, otherwise the stored
 * value turned back into words: underscores to spaces, first letter up. That
 * inverts the server's normalisation closely enough to read, which is all a
 * row label needs. Null only when no post is recorded at all.
 */
export function postLabel(trade: WorkerTrade | null | undefined): string | null {
  const info = tradeInfo(trade);
  if (info) return info.label;
  if (!trade) return null;

  const words = trade.replace(/_/g, ' ').trim();
  if (!words) return null;
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/** "⚡ Electrician", or "Shuttering carpenter" for a post with no icon. */
export function tradeLabel(trade: WorkerTrade | null | undefined): string | null {
  const info = tradeInfo(trade);
  if (info) return `${info.icon} ${info.label}`;
  return postLabel(trade);
}
