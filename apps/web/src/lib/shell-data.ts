import type { Place } from './remotes';

/**
 * What the shell draws around every screen, beyond the person: People's
 * places for the sidebar menu and the search, the counts that need action,
 * and the notices behind the bell.
 *
 * One read of People's overview, as the person signed in, so the menu, the
 * bell and the inbox agree with each other and with the overview screen.
 * Nothing here is invented: a company without People, or a People that cannot
 * be reached, gets an empty shell rather than a guess.
 */

export interface ShellNotice {
  readonly id: string;
  readonly title: string;
  readonly detail: string;
  /** When it was asked for, ISO; absent for a detail that has always been missing. */
  readonly at: string | null;
  readonly href: string;
  /** Whose change it is, for the avatar. */
  readonly person: string | null;
  readonly kind: 'approval' | 'missing';
}

export interface ShellData {
  readonly roles: { readonly hr: boolean; readonly admin: boolean; readonly finance: boolean };
  readonly sections: readonly Place[];
  readonly settings: readonly Place[];
  /** By a section's path: only what needs somebody to act, never a total. */
  readonly counts: Readonly<Record<string, number>>;
  readonly notices: readonly ShellNotice[];
  /** When People answered, for "12m ago". */
  readonly now: string | null;
}

export const EMPTY_SHELL: ShellData = {
  roles: { hr: false, admin: false, finance: false },
  sections: [],
  settings: [],
  counts: {},
  notices: [],
  now: null,
};

export interface Overview {
  readonly roles: ShellData['roles'];
  readonly now: string;
  readonly approvals: {
    readonly isHr: boolean;
    readonly total: number;
    readonly items: readonly {
      readonly id: string;
      readonly name: string;
      readonly label: string;
      readonly requestedAt: string;
      readonly requestedBy: string;
    }[];
  } | null;
  readonly missing: readonly {
    readonly key: string;
    readonly label: string;
    readonly section: string;
    readonly ownedBy: string | null;
  }[];
  readonly team: { readonly waiting: number; readonly toFill: number } | null;
}

/** The notices, newest decisions first, then what the person themselves has to add. */
export function noticesOf(overview: Overview): ShellNotice[] {
  const approvals = (overview.approvals?.items ?? []).map((a): ShellNotice => ({
    id: `approval:${a.id}`,
    title:
      overview.approvals?.isHr === true
        ? `Approve a ${a.label.toLowerCase()} change`
        : `${a.label} is waiting for approval`,
    detail:
      overview.approvals?.isHr === true
        ? `${a.name} · asked by ${a.requestedBy}`
        : `Asked ${a.requestedBy === a.name ? 'by you' : `by ${a.requestedBy}`}`,
    at: a.requestedAt,
    href: '/people/approvals',
    person: a.name,
    kind: 'approval',
  }));
  const missing = overview.missing
    .filter((m) => m.ownedBy === null)
    .map((m): ShellNotice => ({
      id: `missing:${m.key}`,
      title: `Add your ${m.label.toLowerCase()}`,
      detail: m.section,
      at: null,
      href: `/people/me?field=${encodeURIComponent(m.key)}`,
      person: null,
      kind: 'missing',
    }));
  return [...approvals, ...missing];
}

/** Counts by section path. HR's own queue only; a zero is not shown. */
export function countsOf(overview: Overview): Record<string, number> {
  const counts: Record<string, number> = {};
  if ((overview.approvals?.total ?? 0) > 0)
    counts['/people/approvals'] = overview.approvals?.total ?? 0;
  if (overview.roles.hr && (overview.team?.toFill ?? 0) > 0) {
    counts['/people/completeness'] = overview.team?.toFill ?? 0;
  }
  return counts;
}
