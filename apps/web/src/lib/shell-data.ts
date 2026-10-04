import {
  currentPlace,
  headerFrame,
  siblingsOf,
  type Area,
  type HeaderFrame,
  type Place,
  type SlotName,
} from './remotes';

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
  readonly kind: 'approval' | 'missing' | 'viewed' | 'import';
  /** An import that failed: said as a failure, not as news. */
  readonly failed?: boolean;
}

/** A People administrator viewed the app as this person: over, and told afterwards. */
export interface ViewedAs {
  readonly id: string;
  /** The administrator, by name; null where People has no record of them. */
  readonly by: string | null;
  readonly at: string;
  readonly endedAt: string;
  /** Special-category data of theirs, or that they may read, was visible. */
  readonly specialCategory: boolean;
}

export interface ShellData {
  readonly roles: { readonly hr: boolean; readonly admin: boolean; readonly finance: boolean };
  readonly sections: readonly Place[];
  readonly settings: readonly Place[];
  /** What can be started from a page (Add person), each where it is offered (`on`). */
  readonly actions?: readonly Place[];
  /** Every People route, as its manifest writes them: which one the address is (`matchPath`). */
  readonly routes: readonly string[];
  /** Which of the remote's exports draws each route: two addresses with one are one screen. */
  readonly screens?: Readonly<Record<string, string>>;
  /** By a section's path: only what needs somebody to act, never a total. */
  readonly counts: Readonly<Record<string, number>>;
  /** By a tab's path, each tab's own count: what the tab row shows. */
  readonly tabCounts: Readonly<Record<string, number>>;
  readonly notices: readonly ShellNotice[];
  /** Every time an administrator viewed the app as them, newest first: the Inbox keeps them. */
  readonly viewedAs: readonly ViewedAs[];
  /** When People answered, for "12m ago". */
  readonly now: string | null;
  /**
   * Every other area this company has (Time Off), by its name in `AREAS`: the
   * places its own manifest offers, cut to this viewer's roles, and its routes.
   * An area whose remote cannot be reached is absent.
   */
  readonly remotes?: Readonly<Record<string, AreaPlaces>>;
}

/** An area's places for one viewer (`placesFor`), and every route its manifest lists. */
export interface AreaPlaces {
  readonly sections: readonly Place[];
  readonly actions: readonly Place[];
  readonly settings: readonly Place[];
  readonly routes: readonly string[];
  /** Which of the remote's exports draws each route: what a loading state draws. */
  readonly screens?: Readonly<Record<string, string>>;
  /** By a section's path, what needs this viewer; a zero is left out. */
  readonly counts?: Readonly<Record<string, number>>;
  /** By a tab's path, the same. */
  readonly tabCounts?: Readonly<Record<string, number>>;
  /** The places in the shell's chrome its remote fills, and with which export (`lib/slots.ts`). */
  readonly slots?: Readonly<Partial<Record<SlotName, string>>>;
}

/**
 * A place in the shell's chrome a remote fills (`slots` in its manifest), as
 * the layout fetched it (`lib/slots.ts`): its export, where its code is, and
 * the data it is drawn from.
 */
export interface ShellSlot {
  readonly area: Area['name'];
  readonly slot: SlotName;
  readonly route: {
    readonly entry: string;
    readonly component: string;
    readonly ssr?: string;
    readonly stylesheet?: { readonly href: string; readonly integrity: string };
  };
  readonly load:
    | { readonly status: 'ready'; readonly data: unknown }
    | { readonly status: 'error'; readonly message: string }
    | { readonly status: 'none' };
}

/**
 * What Time Off says of the person signed in (TOF-058a): whether they approve
 * anybody, whether they are its HR, and what waits for them.
 */
export interface TimeOffViewer {
  readonly approves: boolean;
  readonly hrAdmin: boolean;
  readonly counts: {
    readonly requestsWaiting: number;
    readonly attendanceExceptions: number;
  };
}

/**
 * The roles Time Off's manifest is cut by. Approving is a fact of the org
 * graph Time Off holds, not a role anybody grants, so `manager` is added here
 * for this area only, when Time Off says they approve somebody; `hr` too when
 * they are Time Off's HR in a company whose People says otherwise (or that
 * has no People). Without an answer, the shell's own roles.
 */
export function timeOffRoles(
  roles: ShellData['roles'],
  viewer: TimeOffViewer | null,
): Readonly<Record<string, boolean>> {
  return viewer === null
    ? roles
    : { ...roles, manager: viewer.approves, hr: roles.hr || viewer.hrAdmin };
}

const WAITING = '/time-off/approvals/waiting';
const EXCEPTIONS = '/time-off/attendance/exceptions';

/**
 * Time Off's counts (PRD §15.1): Requests, what waits for this approver;
 * Attendance, the exceptions to fix. Keyed by the viewer's own places, so a
 * section is counted only where they have it; a zero is not shown.
 */
export function timeOffCounts(
  viewer: TimeOffViewer | null,
  sections: readonly Place[],
): { readonly sections: Record<string, number>; readonly tabs: Record<string, number> } {
  const counts: Record<string, number> = {};
  const tabs: Record<string, number> = {};
  if (viewer === null) return { sections: counts, tabs };
  const { requestsWaiting, attendanceExceptions } = viewer.counts;
  for (const section of sections) {
    const paths = [section.path, ...(section.tabs ?? []).map((t) => t.path)];
    const n = paths.includes(WAITING)
      ? requestsWaiting
      : paths.some((p) => p.startsWith('/time-off/attendance/'))
        ? attendanceExceptions
        : 0;
    if (n > 0) counts[section.path] = n;
    if (paths.includes(WAITING) && requestsWaiting > 0) tabs[WAITING] = requestsWaiting;
    if (paths.includes(EXCEPTIONS) && attendanceExceptions > 0) {
      tabs[EXCEPTIONS] = attendanceExceptions;
    }
  }
  return { sections: counts, tabs };
}

export const EMPTY_SHELL: ShellData = {
  roles: { hr: false, admin: false, finance: false },
  sections: [],
  settings: [],
  routes: [],
  counts: {},
  tabCounts: {},
  notices: [],
  viewedAs: [],
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
      /** HR asked them about it: answered beside the change (AI7). Absent from an older People. */
      readonly asked?: boolean;
    }[];
  } | null;
  readonly missing: readonly {
    readonly key: string;
    readonly label: string;
    readonly section: string;
    readonly ownedBy: string | null;
  }[];
  readonly team: { readonly waiting: number; readonly toFill: number } | null;
  /** Absent from a People that predates it. */
  readonly viewedAs?: readonly ViewedAs[];
  /** The viewer's own approved imports that finished in the last two weeks, newest first. Absent from an older People. */
  readonly imports?: readonly ImportNotice[];
}

/** An import the viewer approved, over: Imported or Import failed. */
export interface ImportNotice {
  readonly id: string;
  readonly status: 'succeeded' | 'failed';
  readonly finishedAt: string;
  /** People created or updated. */
  readonly people: number;
  /** New fields it added. */
  readonly fields: number;
  readonly fileName: string | null;
}

const counted = (n: number, one: string, many: string): string =>
  `${n.toLocaleString('en-GB')} ${n === 1 ? one : many}`;

/** "Import finished: 1,000 people, 95 new fields", or "Import failed"; the file under it. */
export function importNotice(i: ImportNotice): Pick<ShellNotice, 'title' | 'detail'> {
  return {
    title:
      i.status === 'failed'
        ? 'Import failed'
        : `Import finished: ${counted(i.people, 'person', 'people')}${
            i.fields > 0 ? `, ${counted(i.fields, 'new field', 'new fields')}` : ''
          }`,
    detail: i.fileName ?? 'An imported file',
  };
}

/** How long the bell tells somebody they were viewed as; the Inbox keeps it after. */
const TOLD_FOR_MS = 14 * 24 * 60 * 60 * 1000;

/** "Grace Hopper viewed Kithena as you", in words the person reads. */
export function viewedAsNotice(v: ViewedAs): Pick<ShellNotice, 'title' | 'detail'> {
  const minutes = Math.max(1, Math.round((Date.parse(v.endedAt) - Date.parse(v.at)) / 60_000));
  return {
    title: `${v.by ?? 'A People administrator'} viewed Kithena as you`,
    detail: `For ${String(minutes)} min, read-only: nothing was changed.${
      v.specialCategory ? ' Your sensitive personal details were visible.' : ''
    }`,
  };
}

/** The notices, newest decisions first, then what the person themselves has to add. */
export function noticesOf(overview: Overview): ShellNotice[] {
  const approvals = (overview.approvals?.items ?? []).map((a): ShellNotice => ({
    id: `approval:${a.id}`,
    title:
      a.asked === true
        ? `HR asked about your ${a.label.toLowerCase()} change`
        : overview.approvals?.isHr === true
          ? `Approve a ${a.label.toLowerCase()} change`
          : `${a.label} is waiting for approval`,
    detail:
      a.asked === true
        ? `${a.name} · answer it to move it on`
        : overview.approvals?.isHr === true
          ? `${a.name} · asked by ${a.requestedBy}`
          : `Asked ${a.requestedBy === a.name ? 'by you' : `by ${a.requestedBy}`}`,
    at: a.requestedAt,
    // Its own item in Review: HR's own change waits under I asked, anybody
    // else's under Waiting, and a change to decide under Waiting for me.
    href: reviewItem(
      a.asked === true && overview.approvals?.isHr === true ? 'asked' : 'waiting',
      'changes',
      `change-${a.id}`,
    ),
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
  const now = Date.parse(overview.now);
  const viewed = (overview.viewedAs ?? [])
    .filter((v) => now - Date.parse(v.endedAt) < TOLD_FOR_MS)
    .map((v): ShellNotice => ({
      id: `viewed:${v.id}`,
      ...viewedAsNotice(v),
      at: v.endedAt,
      href: '/inbox',
      person: v.by,
      kind: 'viewed',
    }));
  const imports = (overview.imports ?? []).map((i): ShellNotice => ({
    id: `import:${i.id}`,
    ...importNotice(i),
    at: i.finishedAt,
    href: `/people/import?run=${encodeURIComponent(i.id)}`,
    person: null,
    kind: 'import',
    ...(i.status === 'failed' ? { failed: true } : {}),
  }));
  return [...viewed, ...imports, ...approvals, ...missing];
}

/**
 * What waits in Review besides changes, from People's own reads of it (HR and
 * finance only). `null` where People refused the read: its count is left out
 * rather than guessed.
 */
export interface Waiting {
  readonly identifiers: number | null;
  readonly duplicates: number | null;
  /** Access requests waiting for this person's decision. */
  readonly accessRequests: number | null;
}

/** Review's tab of what waits for this viewer: where its one count goes. */
export const REVIEW_WAITING = '/people/review/waiting';

/**
 * An item in Review, as a link opens it: the tab, the kind of item (a chip)
 * and the item itself, each in the address (`?kind=&item=`). The item names
 * its kind (`change-…`, `id-…`, `dup-…`, `access-…`, `export-…`), so a link
 * from the bell or an email lands on it whichever chip is chosen.
 */
export function reviewItem(
  tab: 'waiting' | 'flagged' | 'asked' | 'decided',
  kind: 'changes' | 'ids' | 'duplicates' | 'access' | 'exports' | 'missing' | null,
  item: string | null,
): string {
  const q = new URLSearchParams();
  if (kind !== null) q.set('kind', kind);
  if (item !== null) q.set('item', item);
  const qs = q.toString();
  return `/people/review/${tab}${qs === '' ? '' : `?${qs}`}`;
}

/**
 * Counts by section path and by tab path; a zero is not shown.
 *
 * Review carries the one count, red: every decision waiting for this viewer,
 * changes, ID checks, duplicates and requests for full values together. Its
 * Missing details are a backlog rather than a decision, and are not counted.
 * Keyed by the viewer's own places, so a viewer without Review counts nothing.
 */
export function countsOf(
  overview: Overview,
  waiting: Waiting | null,
  sections: readonly Place[],
): { readonly sections: Record<string, number>; readonly tabs: Record<string, number> } {
  const n =
    (overview.approvals?.total ?? 0) +
    (waiting?.identifiers ?? 0) +
    (waiting?.duplicates ?? 0) +
    (waiting?.accessRequests ?? 0);
  const review = sections.find(
    (s) => s.path === REVIEW_WAITING || s.tabs?.some((t) => t.path === REVIEW_WAITING) === true,
  );
  if (review === undefined || n === 0) return { sections: {}, tabs: {} };
  return { sections: { [review.path]: n }, tabs: { [REVIEW_WAITING]: n } };
}

/**
 * A screen's header among an area's places (`AREAS`): "Time off › Requests ›
 * Decided" among its sections, with their counts, "Settings › Time off ›
 * Leave types" among its settings, each crumb a switcher to its siblings. No
 * actions on a setting. The page and its loading state draw the same one.
 */
export function areaFrame(
  area: Area,
  route: string | null,
  places: AreaPlaces | undefined,
): HeaderFrame & { readonly trail: readonly { readonly href: string; readonly label: string }[] } {
  const own = places ?? { sections: [], actions: [], settings: [] };
  if (route?.startsWith(`${area.settings}/`) !== true) {
    return {
      ...headerFrame(
        own,
        route,
        area.home,
        { sections: places?.counts ?? {}, tabs: places?.tabCounts ?? {} },
        area.label,
      ),
      trail: [{ href: area.home, label: area.label }],
    };
  }
  const settings = own.settings.map((p) => ({ ...p, group: `${area.label} settings` }));
  const here = currentPlace(settings, route);
  return {
    section: here?.label ?? null,
    trail: [
      { href: '/settings', label: 'Settings' },
      { href: '/settings', label: area.label },
    ],
    actions: [],
    siblings: siblingsOf(settings, here),
    siblingsLabel: `${area.label} settings`,
  };
}
