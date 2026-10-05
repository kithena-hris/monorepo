'use client';

import type { Route } from 'next';
import { useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useRef, useState, useTransition, type JSX } from 'react';

import * as actions from '../app/(app)/people/actions';
import type { ScreenLoad } from '../lib/people-screens';
import { useShellData } from './app-shell';
import { DIRECTORY_VIEWS, viewHref } from '../lib/shortcuts';
import {
  conditionsOf,
  filtersOf,
  noteInAddress,
  oneOf,
  withQuery,
  type HistoryMode,
} from '../lib/url-state';
import { retryDelay } from '../lib/waking';
import { RemoteScreen, type RemoteRoute } from './remote-screen';
import {
  exportAddressOf,
  scheduleAudienceOf,
  shareChoiceOf,
  type ExportFormat,
  type ShareChoice,
} from '../lib/export-address';

/** What the export page's load holds, as far as the shell reads it. */
type ExportPageData = {
  readonly who: readonly { readonly value: string; readonly label: string }[];
  readonly sections: readonly { readonly fields: readonly { readonly key: string }[] }[];
};

/** The remote's export choice, as its callbacks hand it over. */
type ExportBuilderChoice = {
  readonly who: string;
  readonly fields: readonly string[];
  readonly asOf: string;
  readonly format: ExportFormat;
  readonly photos?: boolean;
  readonly reason?: string;
};

/**
 * A People screen's props, from what the server fetched and the actions that
 * call People (PEO-098).
 *
 * The one place the shell knows each screen's prop names. It adds nothing to
 * the data: the `Loadable` is the server's answer as it arrived, and every
 * callback is a server action or a navigation. A write that goes through
 * answers with the page drawn again (`changed` in `lib/people.ts`), so the
 * next render is People's answer and never the browser's guess.
 */

type Outcome = { readonly ok: true } | { readonly ok: false; readonly message: string };

export interface PeopleScreenProps {
  readonly route: RemoteRoute | null;
  readonly load: ScreenLoad;
  /** The address it was drawn for, without its query: which tab or view of the screen it is. */
  readonly path: string;
  readonly params: Readonly<Record<string, string>>;
  readonly search: Readonly<Record<string, string>>;
  readonly today: string;
  /**
   * The breadcrumb's section, its siblings and the umbrella page's tabs, and
   * the actions, for the screen's own header (`headerFrame`): the remote's
   * `Frame`, as JSON.
   */
  readonly frame?:
    | {
        readonly section?: string | null;
        /** The links before the section; absent, People alone. */
        readonly trail?: readonly { readonly href: string; readonly label: string }[];
        /** The sections, grouped, for the breadcrumb's menu. `icon` is a Reach icon name. */
        readonly siblings?: readonly {
          readonly label: string;
          readonly items: readonly {
            readonly href: string;
            readonly label: string;
            readonly current?: boolean;
            readonly icon?: string;
            readonly count?: number;
          }[];
        }[];
        readonly siblingsLabel?: string;
        /** What the address asked for and People refused; the page is shown without it. */
        readonly notice?: string;
        /** The umbrella page's tabs this viewer may open, in order. Absent: no tabs. */
        readonly tabs?: readonly {
          readonly href: string;
          readonly label: string;
          /** Its label as a pill under a finger, where one is shorter. */
          readonly short?: string;
          readonly current: boolean;
          readonly count?: number;
        }[];
        /** The body is on its way under this header (`PeopleLoading`). */
        readonly pending?: boolean;
        readonly actions?: readonly {
          readonly href: string;
          readonly label: string;
          readonly icon?: string;
        }[];
      }
    | undefined;
}

/**
 * PUT a file straight to storage (PRD §14.2): the presigned URL People issued,
 * with exactly the headers it signed. Never through this app's server — a
 * Vercel function takes 4.5 MB and an import may be 100 MB. XHR rather than
 * fetch, because fetch reports no upload progress. The browser sets the
 * length from the file itself, which is the length that was signed.
 */
function putFile(
  target: Extract<actions.UploadTarget, { ok: true }>,
  file: Blob,
  progress: (percent: number) => void,
): Promise<boolean> {
  return new Promise((resolve) => {
    const xhr = new XMLHttpRequest();
    xhr.open(target.method, target.url);
    for (const [name, value] of Object.entries(target.headers)) {
      if (name !== 'content-length') xhr.setRequestHeader(name, value);
    }
    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable) progress(Math.round((event.loaded / event.total) * 100));
    };
    xhr.onload = () => {
      resolve(xhr.status >= 200 && xhr.status < 300);
    };
    xhr.onerror = () => {
      resolve(false);
    };
    xhr.send(file);
  });
}

/**
 * A picked photo as People keeps one: the centre square, at most 512 pixels a
 * side, as a JPEG. Drawn through a canvas, so what leaves the browser is the
 * picture and nothing a camera wrote beside it; a phone's 5 MB photo becomes a
 * few tens of kB. People checks it again whatever arrives.
 */
async function shrink(file: File): Promise<Blob | null> {
  try {
    // `from-image`: a phone's portrait photo the right way up.
    const image = await createImageBitmap(file, { imageOrientation: 'from-image' });
    const side = Math.min(image.width, image.height);
    const out = Math.min(512, side);
    const canvas = document.createElement('canvas');
    canvas.width = out;
    canvas.height = out;
    canvas
      .getContext('2d')
      ?.drawImage(
        image,
        (image.width - side) / 2,
        (image.height - side) / 2,
        side,
        side,
        0,
        0,
        out,
        out,
      );
    image.close();
    return await new Promise((resolve) => {
      canvas.toBlob(resolve, 'image/jpeg', 0.86);
    });
  } catch {
    return null;
  }
}

/** Shrink, upload straight to storage, and have People keep it: a photo for `personId`, or one's own. */
async function uploadPhoto(
  personId: string | null,
  file: File,
): Promise<{ ok: true; avatarUrl: string | null } | { ok: false; message: string }> {
  const small = await shrink(file);
  if (small === null)
    return { ok: false, message: 'That image could not be read; try a PNG or a JPEG.' };
  const target = await actions.startPhotoUpload(personId, small.size);
  if (!target.ok) return target;
  if (!(await putFile(target, small, () => undefined))) {
    return { ok: false, message: 'The upload did not go through; try again.' };
  }
  return actions.completePhotoUpload(personId, target.uploadId);
}

/**
 * An image People cannot read as it is (a WebP, a HEIC a phone made) redrawn
 * as a JPEG, at most 2048 pixels a side, the right way up. A PNG, a JPEG and
 * a PDF go as they are; People checks every file whatever arrives.
 */
async function asUploadable(file: File): Promise<Blob | null> {
  if (!file.type.startsWith('image/') || file.type === 'image/png' || file.type === 'image/jpeg') {
    return file;
  }
  try {
    const image = await createImageBitmap(file, { imageOrientation: 'from-image' });
    const scale = Math.min(1, 2048 / Math.max(image.width, image.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(image.width * scale);
    canvas.height = Math.round(image.height * scale);
    canvas.getContext('2d')?.drawImage(image, 0, 0, canvas.width, canvas.height);
    image.close();
    return await new Promise((resolve) => {
      canvas.toBlob(resolve, 'image/jpeg', 0.9);
    });
  } catch {
    return null;
  }
}

/** Upload a file for an image or document field, and have People keep it. */
async function uploadFile(
  personId: string | null,
  key: string,
  file: File,
): Promise<{ ok: true; file: actions.FileInfo } | { ok: false; message: string }> {
  const body = await asUploadable(file);
  if (body === null) return { ok: false, message: 'That file could not be read.' };
  const name = body === file ? file.name : file.name.replace(/\.[^.]*$/, '') + '.jpg';
  const target = await actions.startFileUpload(personId, key, name, body.size);
  if (!target.ok) return target;
  if (!(await putFile(target, body, () => undefined))) {
    return { ok: false, message: 'The upload did not go through; try again.' };
  }
  return actions.completeFileUpload(personId, key, target.uploadId);
}

type Stage = Record<string, unknown> & { step: string; blockedUrl?: string | null };

/** An approved import as People answers `importRun`, as far as the shell reads it. */
type RunView = Readonly<Record<string, unknown>> & { readonly id: string; readonly status: string };

const isRunView = (value: unknown): value is RunView =>
  typeof value === 'object' &&
  value !== null &&
  typeof (value as { id?: unknown }).id === 'string' &&
  typeof (value as { status?: unknown }).status === 'string';

const runGoing = (run: RunView | null): boolean =>
  run === null || run.status === 'queued' || run.status === 'running';

/** How often a running import is asked about: often enough that its count moves. */
const POLL_MS = 2_000;

/**
 * An approved import, followed until it is over: People is asked every two
 * seconds, one ask at a time, starting from what the page was drawn with.
 * While the VM wakes the last answer stays on screen, marked `waking`, and the
 * asks back off as the waking page's do (`lib/waking.ts`); any other failure
 * is asked again too, since the import goes on whatever this page hears.
 * Once it is over, `over` runs once, so what was drawn from it is read again.
 */
function useImportRun(
  id: string | null,
  drawn: RunView | null,
  over: () => void,
): { readonly run: RunView | null; readonly waking: boolean } {
  const [polled, setPolled] = useState<RunView | null>(null);
  const [failures, setFailures] = useState(0);
  const [waking, setWaking] = useState(false);
  const run = polled?.id === id ? polled : drawn?.id === id ? drawn : null;
  const going = id !== null && runGoing(run);
  const was = useRef(going);
  useEffect(() => {
    if (was.current && !going && id !== null && polled?.id === id) over();
    was.current = going;
  });
  useEffect(() => {
    if (!going) return undefined;
    let live = true;
    const timer = setTimeout(
      () => {
        void actions.importRun(id).then((answer) => {
          if (!live) return;
          if (answer.ok && isRunView(answer.data)) {
            setPolled(answer.data);
            setWaking(false);
            setFailures(0);
          } else {
            setWaking(!answer.ok && answer.waking);
            setFailures((n) => n + 1);
          }
        });
      },
      failures === 0 ? POLL_MS : retryDelay(failures - 1),
    );
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [id, going, polled, failures]);
  return { run, waking: run !== null && going && waking };
}

/**
 * A small export is ready now: open its file. A queued one is announced when
 * it is ready, as the screen says.
 */
function download(
  made:
    { ok: true; links: readonly { name: string; url: string }[] } | { ok: false; message: string },
): Outcome {
  if (!made.ok) return made;
  // The file itself, not the About that travels beside a CSV (design AI14).
  const first = made.links.find((l) => !l.name.startsWith('about-')) ?? made.links[0];
  if (first !== undefined) window.location.assign(first.url);
  return { ok: true };
}

export function PeopleScreen(input: PeopleScreenProps): JSX.Element {
  const { route, path, params, search, today, frame } = input;
  const { load } = input;
  const shell = useShellData();
  const router = useRouter();
  const [, startTransition] = useTransition();
  const refresh = (): void => {
    startTransition(() => {
      router.refresh();
    });
  };
  const go = (to: string): void => {
    router.push(to);
  };
  // A tab or a view is the last segment of its route (`/people/insights/turnover`,
  // `/people/directory/cards`): literal routes, so an unknown one never gets here.
  const leaf = path.split('/').at(-1) ?? '';
  /*
   * What narrows the screen lives in the address, so a link opens the same
   * view (`lib/url-state.ts`). `live` is the address as it is now: it follows
   * the History API, which the server's `search` does not.
   *
   * Two ways it changes. What People answers (the directory's page, an
   * Insights segment) is a navigation, and the server reads it again. What
   * the screen applies to what it already has (a tab, a history's filter) is
   * noted in the address only (`noteInAddress`), with no round trip. Either
   * way typing rewrites the entry it is on, and a deliberate choice (a chip,
   * a tab, an order) is a new one that Back undoes.
   */
  const live = useSearchParams();
  const at = (key: string): string | null => live.get(key);
  // A navigation on its way: noting where the reader is (`noteInAddress`) would
  // rewrite the old address under it, and Next would drop the navigation.
  const navigating = useRef(false);
  useEffect(() => {
    navigating.current = false;
  }, [live]);
  const navigate = (patch: Readonly<Record<string, string | null>>, mode: HistoryMode = 'push') => {
    const to = withQuery(window.location.pathname, window.location.search, patch) as Route;
    navigating.current = true;
    if (mode === 'push') router.push(to, { scroll: false });
    else router.replace(to, { scroll: false });
  };
  const note = noteInAddress;
  /** Search text, as a key: empty is the default and left out. */
  const typed = (text: string): string | null => (text.trim() === '' ? null : text);
  // Switching a directory view keeps the search and the filters, not the page,
  // nor what only the org chart reads: the same address `]` goes to.
  const switchView = (view: string): void => {
    const known = oneOf(view, DIRECTORY_VIEWS, null);
    // The same page in another view, from the switch in its own header: where
    // the page is scrolled to stays, so Next is not asked to find the new
    // view's top, which reads the layout of the page it has just changed.
    if (known !== null) router.push(viewHref(known, window.location.search), { scroll: false });
  };

  // The import's steps: which upload People holds the file under (§14.2),
  // the mapping chosen, and the stages so far, for Back.
  const [importing, setImporting] = useState<{
    uploadId: string | null;
    mapping: Readonly<Record<number, string | null>>;
    stages: Stage[];
    /** The run just approved, until People first answers for it. */
    run?: RunView;
  }>({ uploadId: null, mapping: {}, stages: [{ step: 'upload' }] });

  const loadable =
    load.status === 'ready'
      ? { status: 'ready' as const, data: load.data }
      : load.status === 'error'
        ? { status: 'error' as const, message: load.message, retry: refresh }
        : null;

  const component = route?.component ?? '';

  // The import an import page shows (`?run=`), or the one any of the import's
  // ways in waits for, followed until it is over; then the page is read again.
  const drawnData =
    load.status === 'ready' && typeof load.data === 'object' && load.data !== null
      ? (load.data as { run?: unknown; activeImport?: unknown })
      : {};
  const runId =
    component === 'ImportFlow' && at('run') !== null
      ? at('run')
      : isRunView(drawnData.activeImport) &&
          (component === 'ImportFlow' || component === 'ImportExport' || component === 'Directory')
        ? drawnData.activeImport.id
        : null;
  const drawnRun =
    [drawnData.run, drawnData.activeImport, importing.run].find(
      (r): r is RunView => isRunView(r) && r.id === runId,
    ) ?? null;
  const followed = useImportRun(runId, drawnRun, refresh);
  /** The run that keeps Import waiting, or null. */
  const running = runId !== null && runGoing(followed.run) ? followed.run : null;

  // An export described in words (docs/ai-settings.md), from the export page or
  // Import & export's card: the choices go into the export page's address, and
  // it starts again from them for a person to check.
  const describeExport = async (sentence: string) => {
    const planned = await actions.planExport(sentence);
    if (!planned.ok) return planned;
    const plan = planned.data as {
      who: string;
      conditions: readonly { key: string; op: string; values: readonly string[] }[];
      match: 'all' | 'any';
      fields: readonly string[];
      asOf: string;
      format: string;
      photos: boolean;
      reason: string;
      by: 'assistant' | 'rules';
      note: string | null;
      notes: readonly string[];
    };
    go(
      withQuery(
        '/people/export',
        {},
        {
          q: sentence,
          read: plan.by,
          who: plan.who === 'everyone' ? null : plan.who,
          conditions: plan.conditions.length === 0 ? null : JSON.stringify(plan.conditions),
          match: plan.match === 'any' ? 'any' : null,
          fields: plan.fields.join(','),
          asOf: plan.asOf,
          format: plan.format,
          photos: plan.photos ? 'true' : null,
          reason: plan.reason,
        },
      ),
    );
    return { ok: true as const, by: plan.by, note: plan.note, notes: plan.notes };
  };

  // The dialog open over a screen (`?open=`), so a shared link opens it in the
  // server's HTML; the screen checks it names one it offers.
  const dialog = {
    open: at('open'),
    onOpenChange: (open: string | null) => {
      note({ open }, open === null ? 'replace' : 'push');
    },
  };

  const props = ((): Record<string, unknown> => {
    switch (component) {
      case 'PeopleSetup':
        return {
          load: loadable,
          onConfirmEntity: actions.confirmEntity,
          onPublish: actions.publishSetup,
          onSaveProfile: actions.saveOwnSection,
          // The first administrator is the only HR member: they approve their own NIF (PEO-077).
          onSelfApprove: actions.approveAlone,
          onWithdraw: actions.withdrawPendingChange,
          onFinish: () => {
            go('/people/me');
          },
        };
      case 'Onboarding':
        return {
          load: loadable,
          onUploadFile: (key: string, file: File) => uploadFile(null, key, file),
          onSave: actions.saveOwnSection,
          onCheck: (sectionKey: string, changed: Readonly<Record<string, unknown>>) =>
            actions.checkIdentifiers(null, sectionKey, changed),
        };
      case 'Profile': {
        const id = params['id'];
        return {
          load: loadable,
          // A link from the overview to one missing detail.
          ...(search['field'] === undefined ? {} : { focusField: search['field'] }),
          // The section being edited and what is open over the record, in the
          // address so a link opens them in the server's HTML; the screen
          // checks each is one this record and viewer offer.
          editing: at('edit'),
          onEditingChange: (section: string | null) => {
            note({ edit: section, field: null }, section === null ? 'replace' : 'push');
          },
          ...dialog,
          // Offered to everybody; the screen shows it only where People says they may.
          onPhoto: (file: File) => uploadPhoto(id ?? null, file),
          // A file for an image or document field; the form's Save keeps it.
          onUploadFile: (key: string, file: File) => uploadFile(id ?? null, key, file),
          onCheck: (sectionKey: string, changed: Readonly<Record<string, unknown>>) =>
            actions.checkIdentifiers(id ?? null, sectionKey, changed),
          onSave:
            id === undefined
              ? actions.saveOwnSection
              : (sectionKey: string, changed: Readonly<Record<string, unknown>>) =>
                  actions.savePersonSection(id, sectionKey, changed),
          // Only another person's record: nobody moves their own employment.
          ...(id === undefined
            ? {}
            : {
                onMove: (move: actions.LifecycleMove) => actions.moveLifecycle(id, move),
                onPlace: (placement: Parameters<typeof actions.placePerson>[1]) =>
                  actions.placePerson(id, placement),
                // One value from a date (W11): People's effective-dated write for one person.
                onChangeDated: async (change: {
                  values: Readonly<Record<string, unknown>>;
                  effectiveFrom: string;
                }) => {
                  const done = await actions.commitBulkEdit({
                    personIds: [id],
                    values: change.values,
                    effectiveFrom: change.effectiveFrom,
                  });
                  return done.ok ? { ok: true as const } : done;
                },
                // The employee record as a PDF (PEO-061), as this viewer reads it.
                onDownloadRecord: async (reason: string) =>
                  download(await actions.exportRecord(id, reason)),
                // An administrator views the app as them: the whole page, and
                // the shell around it, are then theirs — a full load, not a refresh.
                onViewAs: async (reason: string) => {
                  const started = await actions.viewAs(id, reason);
                  if (started.ok) window.location.assign('/');
                  return started;
                },
                // Ask them for empty details; People says which fields may be asked for.
                onRequest: (keys: readonly string[]) => actions.requestDetails(id, keys),
              }),
          searchPeople: actions.searchPeople,
          historyHref: id === undefined ? '/people/me/history' : `/people/${id}/history`,
          onWithdraw: actions.withdrawPendingChange,
          onSelfApprove: actions.approveAlone,
          onApprovals: () => {
            go('/people/review/waiting?kind=changes');
          },
        };
      }
      // A date is a URL, so Back returns to the one before (PEO-064).
      case 'PersonHistory': {
        const id = params['id'];
        return {
          load: loadable,
          // People reads the record as of the date; the field it is narrowed to stays.
          onAsOf: (asOf: string | null) => {
            navigate({ asOf });
          },
          field: at('field'),
          onFieldChange: (field: string | null) => {
            note({ field }, 'push');
          },
          onBack: () => {
            go(id === undefined ? '/people/me' : `/people/${id}`);
          },
        };
      }
      case 'Directory': {
        const filters = filtersOf(at('filter'));
        const joined = (f: Readonly<Record<string, string>>): string | null =>
          Object.entries(f)
            .map(([k, v]) => `${k}:${v}`)
            .join(',') || null;
        const conditionsKey = (conditions: readonly unknown[]): string | null =>
          conditions.length === 0 ? null : JSON.stringify(conditions);
        // People answers the address: a new search or filter starts at the
        // first page, and a page is a history entry, so Back returns to the
        // one before (PEO-117).
        const query = (patch: Readonly<Record<string, string | null>>, mode?: HistoryMode) => {
          // A new query starts at the top, on its own first person: the row the
          // reader was on, and whose quick look was open, belong to the old one.
          navigate({ after: null, row: null, look: null, ...patch }, mode);
        };
        const view = leaf === 'cards' ? 'cards' : 'list';
        const data =
          load.status === 'ready' && typeof load.data === 'object' && load.data !== null
            ? (load.data as {
                can?: { import?: boolean; export?: boolean; bulkEdit?: boolean };
                next?: string | null;
              })
            : {};
        const can = data.can ?? {};
        const next = data.next ?? null;
        return {
          load: loadable,
          search: at('q') ?? '',
          onSearchChange: (text: string) => {
            query({ q: typed(text) }, 'replace');
          },
          filters,
          onFiltersChange: (next: Record<string, string>) => {
            query({ filter: joined(next) });
          },
          segmentId: at('segment'),
          onSegmentChange: (segment: string | null) => {
            query({ segment });
          },
          incomplete: at('incomplete') === 'true',
          onIncompleteChange: (incomplete: boolean) => {
            query({ incomplete: incomplete ? 'true' : null });
          },
          // A view across the top: its conditions alone, everything else cleared.
          onView: (view: {
            conditions: readonly { key: string; op: string; values: readonly string[] }[];
            incomplete: boolean;
            segmentId: string | null;
          }) => {
            query({
              conditions: conditionsKey(view.conditions),
              match: null,
              incomplete: view.incomplete ? 'true' : null,
              segment: view.segmentId,
              filter: null,
              ask: null,
            });
          },
          view,
          onViewChange: switchView,
          // Advanced conditions and the order, in the URL so a view is a link.
          onConditionsChange: (
            conditions: readonly { key: string; op: string; values: readonly string[] }[],
            match: 'all' | 'any',
          ) => {
            query({ conditions: conditionsKey(conditions), match: match === 'any' ? 'any' : null });
          },
          // A new order is a new list: "top 5" of the old one goes with it.
          onSortChange: (sort: { key: string; direction: 'asc' | 'desc' } | null) => {
            query({ sort: sort === null ? null : `${sort.key}:${sort.direction}`, top: null });
          },
          // Grouped, People orders by the same column, so a group is never split
          // across pages. The screen checks it is a column that groups.
          group: at('group'),
          onGroupChange: (key: string | null) => {
            query({ group: key, sort: key === null ? null : `${key}:asc`, top: null });
          },
          // Infinite scroll: the next page of the same query, appended in place.
          ...(next === null
            ? {}
            : {
                onLoadMore: (after: string) => actions.directoryPage(search, after),
                next,
              }),
          // A view saved from a search keeps its conditions too (smart search's "Save as view").
          onSaveSegment: (segment: { name: string; shared: boolean }) =>
            actions.saveSegment({
              ...segment,
              filter: filters,
              conditions: conditionsOf(at('conditions') ?? undefined) ?? [],
              match: at('match') === 'any' ? 'any' : 'all',
            }),
          onOpen: (personId: string) => {
            go(`/people/${personId}`);
          },
          ...(can.export === true
            ? {
                // The conditions in force go with it, as the builder's audience.
                onExport: () => {
                  const conditions = at('conditions');
                  go(
                    conditions === null
                      ? '/people/export'
                      : withQuery(
                          '/people/export',
                          {},
                          {
                            who: 'conditions',
                            conditions,
                            match: at('match'),
                          },
                        ),
                  );
                },
              }
            : {}),
          // Smart search (docs/ai-settings.md): what was typed, on Enter. The
          // one person a name or an email finds is opened; otherwise the plan
          // goes into the address, as a chip or the Filters sheet would put
          // it, with the question beside it (`?ask=`), and People answers it.
          asked: at('ask'),
          onAsk: async (sentence: string, remembered: Readonly<Record<string, string>>) => {
            const nothing = { note: null, unused: [], filters: 0, search: null };
            if (sentence === '') {
              query({
                ask: null,
                q: null,
                conditions: null,
                match: null,
                sort: null,
                top: null,
                group: null,
              });
              return { ok: true, by: 'search', ...nothing };
            }
            const planned = await actions.planDirectory(sentence, remembered);
            if (!planned.ok) return planned;
            const plan = planned.data as {
              search: string | null;
              conditions: readonly { key: string; op: string; values: readonly string[] }[];
              match: 'all' | 'any';
              sort: string | null;
              top: number | null;
              group: string | null;
              notes: readonly string[];
              unused: readonly string[];
              by: 'search' | 'assistant' | 'rules';
              note: string | null;
              person: { id: string; name: string } | null;
              ask: {
                topic: string | null;
                phrase: string;
                readings: readonly {
                  label: string;
                  conditions: readonly { key: string; op: string; values: readonly string[] }[];
                  match: 'all' | 'any';
                  count: number | null;
                }[];
              } | null;
              refused: readonly {
                text: string;
                why: string;
                instead: {
                  label: string;
                  subject: string;
                  condition: { key: string; op: string; values: readonly string[] };
                  count: number | null;
                } | null;
              }[];
              remembered: { topic: string; phrase: string; label: string } | null;
            };
            if (plan.person !== null) {
              go(`/people/${plan.person.id}`);
              return { ok: true, by: 'person', ...nothing };
            }
            const filters =
              plan.conditions.length + (plan.sort === null ? 0 : 1) + (plan.group === null ? 0 : 1);
            // A name People searched for. A question it could not read stays a
            // question, with what was not understood said: never a blank search.
            if (plan.by === 'search') {
              query({ q: plan.search ?? sentence, ask: null });
              return { ok: true, by: 'search', ...nothing };
            }
            query({
              ask: sentence,
              q: plan.search,
              conditions: conditionsKey(plan.conditions),
              match: plan.match === 'any' ? 'any' : null,
              // Grouped, People orders by the group; otherwise a question's
              // results stream in by name unless it asked for an order.
              sort:
                plan.group !== null
                  ? `${plan.group}:asc`
                  : (plan.sort ?? (plan.conditions.length > 0 ? 'name:asc' : null)),
              top: plan.top === null ? null : String(plan.top),
              filter: null,
              segment: null,
              incomplete: null,
              group: plan.group,
            });
            return {
              ok: true,
              by: plan.by,
              note: plan.note,
              notes: plan.notes,
              unused: plan.unused,
              filters,
              search: plan.search,
              ask: plan.ask,
              refused: plan.refused,
              remembered: plan.remembered,
            };
          },
          // "Remind all": everybody the conditions in force find, asked for what they find empty.
          onRemind: async (
            conditions: readonly { key: string; op: string; values: readonly string[] }[],
            match: 'all' | 'any',
          ) => {
            const done = await actions.remindDirectory(conditions, match, at('q'));
            return done.ok ? { ok: true, asked: done.asked, more: done.more } : done;
          },
          // Whose quick look is open, and which panel: in the address, so a
          // shared link opens the same card or dialog in the server's HTML.
          look: at('look'),
          onLookChange: (look: string | null) => {
            note({ look }, 'replace');
          },
          filtersOpen: at('filters') === 'open',
          onFiltersOpenChange: (open: boolean) => {
            note({ filters: open ? 'open' : null }, open ? 'push' : 'replace');
          },
          savingView: at('save') === 'view',
          onSavingViewChange: (open: boolean) => {
            note({ save: open ? 'view' : null }, open ? 'push' : 'replace');
          },
          // Add person (D9): the dialog over the directory; on success, the new record.
          ...(shell.roles.hr
            ? {
                today,
                adding: at('add') === 'person',
                onAddingChange: (open: boolean) => {
                  note({ add: open ? 'person' : null }, open ? 'push' : 'replace');
                },
                onAdd: async (person: Readonly<Record<string, string>>) => {
                  const added = await actions.addPerson(person);
                  if (added.ok) go(`/people/${added.personId}`);
                  return added;
                },
              }
            : {}),
          // Where the reader is: noted in the address, so Back returns to the same row.
          place: Number.parseInt(at('row') ?? '', 10) || null,
          onPlaceChange: (row: number | null) => {
            if (navigating.current) return;
            note({ row: row === null ? null : String(row) }, 'replace');
          },
          ...(can.import === true
            ? {
                onImport: () => {
                  go('/people/import');
                },
                running,
              }
            : {}),
          ...(can.bulkEdit === true
            ? {
                onBulkEdit: (ids: readonly string[]) => {
                  go(`/people/bulk-edit?people=${ids.join(',')}`);
                },
              }
            : {}),
          ...(next === null
            ? {}
            : {
                onNextPage: () => {
                  query({ after: next });
                },
              }),
          ...(at('after') === null
            ? {}
            : {
                onFirstPage: () => {
                  query({});
                },
              }),
        };
      }
      // Previewed and applied a page of people at a time (PEO-071).
      case 'BulkEdit':
        return {
          load: loadable,
          onPreview: actions.previewBulkEdit,
          onCommit: actions.commitBulkEdit,
          onPreviewHire: actions.previewBulkHire,
          onCommitHire: actions.commitBulkHire,
          searchPeople: actions.searchPeople,
          onBack: () => {
            go('/people/directory/list');
          },
          tab: oneOf(at('tab'), ['edit', 'hire'], null),
          onTabChange: (tab: string) => {
            note({ tab: tab === 'edit' ? null : tab }, 'push');
          },
        };
      case 'FieldRegistry':
        return {
          load: loadable,
          today,
          advise: actions.advise,
          onReorderSections: actions.reorderSections,
          onReorderFields: actions.reorderFields,
          onAddSection: actions.addSection,
          onSaveField: actions.saveField,
          preview: actions.previewPublish,
          onPublish: actions.publishDraft,
          onSignup: actions.setFieldSignup,
          onAssistant: actions.setFieldAssistant,
          search: at('q') ?? '',
          onSearchChange: (text: string) => {
            note({ q: typed(text) }, 'replace');
          },
          // Each checked by the screen, which knows the filters and the sections.
          show: at('show'),
          onShowChange: (show: string) => {
            note({ show: show === 'all' ? null : show }, 'push');
          },
          section: at('section'),
          onSectionChange: (section: string | null) => {
            note({ section }, 'push');
          },
          onReview: (key: string, to: string) => {
            go(
              `/settings/people/fields/${encodeURIComponent(key)}/change?to=${encodeURIComponent(to)}`,
            );
          },
          ...dialog,
        };
      // A field's new type, every value reviewed, then published with it.
      case 'FieldChange': {
        const key = params['key'] ?? '';
        return {
          load: loadable,
          onApply: async (decisions: readonly Readonly<Record<string, unknown>>[]) => {
            const done = await actions.applyFieldChange(key, at('to'), decisions);
            if (done.ok) go('/settings/people/fields');
            return done;
          },
          onBack: () => {
            go('/settings/people/fields');
          },
        };
      }
      case 'Integrations':
        return {
          load: loadable,
          onCreate: async (input: Parameters<typeof actions.createEndpoint>[0]) => {
            return actions.createEndpoint(input);
          },
          onUpdate: actions.updateEndpoint,
          onRotate: async (id: string) => {
            return actions.rotateEndpoint(id);
          },
          onOpenLog: (id: string) => {
            go(`/settings/people/integrations/webhooks/${id}`);
          },
          // Each tab is its own address: the overview is the page's, the others under it.
          tab: leaf === 'integrations' ? 'overview' : leaf,
          onTabChange: (tab: string) => {
            go(`/settings/people/integrations${tab === 'overview' ? '' : `/${tab}`}`);
          },
          ...dialog,
          scim: {
            onConnect: async (system: string) => {
              return actions.createScimConnection(system);
            },
            onRotateToken: async (id: string) => {
              return actions.rotateScimToken(id);
            },
            onDisconnect: actions.revokeScimConnection,
            onSetMapping: actions.setScimMapping,
          },
          chat: {
            onConnect: (app: string) => actions.connectChatApp(app, window.location.origin),
            onDisconnect: actions.disconnectChatApp,
            onNotice: actions.setChatNotice,
            fieldsHref: '/settings/people/fields',
            returned:
              search['connected'] !== undefined
                ? {
                    ok: true,
                    message: `${search['connected']} is connected. Choose below what it sends.`,
                  }
                : search['notConnected'] !== undefined
                  ? { ok: false, message: search['notConnected'] }
                  : null,
          },
        };
      case 'ReportSchedules':
        return {
          load: loadable,
          onCreate: actions.createReportSchedule,
          onUpdate: actions.updateReportSchedule,
          onPause: actions.pauseReportSchedule,
          onResume: actions.resumeReportSchedule,
          onDelete: actions.deleteReportSchedule,
          ...dialog,
        };
      case 'ReportRuns':
        return {
          load: loadable,
          // Older runs as the history scrolls.
          onLoadMore: (before: string) => actions.screenPage('ReportRuns', params, search, before),
        };
      case 'RoleSettings':
        return {
          load: loadable,
          onGrant: actions.grantRole,
          onRevoke: actions.revokeRole,
          search: at('q') ?? '',
          // People searches the table, so the server reads it again.
          onSearchChange: (text: string) => {
            navigate({ q: typed(text) }, 'replace');
          },
          onLoadMore: (after: string) => actions.screenPage('RoleSettings', params, search, after),
        };
      case 'PeopleHome':
        return {
          load: loadable,
          // What signing up still asks: their photo, and files kept to their fields.
          onPhoto: (file: File) => uploadPhoto(null, file),
          onSetupFile: async (
            field: { readonly key: string; readonly sectionKey: string },
            file: File,
          ) => {
            const up = await uploadFile(null, field.key, file);
            if (!up.ok) return up;
            const saved = await actions.saveOwnSection(field.sectionKey, {
              [field.key]: up.file.id,
            });
            if (!saved.ok) return { ok: false as const, message: saved.message };
            return up;
          },
        };
      case 'OrgChart':
        return {
          load: loadable,
          onOpen: (personId: string) => {
            go(`/people/${personId}`);
          },
          onViewChange: switchView,
          layout: oneOf(at('layout'), ['vertical', 'horizontal'], null),
          onLayoutChange: (layout: string) => {
            note({ layout: layout === 'vertical' ? null : layout }, 'push');
          },
          // The screen checks it is somebody on this viewer's chart.
          focusId: at('focus'),
          onFocusChange: (focus: string | null) => {
            note({ focus }, 'push');
          },
          // Whose side card is open, so a link opens it in the server's HTML.
          pickedId: at('person'),
          onPickedChange: (person: string | null) => {
            note({ person }, 'replace');
          },
        };
      case 'PeopleSettings':
        return { load: loadable };
      // One queue for every decision (design E1–E13). The tab is the route;
      // the chip, the item and the fill-in grid are the address, so the
      // server draws them already chosen. Picking a pair to compare, or a
      // page of missing details, is a navigation: People reads it.
      case 'Review': {
        const tab = oneOf(leaf, ['waiting', 'flagged', 'asked', 'decided'], 'waiting');
        return {
          load: loadable,
          tab,
          // HR's Decided loads as it scrolls; the address opens the newest.
          onMoreDecided: actions.decidedPage,
          onMoreMerges: actions.mergesPage,
          // Each decision queue past its first page, newest first, as the list scrolls.
          onMoreQueue: actions.queuePage,
          kind: at('kind'),
          onKindChange: (kind: string | null) => {
            // A new chip starts at the top of its list.
            if (at('item')?.startsWith('dup-') === true) navigate({ kind, item: null, fill: null });
            else note({ kind, item: null, fill: null }, 'push');
          },
          item: at('item'),
          onItemChange: (item: string | null) => {
            if (item?.startsWith('dup-') === true) navigate({ item });
            else note({ item }, 'push');
          },
          fill: at('fill'),
          onFillChange: (fill: string | null) => {
            note({ fill }, 'push');
          },
          onDecide: actions.decidePendingChange,
          onWithdraw: actions.withdrawPendingChange,
          onSelfApprove: actions.approveAlone,
          onOpen: (personId: string) => {
            go(`/people/${personId}`);
          },
          // Flagged approvals (design AI7, AI8).
          onMarkNotUnusual: actions.markNotUnusual,
          onAsk: actions.askAboutChange,
          onAnswer: actions.answerApprovalQuestion,
          onSetCheck: actions.setApprovalCheck,
          onReviewIdentifier: actions.reviewIdentifier,
          onReveal: actions.revealIdentifier,
          // Afterwards the survivor's record: the merge's answer, as People now holds it.
          onMerge: async (survivorId: string, absorbedId: string, take: readonly string[]) => {
            const merged = await actions.mergePerson(survivorId, absorbedId, take);
            if (merged.ok) go(`/people/${encodeURIComponent(survivorId)}`);
            return merged;
          },
          // Not the same: the pair leaves the queue, and the pane with it.
          onDismiss: async (a: string, b: string) => {
            const dismissed = await actions.dismissDuplicate([a, b]);
            if (dismissed.ok && at('item')?.startsWith('dup-') === true) navigate({ item: null });
            return dismissed;
          },
          // Afterwards the restored record, as People now holds it.
          onUnmerge: async (absorbedId: string, reason: string) => {
            const undone = await actions.unmergePerson(absorbedId, reason);
            if (undone.ok) go(`/people/${encodeURIComponent(absorbedId)}`);
            return undone;
          },
          onRequestFullValues: actions.requestFullValues,
          onDecideFullValues: actions.decideFullValues,
          onDecideShare: async (id: string, approve: boolean, note: string) => {
            const decided = await actions.decideExportShare(
              id,
              approve,
              note.trim() === '' ? null : note,
            );
            if (decided.ok) refresh();
            return decided.ok ? { ok: true } : decided;
          },
          // Saved, People is read again: the rows and every count are its, as they now stand.
          onSaveMissing: async (changes: Parameters<typeof actions.saveGrid>[0]) => {
            const saved = await actions.saveGrid(changes);
            if (saved.ok) refresh();
            return saved;
          },
          onCheckMissing: actions.checkGrid,
          searchPeople: actions.searchPeople,
          // Everybody due, through the weekly sweep; one person, through asking them.
          onRemindAll: actions.remindWaiting,
          onRemind: (personId: string, keys: readonly string[]) =>
            actions.requestDetails(personId, keys),
          // Missing details scroll on through everybody, by keyset (PEO-122).
          onLoadMoreMissing: actions.completenessPage,
        };
      }
      case 'WebhookLog':
        return {
          load: loadable,
          onReplay: actions.replayDelivery,
          onBack: () => {
            go('/settings/people/integrations/webhooks');
          },
          // Older deliveries as the log scrolls; the address opens the newest.
          onLoadMore: (after: string) => actions.screenPage('WebhookLog', params, search, after),
        };
      case 'Organisation':
        return {
          load: loadable,
          onUpdateSettings: actions.updateSettings,
          onCreateEntity: actions.createEntity,
          onUpdateEntity: actions.updateEntity,
          onCreateLocation: actions.createLocation,
          onUpdateLocation: actions.updateLocation,
          onChangeZone: actions.changeZone,
          onCreateOrgUnit: actions.createOrgUnit,
          onUpdateOrgUnit: actions.updateOrgUnit,
          onSetNumbering: actions.setNumbering,
          onSetPayBand: actions.setPayBand,
          // Each tab is its own address: legal entities are the page's, the others under it.
          tab: leaf === 'organisation' ? 'entities' : leaf,
          onTabChange: (tab: string) => {
            go(`/settings/people/organisation${tab === 'entities' ? '' : `/${tab}`}`);
          },
          ...dialog,
        };
      case 'ExportBuilder': {
        // Everything the page shows is in its address (design AI13): the
        // sentence, what it was read as, whom it goes to and how.
        const address = exportAddressOf(search);
        const data = load.status === 'ready' ? (load.data as ExportPageData) : null;
        const offered = data?.sections.flatMap((s) => s.fields.map((f) => f.key)) ?? [];
        const audience = data?.who.find((w) => w.value === (address.who ?? 'everyone'))?.label;
        // The directory's conditions, as the address carries them; People authorizes them.
        const narrowed = (who: string) =>
          who === 'conditions'
            ? {
                conditions: conditionsOf(search['conditions']) ?? [],
                match: search['match'] === 'any' ? ('any' as const) : ('all' as const),
                ...(audience === undefined ? {} : { filter: audience }),
              }
            : {};
        const shareChoice = (choice: ExportBuilderChoice): ShareChoice => ({
          ...shareChoiceOf(search, offered, audience),
          format: choice.format,
          fields: choice.fields,
          asOf: choice.asOf,
          ...(choice.reason === undefined ? {} : { reason: choice.reason }),
        });
        return {
          load: loadable,
          address,
          onAddress: (patch: Readonly<Record<string, string | null>>, mode?: HistoryMode) => {
            navigate(patch, mode ?? 'push');
          },
          onExport: async (choice: ExportBuilderChoice) => {
            const made = await actions.requestExport({ ...choice, ...narrowed(choice.who) });
            if (!made.ok) return made;
            // The finished export, with its files and its About; the choices stay in the address.
            navigate({ export: made.id, share: null });
            return { ok: true };
          },
          onShare: async (choice: ExportBuilderChoice, recipient: string) => {
            const sent = await actions.shareExport(shareChoice(choice), recipient);
            if (!sent.ok) return sent;
            const done = sent.data as
              { status: 'sent'; exportId: string } | { status: 'waiting'; requestId: string };
            navigate(
              done.status === 'sent'
                ? { export: done.exportId, share: null }
                : { share: done.requestId, export: null },
            );
            return { ok: true };
          },
          onDecide: async (id: string, approve: boolean, note: string) => {
            const decided = await actions.decideExportShare(
              id,
              approve,
              note.trim() === '' ? null : note,
            );
            if (decided.ok) refresh();
            return decided.ok ? { ok: true } : decided;
          },
          onSchedule: async (choice: ExportBuilderChoice, recipient: string) => {
            const picked = shareChoice(choice);
            const audienceOf = scheduleAudienceOf(picked);
            if (audienceOf === null) {
              return {
                ok: false,
                message:
                  'A schedule takes a saved view or simple filters. Save this group as a view in the Directory first.',
              };
            }
            return actions.createReportSchedule({
              name: (choice.reason ?? 'Monthly export').slice(0, 80),
              ...audienceOf,
              kind: 'export',
              format: choice.format === 'pdf' ? 'pdf' : 'xlsx',
              fields: [...choice.fields],
              reason: choice.reason ?? null,
              every: 'month',
              weekday: 1,
              day: 1,
              hour: 7,
              legalEntityId: null,
              recipients: [recipient],
            });
          },
          onDescribe: describeExport,
        };
      }
      case 'ImportFlow': {
        const held = importing.stages.at(-1) ?? { step: 'upload' };
        // An address without a step is the upload: browser Back from the
        // mapping returns there, and Forward finds the mapping still held.
        const stage = held.step === 'map' && at('step') === null ? { step: 'upload' } : held;
        // An approved import's own address: Importing, then what it did, or why it stopped.
        const watching = at('run') !== null;
        const again = { ok: false, message: 'Choose the file again' } as const;
        type Mapping = Readonly<Record<number, string | null>>;
        // Nothing published and not an administrator: the first import is one's.
        const ready =
          load.status === 'ready' ? (load.data as { setUp?: boolean; admin?: boolean }) : {};
        return {
          load: !watching
            ? { status: 'ready', data: stage }
            : followed.run !== null
              ? {
                  status: 'ready',
                  data: { step: 'run', run: followed.run, waking: followed.waking },
                }
              : (loadable ?? { status: 'loading' }),
          // Another import going: no file is taken until it is over.
          running: watching ? null : running,
          // The administrator imports it: approving its plan publishes version 1.
          ...(ready.setUp === false && ready.admin !== true ? { setup: { href: null } } : {}),
          // Only an administrator sets up work locations; HR reads the choices.
          admin: ready.admin === true,
          // The step after the mapping and the field in focus live in the address.
          step: at('step'),
          onStepChange: (step: string | null) => {
            note({ step, field: null }, 'push');
          },
          field: at('field'),
          onFieldChange: (field: string | null) => {
            note({ field }, 'replace');
          },
          onUpload: async (file: File, progress: (percent: number) => void): Promise<Outcome> => {
            const target = await actions.startImportUpload({ name: file.name, size: file.size });
            if (!target.ok) return target;
            if (!(await putFile(target, file, progress))) {
              return { ok: false, message: 'The upload did not go through; try again' };
            }
            const completed = await actions.completeImportUpload(target.uploadId);
            if (!completed.ok) return completed;
            setImporting((s) => ({
              uploadId: target.uploadId,
              mapping: {},
              stages: [...s.stages, completed.stage as Stage],
            }));
            note({ step: 'map', field: null }, 'push');
            return { ok: true };
          },
          onBack: () => {
            setImporting((s) => ({
              ...s,
              stages: s.stages.length > 1 ? s.stages.slice(0, -1) : s.stages,
            }));
            note({ step: null, field: null }, 'replace');
          },
          propose: async (mapping: Mapping) => {
            const id = importing.uploadId;
            return id === null ? again : actions.proposeImportFields(id, mapping);
          },
          plan: async (
            mapping: Mapping,
            proposals: readonly unknown[],
            places?: Readonly<Record<string, unknown>>,
          ) => {
            const id = importing.uploadId;
            return id === null ? again : actions.planImport(id, mapping, proposals, places);
          },
          run: async (
            mapping: Mapping,
            proposals: readonly unknown[],
            options: {
              readonly places?: Readonly<Record<string, unknown>>;
              readonly basedOn?: number | null;
            },
          ) => {
            const id = importing.uploadId;
            if (id === null) return again;
            const ran = await actions.runImport(
              id,
              mapping,
              proposals,
              // The administrator approving the plan is the approval: nothing waits.
              true,
              options.places,
              options.basedOn,
            );
            if (!ran.ok) return ran;
            const now = new Date().toISOString();
            const file = importing.stages.find((s) => s.step === 'map')?.['file'] as
              { readonly name?: string } | undefined;
            // The run is People's from here: this page only follows it, at its own address.
            setImporting({
              uploadId: null,
              mapping: {},
              stages: [{ step: 'upload' }],
              run: {
                id: ran.runId,
                status: 'queued',
                label: 'Importing',
                phase: 'setup',
                step: 'Setting up the fields',
                people: { done: 0, total: null },
                fileName: file?.name ?? null,
                startedBy: { name: '', you: true },
                approvedAt: now,
                startedAt: null,
                finishedAt: null,
                now,
                result: null,
                failure: null,
              },
            });
            // The run replaces the plan: Back never offers a run that has happened.
            note({ step: null, field: null, run: ran.runId }, 'replace');
            return { ok: true as const };
          },
          onDownloadBlocked: (url: string) => {
            // A signed link to the stored report: it downloads, and expires.
            window.location.assign(url);
          },
          onDone: () => {
            go('/people/import-export');
          },
        };
      }
      case 'Analytics':
        return {
          load: loadable,
          tab: leaf,
          segmentId: at('segment'),
          onSegmentChange: (segment: string | null) => {
            navigate({ segment });
          },
        };
      // What changed (design AI5, AI6, MA4, MA5): its own block.
      case 'WhatChanged': {
        const asked = (): actions.PeriodAsk => {
          const pick = (k: string) => at(k) ?? undefined;
          return Object.fromEntries(
            ['period', 'from', 'to', 'segment'].flatMap((k) => {
              const v = pick(k);
              return v === undefined ? [] : [[k, v]];
            }),
          );
        };
        const share = at('share');
        return {
          load: loadable,
          segmentId: at('segment'),
          onSegmentChange: (segment: string | null) => {
            navigate({ segment });
          },
          onPeriodChange: (p: { kind: string; from?: string; to?: string }) => {
            navigate({
              period: p.kind === 'month' ? null : p.kind,
              from: p.kind === 'custom' ? (p.from ?? null) : null,
              to: p.kind === 'custom' ? (p.to ?? null) : null,
              ask: null,
            });
          },
          question: at('ask'),
          onQuestionChange: (question: string | null) => {
            note({ ask: question }, 'push');
          },
          onAsk: (question: string) => actions.askWhatChanged(asked(), question),
          onWorded: () => actions.wordedWhatChanged(asked()),
          exporting:
            share === 'pdf' || share === 'email'
              ? {
                  format: share,
                  recipient: at('for'),
                  tone: at('tone') === 'detailed' ? 'detailed' : 'short',
                  charts: at('charts') !== 'off',
                  madeLine: at('made') !== 'off',
                }
              : null,
          onExportingChange: (
            next: {
              format: string;
              recipient: string | null;
              tone: string;
              charts: boolean;
              madeLine: boolean;
            } | null,
          ) => {
            note(
              next === null
                ? { share: null, for: null, tone: null, charts: null, made: null }
                : {
                    share: next.format,
                    for: next.recipient,
                    tone: next.tone === 'detailed' ? 'detailed' : null,
                    charts: next.charts ? null : 'off',
                    made: next.madeLine ? null : 'off',
                  },
              share === null || next === null ? 'push' : 'replace',
            );
          },
          onDraft: (input: Readonly<Record<string, unknown>>) =>
            actions.draftSummary({ ...asked(), ...input }),
          onSend: (input: Readonly<Record<string, unknown>>) =>
            actions.shareSummary({ ...asked(), ...input }),
          // The PDF, saved as the browser saves any download (`/people/downloads/summary`).
          onDownload: async (input: Readonly<Record<string, unknown>>) => {
            const form = new FormData();
            form.set('input', JSON.stringify({ ...asked(), ...input }));
            const response = await fetch('/people/downloads/summary', {
              method: 'POST',
              body: form,
            }).catch(() => null);
            if (response?.ok !== true) {
              const why = (await response?.text().catch(() => '')) ?? '';
              return { ok: false, message: why === '' ? 'The PDF could not be made' : why };
            }
            const url = URL.createObjectURL(await response.blob());
            const link = document.createElement('a');
            link.href = url;
            link.download = `what-changed-${today}.pdf`;
            link.click();
            URL.revokeObjectURL(url);
            return { ok: true };
          },
        };
      }
      case 'ImportExport':
        return {
          load: loadable,
          running,
          onDescribe: describeExport,
          kind: oneOf(at('kind'), ['import', 'export'], null),
          onKindChange: (kind: string) => {
            note({ kind: kind === 'all' ? null : kind }, 'push');
          },
          search: at('q') ?? '',
          onSearchChange: (text: string) => {
            note({ q: typed(text) }, 'replace');
          },
          // Older history as it scrolls; the address opens the newest.
          onLoadMore: actions.transferHistoryPage,
        };
      default:
        return {};
    }
  })();

  return (
    <RemoteScreen
      name="people"
      area="People"
      route={route}
      props={frame === undefined ? props : { ...props, frame }}
      // Served whole by the server and hydrated over: nothing stands in for it.
      fallback={null}
    />
  );
}
