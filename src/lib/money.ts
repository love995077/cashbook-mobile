import type { AttendanceStatus, TransactionType } from '@/data/types';

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
};
