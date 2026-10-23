import { Avatar, Badge, icons } from '@reach/ui';
import { useState, useTransition, type JSX, type ReactNode } from 'react';

import type { FileRef, Kind, Outcome, Row, StartUpload, Tone } from './types';
import { t } from './i18n';

/**
 * What every Documents screen draws the same way: a document's icon, its
 * access badge and status, a date in words, and a file put in the bucket.
 */

const KINDS: Record<
  Kind,
  {
    readonly icon: ReactNode;
    readonly tone: 'accent' | 'info' | 'success' | 'warning' | 'danger' | 'neutral';
  }
> = {
  Contract: { icon: <icons.edit aria-hidden />, tone: 'accent' },
  Policy: { icon: <icons.document aria-hidden />, tone: 'info' },
  Payslip: { icon: <icons.payroll aria-hidden />, tone: 'success' },
  Letter: { icon: <icons.email aria-hidden />, tone: 'neutral' },
  ID: { icon: <icons.identifier aria-hidden />, tone: 'warning' },
  Personal: { icon: <icons.file aria-hidden />, tone: 'neutral' },
  Medical: { icon: <icons.health aria-hidden />, tone: 'danger' },
  Sheet: { icon: <icons.spreadsheet aria-hidden />, tone: 'success' },
  Template: { icon: <icons.cards aria-hidden />, tone: 'neutral' },
  Permit: { icon: <icons.travel aria-hidden />, tone: 'warning' },
  Form: { icon: <icons.list aria-hidden />, tone: 'neutral' },
};

/** A document's tile: its kind's icon on its kind's tone. */
export function DocIcon({
  kind,
  size = 'lg',
}: {
  readonly kind: Kind;
  readonly size?: 'md' | 'lg' | 'xl';
}): JSX.Element {
  const k = KINDS[kind];
  return <Avatar name={kind} shape="rounded" size={size} tone={k.tone} fallback={k.icon} />;
}

/** Private, Shared, Everyone or Confidential: who can open it, at a glance (A1). */
export function AccessBadge({
  row,
}: {
  readonly row: Pick<Row, 'level' | 'confidential' | 'everyone'>;
}): JSX.Element {
  if (row.confidential) {
    return (
      <Badge tone="warning" size="sm">
        <icons.sensitive aria-hidden />
        {t('shared.confidential', 'Confidential')}
      </Badge>
    );
  }
  if (row.everyone) {
    return (
      <Badge tone="info" size="sm">
        <icons.company aria-hidden />
        {t('shared.everyone', 'Everyone')}
      </Badge>
    );
  }
  return row.level === 'shared' ? (
    <Badge tone="info" size="sm">
      <icons.people aria-hidden />
      {t('shared.shared', 'Shared')}
    </Badge>
  ) : (
    <Badge tone="neutral" size="sm">
      <icons.locked aria-hidden />
      {t('shared.private', 'Private')}
    </Badge>
  );
}

export function StatusBadge({
  status,
}: {
  readonly status: { readonly label: string; readonly tone: Tone } | null;
}): JSX.Element | null {
  return status === null ? null : (
    <Badge tone={status.tone} size="sm" dot>
      {status.label}
    </Badge>
  );
}

const DAY = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' });
const YEAR = new Intl.DateTimeFormat('en-GB', {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
  timeZone: 'UTC',
});

/** "12 Sep", or "2 Sep 2024" in another year than `today`'s. */
export function shortDate(iso: string, today?: string): string {
  const at = new Date(iso.length === 10 ? `${iso}T00:00:00Z` : iso);
  return (today ?? iso).slice(0, 4) === iso.slice(0, 4) ? DAY.format(at) : YEAR.format(at);
}

/** "1 page", "6 pages". */
export const pages = (n: number | null): string | null =>
  n === null
    ? null
    : t('shared.page', '{{n}} page{{value}}', { n: String(n), value: n === 1 ? '' : 's' });

/** "Contract · 6 pages", what a row says under its name. */
export const meta = (row: Pick<Row, 'typeName' | 'pages' | 'subject'>): string =>
  [
    row.typeName ?? t('shared.your_document', 'Your document'),
    pages(row.pages),
    row.subject?.name ?? null,
  ]
    .filter(Boolean)
    .join(' · ');

/**
 * Put one file in the bucket: ask Documents where, then PUT it there from the
 * browser, so the bytes never pass through the shell (PRD §8.1).
 */
export async function putFile(
  file: File,
  startUpload: StartUpload,
): Promise<
  { readonly ok: true; readonly ref: FileRef } | { readonly ok: false; readonly message: string }
> {
  const mediaType = file.type || 'application/octet-stream';
  const started = await startUpload({ name: file.name, mediaType, size: file.size });
  if (!started.ok) return started;
  const { put } = started;
  try {
    const sent = await fetch(put.url, { method: put.method, headers: put.headers, body: file });
    if (!sent.ok)
      return {
        ok: false,
        message: t(
          'shared.the_file_could_not_be_uploaded',
          'The file could not be uploaded. Try again.',
        ),
      };
  } catch {
    return {
      ok: false,
      message: t(
        'shared.the_file_could_not_be_uploaded_2',
        'The file could not be uploaded. Check your connection.',
      ),
    };
  }
  return { ok: true, ref: { uploadId: put.uploadId, name: file.name, mediaType } };
}

/** A write's pending state and its refusal, for one button or form. */
export function useWrite(): {
  readonly pending: boolean;
  readonly error: string | null;
  readonly run: (write: () => Promise<Outcome>, after?: () => void) => void;
  readonly clear: () => void;
} {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  return {
    pending,
    error,
    clear: () => {
      setError(null);
    },
    run: (write, after) => {
      setError(null);
      start(async () => {
        const done = await write();
        if (done.ok) after?.();
        else setError(done.message);
      });
    },
  };
}
