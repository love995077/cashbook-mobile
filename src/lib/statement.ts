/**
 * A single worker's PDF statement.
 *
 * The fetch-to-disk-then-share mechanics live in `src/lib/reports.ts`; this is
 * only the endpoint and the filename. It stays a separate module because both
 * sides use it - the worker sharing their own statement, and the contractor
 * sharing one worker's - while the reports screen is contractor-only.
 */

import { downloadReport, type DownloadOutcome } from '@/lib/reports';

export type StatementRequest = {
  token: string;
  workerId: number;
  workerName: string;
  startDate?: string | null;
  endDate?: string | null;
};

/** Mirrors the server filename so a shared file is recognisable. */
function buildFilename(workerName: string, endDate?: string | null): string {
  const safe =
    workerName
      .split(/[^A-Za-z0-9]+/)
      .filter(Boolean)
      .join('-') || 'worker';
  const stamp = endDate ?? new Date().toISOString().slice(0, 10);
  return `${safe}-statement-${stamp}.pdf`;
}

export async function downloadStatement(request: StatementRequest): Promise<DownloadOutcome> {
  return downloadReport({
    token: request.token,
    path: `/api/reports/worker/${request.workerId}/pdf`,
    params: { start_date: request.startDate, end_date: request.endDate },
    filename: buildFilename(request.workerName, request.endDate),
    format: 'pdf',
    title: `${request.workerName} - cashbook statement`,
  });
}
