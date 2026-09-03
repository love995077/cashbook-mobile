/**
 * One function per backend route, plus the mapping from wire shapes to the
 * domain types in `src/data/types.ts`.
 *
 * The API sends DECIMAL columns as strings ("600.00") so money never rides on
 * a float. Everything is parsed here, at the edge, so no screen has to think
 * about it.
 */

import { request } from '@/api/client';
import type {
  Attendance,
  AttendanceStatus,
  BalanceSummary,
  Transaction,
  TransactionType,
  User,
  UserRole,
} from '@/data/types';
import { buildLedgerEntries } from '@/lib/ledger';
import { parseAmount } from '@/lib/money';
import type { LedgerEntry } from '@/data/types';

// --- wire shapes (exactly what FastAPI returns) ---------------------------

type WireUser = {
  id: number;
  name: string;
  phone: string;
  role: UserRole;
  daily_wage: string | null;
  contractor_id: number | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
};

type WireTransaction = {
  id: number;
  worker_id: number;
  type: TransactionType;
  amount: string;
  date: string;
  note: string | null;
};

type WireAttendance = {
  id: number;
  worker_id: number;
  date: string;
  status: AttendanceStatus;
  note: string | null;
};

type WireBalance = {
  total_wages: string;
  total_advances: string;
  total_payments: string;
  balance: string;
};

type WireLedger = {
  worker: WireUser;
  balance: WireBalance;
  transactions: WireTransaction[];
  attendance: WireAttendance[];
};

type WireToken = {
  access_token: string;
  token_type: string;
  expires_in: number;
  user: WireUser;
};

// --- mappers ---------------------------------------------------------------

function toUser(wire: WireUser): User {
  return {
    id: wire.id,
    name: wire.name,
    phone: wire.phone,
    role: wire.role,
    daily_wage: wire.daily_wage === null ? null : parseAmount(wire.daily_wage),
    contractor_id: wire.contractor_id,
    is_active: wire.is_active,
  };
}

function toTransaction(wire: WireTransaction): Transaction {
  return { ...wire, amount: parseAmount(wire.amount) };
}

function toAttendance(wire: WireAttendance): Attendance {
  return wire;
}

function toBalance(wire: WireBalance): BalanceSummary {
  return {
    total_wages: parseAmount(wire.total_wages),
    total_advances: parseAmount(wire.total_advances),
    total_payments: parseAmount(wire.total_payments),
    balance: parseAmount(wire.balance),
  };
}

// --- auth ------------------------------------------------------------------

export type Session = { token: string; user: User; expiresIn: number };

function toSession(wire: WireToken): Session {
  return {
    token: wire.access_token,
    user: toUser(wire.user),
    expiresIn: wire.expires_in,
  };
}

export async function login(phone: string, password: string): Promise<Session> {
  const wire = await request<WireToken>('/auth/login', {
    method: 'POST',
    body: { phone: phone.trim(), password },
  });
  return toSession(wire);
}

export async function register(input: {
  name: string;
  phone: string;
  password: string;
  role: UserRole;
  daily_wage?: number | null;
  contractor_id?: number | null;
}): Promise<Session> {
  const wire = await request<WireToken>('/auth/register', {
    method: 'POST',
    body: {
      name: input.name.trim(),
      phone: input.phone.trim(),
      password: input.password,
      role: input.role,
      // The API rejects these outright for contractors, so only send them
      // when they carry a value.
      ...(input.daily_wage != null ? { daily_wage: String(input.daily_wage) } : {}),
      ...(input.contractor_id != null ? { contractor_id: input.contractor_id } : {}),
    },
  });
  return toSession(wire);
}

export async function me(token: string): Promise<User> {
  return toUser(await request<WireUser>('/auth/me', { token }));
}

// --- worker ----------------------------------------------------------------

export type WorkerLedger = {
  worker: User;
  balance: BalanceSummary;
  entries: LedgerEntry[];
};

function toLedger(wire: WireLedger): WorkerLedger {
  const transactions = wire.transactions.map(toTransaction);
  const attendance = wire.attendance.map(toAttendance);
  return {
    worker: toUser(wire.worker),
    balance: toBalance(wire.balance),
    entries: buildLedgerEntries(transactions, attendance),
  };
}

export async function fetchMyLedger(token: string, signal?: AbortSignal): Promise<WorkerLedger> {
  return toLedger(await request<WireLedger>('/worker/ledger', { token, signal }));
}

// --- contractor ------------------------------------------------------------

export async function fetchWorkers(token: string, signal?: AbortSignal): Promise<User[]> {
  const wire = await request<WireUser[]>('/contractor/workers', { token, signal });
  return wire.map(toUser);
}

export async function fetchWorkerLedger(
  token: string,
  workerId: number,
  signal?: AbortSignal
): Promise<WorkerLedger> {
  return toLedger(
    await request<WireLedger>(`/contractor/workers/${workerId}/ledger`, { token, signal })
  );
}

export async function createTransaction(
  token: string,
  input: {
    worker_id: number;
    type: TransactionType;
    amount: number;
    date: string;
    note?: string | null;
  }
): Promise<Transaction> {
  const wire = await request<WireTransaction>('/contractor/transactions', {
    method: 'POST',
    token,
    // Send the amount as a string so the decimal survives the trip exactly.
    body: { ...input, amount: input.amount.toFixed(2), note: input.note ?? null },
  });
  return toTransaction(wire);
}

export async function createAttendance(
  token: string,
  input: {
    worker_id: number;
    date: string;
    status: AttendanceStatus;
    note?: string | null;
  }
): Promise<Attendance> {
  const wire = await request<WireAttendance>('/contractor/attendance', {
    method: 'POST',
    token,
    body: { ...input, note: input.note ?? null },
  });
  return toAttendance(wire);
}

export async function createWorker(
  token: string,
  input: { name: string; phone: string; password: string; daily_wage?: number | null }
): Promise<User> {
  const wire = await request<WireUser>('/contractor/workers', {
    method: 'POST',
    token,
    body: {
      name: input.name.trim(),
      phone: input.phone.trim(),
      password: input.password,
      ...(input.daily_wage != null ? { daily_wage: input.daily_wage.toFixed(2) } : {}),
    },
  });
  return toUser(wire);
}

// --- voice entry (Phase 6) -------------------------------------------------

type WireVoiceEntry = {
  worker_id: number | null;
  type: TransactionType;
  amount: string;
  date: string;
  note: string | null;
  confidence: number;
};

type WireVoiceResponse = {
  status: 'recorded' | 'needs_confirmation' | 'not_understood';
  transcript: string;
  message: string;
  created: WireTransaction[];
  pending: WireVoiceEntry[];
  problems: string[];
};

export type VoiceEntryResult = {
  status: 'recorded' | 'needs_confirmation' | 'not_understood';
  transcript: string;
  message: string;
  created: Transaction[];
  pending: {
    worker_id: number | null;
    type: TransactionType;
    amount: number;
    date: string;
    note: string | null;
    confidence: number;
  }[];
  problems: string[];
};

/**
 * Upload a recording to POST /api/voice-entry.
 *
 * React Native's FormData takes a `{ uri, name, type }` object in place of a
 * Blob and streams the file off disk — do not read the recording into memory
 * first, a long clip will not fit comfortably.
 */
export async function uploadVoiceEntry(
  token: string,
  recording: { uri: string; name?: string; mimeType?: string },
  options: { workerId?: number | null; language?: string } = {}
): Promise<VoiceEntryResult> {
  const form = new FormData();

  form.append('audio', {
    uri: recording.uri,
    name: recording.name ?? 'recording.m4a',
    type: recording.mimeType ?? 'audio/m4a',
    // RN's FormData file entry is not a web File; the cast keeps TS honest
    // about that without pretending the shapes match.
  } as unknown as Blob);

  if (options.workerId != null) form.append('worker_id', String(options.workerId));
  form.append('language', options.language ?? 'hi');

  const wire = await request<WireVoiceResponse>('/api/voice-entry', {
    method: 'POST',
    token,
    body: form,
  });

  return {
    status: wire.status,
    transcript: wire.transcript,
    message: wire.message,
    created: wire.created.map(toTransaction),
    pending: wire.pending.map((entry) => ({ ...entry, amount: parseAmount(entry.amount) })),
    problems: wire.problems,
  };
}
