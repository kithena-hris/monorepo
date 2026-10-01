import { icons, type IsoDate } from '@reach/ui';
import type { JSX, ReactNode } from 'react';

/** What the export screens share: the choice, and how they word it. */

export type ExportFormat = 'xlsx' | 'csv' | 'pdf';

export interface ExportChoice {
  readonly who: string;
  readonly fields: readonly string[];
  readonly asOf: IsoDate;
  readonly format: ExportFormat;
  /** Profile photos too, as a ZIP beside the file. */
  readonly photos?: boolean;
  /** Why: saved with the export and shown in the audit log. */
  readonly reason?: string;
}

/** A change to the page's address; null removes a key. */
export type AddressPatch = Readonly<Record<string, string | null>>;

export const FORMAT_LABEL: Record<ExportFormat, string> = {
  xlsx: 'Excel',
  csv: 'CSV',
  pdf: 'PDF roster',
};

/** "30 June 2026": a calendar date as people say it. */
export const spokenDate = (date: string): string =>
  new Intl.DateTimeFormat('en-GB', { dateStyle: 'long', timeZone: 'UTC' }).format(
    new Date(`${date.slice(0, 10)}T00:00:00Z`),
  );

/** "Sofia" from "Sofia Lindqvist"; "them" for somebody People holds no name for. */
export const firstName = (name: string | null | undefined): string =>
  name == null || name.trim() === '' ? 'them' : (name.trim().split(/\s+/u)[0] ?? name);

/** "a, b and c". */
export const listed = (items: readonly string[]): string =>
  items.length <= 1
    ? (items[0] ?? '')
    : `${items.slice(0, -1).join(', ')} and ${items.at(-1) ?? ''}`;

/** A small muted line with a shield: the rule a panel works under. */
export function Rule({ children }: { readonly children: ReactNode }): JSX.Element {
  return (
    <p className="flex items-center gap-1.5 text-xs text-fg-subtle [&_svg]:size-3.5 [&_svg]:shrink-0">
      <icons.permission aria-hidden />
      {children}
    </p>
  );
}
