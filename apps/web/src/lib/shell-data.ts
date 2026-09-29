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
  /** Every People route, as its manifest writes them: which one the address is (`matchPath`). */
  readonly routes: readonly string[];
  /** By a section's path: only what needs somebody to act, never a total. */
  readonly counts: Readonly<Record<string, number>>;
  /** By a tab's path, each tab's own count: what the tab row shows. */
  readonly tabCounts: Readonly<Record<string, number>>;
  readonly notices: readonly ShellNotice[];
  /** When People answered, for "12m ago". */
  readonly now: string | null;
}

export const EMPTY_SHELL: ShellData = {
  roles: { hr: false, admin: false, finance: false },
  sections: [],
  settings: [],
  routes: [],
  counts: {},
  tabCounts: {},
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

/**
 * What waits in Data health's record tools, from People's own reads of them
 * (HR and finance only). `null` where People refused the read: its count is
 * left out rather than guessed.
 */
export interface Waiting {
  readonly identifiers: number | null;
  readonly duplicates: number | null;
  /** Access requests waiting for this person's decision. */
  readonly accessRequests: number | null;
}

const COMPLETENESS = '/people/data-health/completeness';
const ID_CHECKS = '/people/data-health/id-checks';
const DUPLICATES = '/people/data-health/duplicates';
const ACCESS_REQUESTS = '/people/data-health/access-requests';
/** The tabs whose counts are decisions somebody has to make: what a section's count adds up. */
const DECISIONS: ReadonlySet<string> = new Set([ID_CHECKS, DUPLICATES, ACCESS_REQUESTS]);

/**
 * Counts by section path and by tab path; a zero is not shown.
 *
 * A tab counts its own queue: Completeness is everybody waiting on
 * themselves plus what HR has to fill in (HR's summary only). A section counts
 * what needs a decision: Approvals its approvals, Data health its ID checks,
 * duplicates and access requests — not Completeness, which is a backlog
 * rather than a decision. Keyed by the viewer's own places, so a finance
 * viewer's Data health, whose link is its access requests, still has one.
 */
export function countsOf(
  overview: Overview,
  waiting: Waiting | null,
  sections: readonly Place[],
): { readonly sections: Record<string, number>; readonly tabs: Record<string, number> } {
  const tabs: Record<string, number> = {};
  const put = (path: string, n: number | null | undefined): void => {
    if (n != null && n > 0) tabs[path] = n;
  };
  if (overview.roles.hr && overview.team !== null) {
    put(COMPLETENESS, overview.team.waiting + overview.team.toFill);
  }
  put(ID_CHECKS, waiting?.identifiers);
  put(DUPLICATES, waiting?.duplicates);
  put(ACCESS_REQUESTS, waiting?.accessRequests);

  const counts: Record<string, number> = {};
  if ((overview.approvals?.total ?? 0) > 0) {
    counts['/people/approvals'] = overview.approvals?.total ?? 0;
  }
  for (const section of sections) {
    const n = (section.tabs ?? [])
      .filter((t) => DECISIONS.has(t.path))
      .reduce((sum, t) => sum + (tabs[t.path] ?? 0), 0);
    if (n > 0) counts[section.path] = n;
  }
  return { sections: counts, tabs };
}
