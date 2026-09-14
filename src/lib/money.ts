import type { Ionicons } from '@expo/vector-icons';

import type { AttendanceStatus, PaymentMode, TransactionType } from '@/data/types';

export const CURRENCY = '₹'; // Indian rupee

/**
 * The API sends DECIMAL columns as strings ("600.00"); the mock uses numbers.
 * Everything funnels through here so swapping the source is a one-line change.
 */
export function parseAmount(value: number | string): number {
  return typeof value === 'number' ? value : Number.parseFloat(value);
}

/** "1,250" / "1,250.50" — trailing ".00" is dropped, it just adds noise. */
export function formatMoney(value: number | string): string {
  const amount = parseAmount(value);
  const whole = Number.isInteger(amount);
  return amount.toLocaleString('en-IN', {
    minimumFractionDigits: whole ? 0 : 2,
    maximumFractionDigits: 2,
  });
}

export function formatCurrency(value: number | string): string {
  const amount = parseAmount(value);
  const sign = amount < 0 ? '-' : '';
  return `${sign}${CURRENCY}${formatMoney(Math.abs(amount))}`;
}

/** "3 Sep 2026" */
export function formatDate(iso: string): string {
  const date = new Date(`${iso}T00:00:00`);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleDateString('en-IN', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}

/** "Today" / "Yesterday" / "3 Sep 2026" — for list headers. */
export function formatRelativeDate(iso: string, today = new Date()): string {
  const midnight = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  const target = new Date(`${iso}T00:00:00`);
  if (Number.isNaN(target.getTime())) return iso;

  const days = Math.round((midnight.getTime() - target.getTime()) / 86_400_000);
  if (days === 0) return 'Today';
  if (days === 1) return 'Yesterday';
  return formatDate(iso);
}

/** YYYY-MM-DD in local time (not UTC — `toISOString` would shift the day). */
export function toISODate(date: Date): string {
  const month = `${date.getMonth() + 1}`.padStart(2, '0');
  const day = `${date.getDate()}`.padStart(2, '0');
  return `${date.getFullYear()}-${month}-${day}`;
}

export const TRANSACTION_LABELS: Record<TransactionType, string> = {
  wage: 'Wage earned',
  advance: 'Advance given',
  payment: 'Payment settled',
};

export const ATTENDANCE_LABELS: Record<AttendanceStatus, string> = {
  present: 'Present',
  half_day: 'Half day',
  absent: 'Absent',
  rain_out: 'Rained out',
};

/** One-character marks for the dense attendance grid and the ledger gutter. */
export const ATTENDANCE_GLYPHS: Record<AttendanceStatus, string> = {
  present: 'P',
  half_day: '½',
  absent: 'A',
  // Not "R": the umbrella reads at a glance in bright sun, which is where
  // this button gets pressed.
  rain_out: '☂',
};

export const PAYMENT_MODE_LABELS: Record<PaymentMode, string> = {
  cash: 'Cash',
  upi: 'UPI',
  bank_transfer: 'Bank transfer',
};

/**
 * The three ways money changes hands, in the order they are offered.
 *
 * Cash first because that is still how most of a site gets paid, and it is
 * the default the API falls back to when nothing is chosen.
 */
export const PAYMENT_MODES: {
  value: PaymentMode;
  label: string;
  icon: keyof typeof Ionicons.glyphMap;
}[] = [
  { value: 'cash', label: PAYMENT_MODE_LABELS.cash, icon: 'cash-outline' },
  { value: 'upi', label: PAYMENT_MODE_LABELS.upi, icon: 'phone-portrait-outline' },
  { value: 'bank_transfer', label: PAYMENT_MODE_LABELS.bank_transfer, icon: 'business-outline' },
];

/** "UPI" for a known mode, null when none was recorded (every wage, and history). */
export function formatPaymentMode(mode: PaymentMode | null | undefined): string | null {
  if (!mode) return null;
  return PAYMENT_MODE_LABELS[mode] ?? null;
}

/** "6.5 days" / "1 day" — days_worked counts a half day as a half. */
export function formatDays(days: number): string {
  const rounded = Number.isInteger(days) ? String(days) : days.toFixed(1);
  return `${rounded} ${days === 1 ? 'day' : 'days'}`;
}
