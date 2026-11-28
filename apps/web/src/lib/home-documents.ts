import { dateFormat } from '@reach/ui';

import { t } from './t';

/**
 * Documents on Home: what needs the reader, what is out for signature and
 * what changed last, as lists of plain rows worded here (as `home-time-off.ts`
 * is for Time Off). People's Home draws the rows it is handed, cut and grouped
 * as the reader chooses, and never learns what a document is.
 *
 * Pure: the read is `people-area.tsx`'s.
 */

const SHORT = dateFormat({ day: 'numeric', month: 'short', timeZone: 'UTC' });
const day = (date: string): string => SHORT.format(Date.parse(`${date.slice(0, 10)}T12:00:00Z`));

interface Person {
  readonly name: string;
}

/** What Home reads of `DocumentsLibrary`. */
export interface LibraryAnswer {
  readonly needsYou: readonly {
    readonly id: string;
    readonly kind: 'request' | 'access_request' | 'sign' | 'acknowledge';
    readonly title: string;
    readonly detail: string;
    readonly dueOn: string | null;
    readonly documentId: string | null;
  }[];
  readonly tiles: readonly { readonly key: string; readonly count: number }[];
  readonly rows: readonly {
    readonly id: string;
    readonly title: string;
    readonly kind: string;
    readonly typeName: string | null;
    readonly who: { readonly label: string };
    readonly subject: Person | null;
    readonly updatedAt: string;
    readonly signing?: {
      readonly envelopeId: string;
      readonly status: string;
      readonly signed: number;
      readonly of: number;
      readonly waitingOn: readonly string[];
    } | null;
  }[];
  readonly total: number;
}

export interface HomeDocumentRow {
  readonly id: string;
  readonly title: string;
  readonly href: string;
  /** "Waiting for Omar Haddad", "HR asked for it · Due 3 Dec". */
  readonly detail: string;
  /** What kind of thing it is, in words: what the widget groups by. */
  readonly kind: string;
  /** Who it is about, when it is about somebody. */
  readonly about?: string;
  /** Where it stands, at the row's end: "1 of 2 signed". */
  readonly status?: string;
}

export interface HomeDocuments {
  /** Where every document lives. */
  readonly href: string;
  /** What the reader chooses between; the first is what Home opens on. */
  readonly lists: readonly {
    readonly key: string;
    readonly label: string;
    /** Where the rest of this list is. */
    readonly href: string;
    /** How many there are in all: `rows` may be the first of them. */
    readonly total: number;
    readonly rows: readonly HomeDocumentRow[];
  }[];
  /** HR's follow-up, each leading to its list. */
  readonly figures: readonly {
    readonly label: string;
    readonly value: number;
    readonly href: string;
  }[];
}

/** How many rows of a list Home is handed: enough to group, not the library. */
const HELD = 20;

const FIGURE_AT: Readonly<Record<string, string>> = {
  missing: '/documents/compliance?queue=missing',
  expiring: '/documents/compliance?queue=expiring',
  to_delete: '/documents/compliance?queue=to_delete',
};

export function homeDocuments(library: LibraryAnswer): HomeDocuments {
  const KIND = {
    request: t('lib.home-documents.to_add', 'To add'),
    sign: t('lib.home-documents.to_sign', 'To sign'),
    acknowledge: t('lib.home-documents.to_read', 'To read'),
    access_request: t('lib.home-documents.access_to_decide', 'Access to decide'),
  };
  const FIGURES: Readonly<Record<string, string>> = {
    missing: t('lib.home-documents.missing', 'missing'),
    expiring: t('lib.home-documents.expiring', 'expiring'),
    to_delete: t('lib.home-documents.to_delete', 'to delete'),
  };
  const kindOf = (r: LibraryAnswer['rows'][number]): string => r.typeName ?? r.kind;
  const about = (r: LibraryAnswer['rows'][number]): { about?: string } =>
    r.subject === null ? {} : { about: r.subject.name };
  const out = library.rows.filter((r) => r.signing?.status === 'sent');
  const lists: HomeDocuments['lists'] = [
    {
      key: 'needs',
      label: t('lib.home-documents.needs_you', 'Needs you'),
      href: '/documents/all',
      total: library.needsYou.length,
      rows: library.needsYou.slice(0, HELD).map((n) => ({
        id: n.id,
        title: n.title,
        href:
          n.kind === 'sign'
            ? `/documents/envelopes/${n.id}`
            : n.kind === 'acknowledge' && n.documentId !== null
              ? `/documents/d/${n.documentId}`
              : '/documents/all',
        detail: [
          n.detail,
          n.dueOn === null
            ? null
            : t('lib.home-documents.due', 'Due {{when}}', { when: day(n.dueOn) }),
        ]
          .filter((x) => x !== null && x !== '')
          .join(' · '),
        kind: KIND[n.kind],
      })),
    },
    {
      key: 'signing',
      label: t('lib.home-documents.out_for_signature', 'Out for signature'),
      href: '/documents/envelopes',
      total: out.length,
      rows: out.slice(0, HELD).map((r) => ({
        id: r.id,
        title: r.title,
        href: `/documents/envelopes/${r.signing?.envelopeId ?? ''}`,
        detail:
          r.signing == null || r.signing.waitingOn.length === 0
            ? r.who.label
            : t('lib.home-documents.waiting_for', 'Waiting for {{names}}', {
                names: r.signing.waitingOn.join(', '),
              }),
        kind: kindOf(r),
        ...about(r),
        ...(r.signing == null
          ? {}
          : {
              status: t('lib.home-documents.signed_of', '{{signed}} of {{of}} signed', {
                signed: String(r.signing.signed),
                of: String(r.signing.of),
              }),
            }),
      })),
    },
    {
      key: 'recent',
      label: t('lib.home-documents.recently_updated', 'Recently updated'),
      href: '/documents/all',
      total: library.total,
      rows: library.rows.slice(0, HELD).map((r) => ({
        id: r.id,
        title: r.title,
        href: `/documents/d/${r.id}`,
        detail: r.who.label,
        kind: kindOf(r),
        ...about(r),
        status: day(r.updatedAt),
      })),
    },
  ];
  return {
    href: '/documents/all',
    // A list with nothing in it is not offered: what is left opens on its first.
    lists: lists.filter((l) => l.rows.length > 0),
    figures: library.tiles.flatMap((tile) => {
      const href = FIGURE_AT[tile.key];
      const label = FIGURES[tile.key];
      return href === undefined || label === undefined || tile.count === 0
        ? []
        : [{ label, value: tile.count, href }];
    }),
  };
}
