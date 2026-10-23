import { icons, type IsoDate } from '@reach/ui';
import type { JSX, ReactNode } from 'react';
import { t } from '../i18n';

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
  xlsx: t('export.words.excel', 'Excel'),
  csv: 'CSV',
  pdf: t('export.words.pdf_roster', 'PDF roster'),
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
    : t('export.words.and', '{{join}} and {{value}}', {
        join: items.slice(0, -1).join(', '),
        value: items.at(-1) ?? '',
      });

/**
 * Who asked, for a row that counts several requests: "Sofia Lindqvist",
 * "Sofia Lindqvist and Marco Ruiz", "Sofia Lindqvist and 2 others", or, where
 * the names are only some of them, "Sofia Lindqvist and others". Null for none.
 */
export function whoOf(names: readonly string[], more = false): string | null {
  const [first, second] = names;
  if (first === undefined) return null;
  if (more) return t('export.words.and_others', '{{first}} and others', { first });
  if (second === undefined) return first;
  return names.length === 2
    ? t('export.words.and_2', '{{first}} and {{replace}}', {
        first,
        replace: second.replace(/^You$/u, 'you'),
      })
    : t('export.words.and_others_2', '{{first}} and {{value}} others', {
        first,
        value: String(names.length - 1),
      });
}

/** A small muted line with a shield: the rule a panel works under. */
export function Rule({ children }: { readonly children: ReactNode }): JSX.Element {
  return (
    <p className="flex items-center gap-1.5 text-xs text-fg-subtle [&_svg]:size-3.5 [&_svg]:shrink-0">
      <icons.permission aria-hidden />
      {children}
    </p>
  );
}
