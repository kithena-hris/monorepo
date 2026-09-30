'use client';

import { Skeleton } from '@reach/ui';
import type { Route } from 'next';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useState, useTransition, type JSX } from 'react';

import * as actions from '../app/(app)/people/actions';
import type { ScreenLoad } from '../lib/people-screens';
import { DIRECTORY_VIEWS, viewHref } from '../lib/shortcuts';
import {
  conditionsOf,
  filtersOf,
  noteInAddress,
  oneOf,
  withQuery,
  type HistoryMode,
} from '../lib/url-state';
import { RemoteScreen, type RemoteRoute } from './remote-screen';

/**
 * A People screen's props, from what the server fetched and the actions that
 * call People (PEO-098).
 *
 * The one place the shell knows each screen's prop names. It adds nothing to
 * the data: the `Loadable` is the server's answer as it arrived, and every
 * callback is a server action or a navigation. After a write that changes
 * what the page shows, `router.refresh()` asks the server for the page again,
 * so the next render is People's answer and never the browser's guess.
 */

type Outcome = { readonly ok: true } | { readonly ok: false; readonly message: string };

export interface PeopleScreenProps {
  readonly route: RemoteRoute | null;
  readonly load: ScreenLoad;
  readonly params: Readonly<Record<string, string>>;
  readonly search: Readonly<Record<string, string>>;
  readonly today: string;
  /**
   * The breadcrumb's section, its siblings and the umbrella page's tabs, and
   * the actions, for the screen's own header (`headerFrame`): the remote's
   * `Frame`, as JSON.
   */
  readonly frame?: {
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
    readonly actions?: readonly {
      readonly href: string;
      readonly label: string;
      readonly icon?: string;
    }[];
  };
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

/**
 * A small export is ready now: open its file. A queued one is announced when
 * it is ready, as the screen says.
 */
function download(
  made: { ok: true; links: readonly { url: string }[] } | { ok: false; message: string },
): Outcome {
  if (!made.ok) return made;
  const first = made.links[0];
  if (first !== undefined) window.location.assign(first.url);
  return { ok: true };
}

/** The import, which setup returns to when it was what sent the admin there. */
const IMPORT = '/people/import';

export function PeopleScreen({
  route,
  load,
  params,
  search,
  today,
  frame,
}: PeopleScreenProps): JSX.Element {
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
  const leaf = usePathname().split('/').at(-1) ?? '';
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
  const navigate = (patch: Readonly<Record<string, string | null>>, mode: HistoryMode = 'push') => {
    const to = withQuery(window.location.pathname, window.location.search, patch) as Route;
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
    if (known !== null) go(viewHref(known, window.location.search));
  };

  /** A write, then the page again from the server when it went through. */
  const thenRefresh =
    <A extends unknown[], R extends Outcome>(act: (...args: A) => Promise<R>) =>
    async (...args: A): Promise<R> => {
      const result = await act(...args);
      if (result.ok) refresh();
      return result;
    };

  // The import's steps: which upload People holds the file under (§14.2),
  // the mapping chosen, and the stages so far, for Back.
  const [importing, setImporting] = useState<{
    uploadId: string | null;
    mapping: Readonly<Record<number, string | null>>;
    stages: Stage[];
  }>({ uploadId: null, mapping: {}, stages: [{ step: 'upload' }] });

  const loadable =
    load.status === 'ready'
      ? { status: 'ready' as const, data: load.data }
      : load.status === 'error'
        ? { status: 'error' as const, message: load.message, retry: refresh }
        : null;

  const component = route?.component ?? '';
  const props = ((): Record<string, unknown> => {
    switch (component) {
      case 'PeopleSetup':
        return {
          load: loadable,
          onConfirmEntity: actions.confirmEntity,
          onPublish: thenRefresh(actions.publishSetup),
          onSaveProfile: thenRefresh(actions.saveOwnSection),
          // The first administrator is the only HR member: they approve their own NIF (PEO-077).
          onSelfApprove: thenRefresh(actions.approveAlone),
          onWithdraw: thenRefresh(actions.withdrawPendingChange),
          // Sent here from an import with nothing published: the import goes on after.
          ...(search['then'] === IMPORT
            ? {
                continuing: {
                  label: 'Continue to the import',
                  note: 'Your import carries on once version 1 is published. Columns in your file that match none of these fields become new fields for you to review there.',
                },
              }
            : {}),
          onFinish: () => {
            go(search['then'] === IMPORT ? IMPORT : '/people/me');
          },
        };
      // One person by hand; then their record, to fill in the rest.
      case 'AddPerson':
        return {
          today,
          onAdd: async (person: Readonly<Record<string, string>>) => {
            const added = await actions.addPerson(person);
            if (added.ok) go(`/people/${added.personId}`);
            return added;
          },
          onCancel: () => {
            go('/people/directory/list');
          },
          onImport: () => {
            go('/people/import');
          },
        };
      case 'Onboarding':
        return {
          load: loadable,
          onUploadFile: (key: string, file: File) => uploadFile(null, key, file),
          onSave: thenRefresh(actions.saveOwnSection),
          onCheck: (sectionKey: string, changed: Readonly<Record<string, unknown>>) =>
            actions.checkIdentifiers(null, sectionKey, changed),
        };
      case 'Profile': {
        const id = params['id'];
        return {
          load: loadable,
          // A link from the overview to one missing detail.
          ...(search['field'] === undefined ? {} : { focusField: search['field'] }),
          // The part of the record on screen; the screen checks it is one this record has.
          tab: at('tab'),
          onTabChange: (tab: string) => {
            note({ tab: tab === 'overview' ? null : tab }, 'push');
          },
          // Offered to everybody; the screen shows it only where People says they may.
          onPhoto: thenRefresh((file: File) => uploadPhoto(id ?? null, file)),
          // A file for an image or document field; the form's Save keeps it.
          onUploadFile: (key: string, file: File) => uploadFile(id ?? null, key, file),
          onCheck: (sectionKey: string, changed: Readonly<Record<string, unknown>>) =>
            actions.checkIdentifiers(id ?? null, sectionKey, changed),
          onSave: thenRefresh(
            id === undefined
              ? actions.saveOwnSection
              : (sectionKey: string, changed: Readonly<Record<string, unknown>>) =>
                  actions.savePersonSection(id, sectionKey, changed),
          ),
          // Only another person's record: nobody moves their own employment.
          ...(id === undefined
            ? {}
            : {
                onMove: thenRefresh((move: actions.LifecycleMove) =>
                  actions.moveLifecycle(id, move),
                ),
                onPlace: thenRefresh((placement: Parameters<typeof actions.placePerson>[1]) =>
                  actions.placePerson(id, placement),
                ),
                // One value from a date (W11): People's effective-dated write for one person.
                onChangeDated: thenRefresh(
                  async (change: {
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
                ),
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
                onRequest: thenRefresh((keys: readonly string[]) =>
                  actions.requestDetails(id, keys),
                ),
              }),
          searchPeople: actions.searchPeople,
          onHistory: () => {
            go(id === undefined ? '/people/me/history' : `/people/${id}/history`);
          },
          onWithdraw: thenRefresh(actions.withdrawPendingChange),
          onSelfApprove: thenRefresh(actions.approveAlone),
          onApprovals: () => {
            go('/people/approvals');
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
          navigate({ after: null, ...patch }, mode);
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
          onSortChange: (sort: { key: string; direction: 'asc' | 'desc' } | null) => {
            query({ sort: sort === null ? null : `${sort.key}:${sort.direction}` });
          },
          // Grouped, People orders by the same column, so a group is never split
          // across pages. The screen checks it is a column that groups.
          group: at('group'),
          onGroupChange: (key: string | null) => {
            query({ group: key, sort: key === null ? null : `${key}:asc` });
          },
          // Infinite scroll: the next page of the same query, appended in place.
          ...(next === null
            ? {}
            : {
                onLoadMore: (after: string) => actions.directoryPage(search, after),
                next,
              }),
          onSaveSegment: thenRefresh((segment: { name: string; shared: boolean }) =>
            actions.saveSegment({ ...segment, filter: filters }),
          ),
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
          // What was typed, on Enter, read as the directory's own filters and
          // order (docs/ai-settings.md): the plan goes into the address, as a
          // chip or the Filters sheet would put it, and People answers it.
          onAsk: async (sentence: string) => {
            const planned = await actions.planDirectory(sentence);
            if (!planned.ok) return planned;
            const plan = planned.data as {
              search: string | null;
              conditions: readonly { key: string; op: string; values: readonly string[] }[];
              match: 'all' | 'any';
              sort: string | null;
              unused: readonly string[];
              by: 'search' | 'assistant' | 'rules';
              note: string | null;
            };
            const filters = plan.conditions.length + (plan.sort === null ? 0 : 1);
            query(
              plan.by === 'search' || filters === 0
                ? { q: plan.search ?? sentence }
                : {
                    q: plan.search,
                    conditions: conditionsKey(plan.conditions),
                    match: plan.match === 'any' ? 'any' : null,
                    sort: plan.sort,
                    filter: null,
                    segment: null,
                    incomplete: null,
                    group: null,
                  },
            );
            return {
              ok: true,
              by: plan.by,
              note: plan.note,
              unused: plan.unused,
              filters,
              search: plan.search,
            };
          },
          ...(can.import === true
            ? {
                onImport: () => {
                  go('/people/import');
                },
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
      case 'CompletenessGrid': {
        // Keyset pages, each a URL, as the directory's are (PEO-117, PEO-122).
        const next =
          load.status === 'ready' && typeof load.data === 'object' && load.data !== null
            ? ((load.data as { next?: string | null }).next ?? null)
            : null;
        return {
          load: loadable,
          onSave: thenRefresh(actions.saveGrid),
          onCheck: actions.checkGrid,
          searchPeople: actions.searchPeople,
          // Everybody due, through the weekly sweep; one person, through asking them.
          onRemindAll: thenRefresh(actions.remindWaiting),
          onRemind: thenRefresh((personId: string, keys: readonly string[]) =>
            actions.requestDetails(personId, keys),
          ),
          ...(next === null
            ? {}
            : {
                onNextPage: () => {
                  router.push(
                    `/people/data-health/completeness?after=${encodeURIComponent(next)}` as Route,
                  );
                },
              }),
          ...(search['after'] === undefined
            ? {}
            : {
                onFirstPage: () => {
                  router.push('/people/data-health/completeness');
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
          onReorderSections: thenRefresh(actions.reorderSections),
          onReorderFields: thenRefresh(actions.reorderFields),
          onAddSection: thenRefresh(actions.addSection),
          onSaveField: thenRefresh(actions.saveField),
          preview: actions.previewPublish,
          onPublish: thenRefresh(actions.publishDraft),
          onSignup: thenRefresh(actions.setFieldSignup),
          onAssistant: thenRefresh(actions.setFieldAssistant),
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
        };
      case 'Integrations':
        return {
          load: loadable,
          onCreate: async (input: Parameters<typeof actions.createEndpoint>[0]) => {
            const made = await actions.createEndpoint(input);
            if (made.ok) refresh();
            return made;
          },
          onUpdate: thenRefresh(actions.updateEndpoint),
          onRotate: async (id: string) => {
            const rotated = await actions.rotateEndpoint(id);
            if (rotated.ok) refresh();
            return rotated;
          },
          onOpenLog: (id: string) => {
            go(`/settings/people/integrations/${id}`);
          },
          tab: at('tab'),
          onTabChange: (tab: string) => {
            note({ tab: tab === 'overview' ? null : tab }, 'push');
          },
          scim: {
            onConnect: async (system: string) => {
              const made = await actions.createScimConnection(system);
              if (made.ok) refresh();
              return made;
            },
            onRotateToken: async (id: string) => {
              const rotated = await actions.rotateScimToken(id);
              if (rotated.ok) refresh();
              return rotated;
            },
            onDisconnect: thenRefresh(actions.revokeScimConnection),
            onSetMapping: thenRefresh(actions.setScimMapping),
          },
          chat: {
            onConnect: (app: string) => actions.connectChatApp(app, window.location.origin),
            onDisconnect: thenRefresh(actions.disconnectChatApp),
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
          onCreate: thenRefresh(actions.createReportSchedule),
          onUpdate: thenRefresh(actions.updateReportSchedule),
          onPause: thenRefresh(actions.pauseReportSchedule),
          onResume: thenRefresh(actions.resumeReportSchedule),
          onDelete: thenRefresh(actions.deleteReportSchedule),
        };
      case 'ReportRuns':
        return { load: loadable };
      case 'ReminderSettings':
        return {
          load: loadable,
          onCohortMinimum: thenRefresh((cohortMinimum: number) =>
            actions.updateSettings({ cohortMinimum }),
          ),
        };
      case 'CountryPacks':
        return { load: loadable };
      case 'RoleSettings':
        return {
          load: loadable,
          onGrant: thenRefresh(actions.grantRole),
          onRevoke: thenRefresh(actions.revokeRole),
          search: at('q') ?? '',
          onSearchChange: (text: string) => {
            note({ q: typed(text) }, 'replace');
          },
        };
      case 'PeopleHome':
        return {
          load: loadable,
          // What signing up still asks: their photo, and files kept to their fields.
          onPhoto: thenRefresh((file: File) => uploadPhoto(null, file)),
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
            refresh();
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
        };
      case 'PeopleSettings':
        return { load: loadable };
      case 'FullValues':
        return {
          load: loadable,
          onRequest: thenRefresh(actions.requestFullValues),
          onDecide: thenRefresh(actions.decideFullValues),
        };
      case 'IdentifierReviews':
        return {
          load: loadable,
          onDecide: thenRefresh(actions.reviewIdentifier),
          onReveal: actions.revealIdentifier,
        };
      case 'Approvals':
        return {
          load: loadable,
          onDecide: thenRefresh(actions.decidePendingChange),
          onWithdraw: thenRefresh(actions.withdrawPendingChange),
          onSelfApprove: thenRefresh(actions.approveAlone),
          onOpen: (personId: string) => {
            go(`/people/${personId}`);
          },
          tab: oneOf(at('tab'), ['mine', 'asked'], null),
          onTabChange: (tab: string) => {
            note({ tab }, 'push');
          },
        };
      case 'Duplicates': {
        const list = '/people/data-health/duplicates';
        return {
          load: loadable,
          onCompare: (a: string, b: string) => {
            go(`${list}?a=${encodeURIComponent(a)}&b=${encodeURIComponent(b)}`);
          },
          onBack: () => {
            go(list);
          },
          // Afterwards the survivor's record: the merge's answer, as People now holds it.
          onMerge: async (survivorId: string, absorbedId: string, take: readonly string[]) => {
            const merged = await actions.mergePerson(survivorId, absorbedId, take);
            if (merged.ok) go(`/people/${encodeURIComponent(survivorId)}`);
            return merged;
          },
          // From the list, the list again; from a comparison, back to the list.
          onDismiss: async (a: string, b: string) => {
            const dismissed = await actions.dismissDuplicate([a, b]);
            if (dismissed.ok) {
              if (search['a'] === undefined) refresh();
              else go(list);
            }
            return dismissed;
          },
          // Afterwards the restored record, as People now holds it.
          onUnmerge: async (absorbedId: string, reason: string) => {
            const undone = await actions.unmergePerson(absorbedId, reason);
            if (undone.ok) go(`/people/${encodeURIComponent(absorbedId)}`);
            return undone;
          },
        };
      }
      case 'WebhookLog': {
        const next =
          load.status === 'ready' && typeof load.data === 'object' && load.data !== null
            ? ((load.data as { next?: string | null }).next ?? null)
            : null;
        const here = `/settings/people/integrations/${params['id'] ?? ''}`;
        return {
          load: loadable,
          onReplay: thenRefresh(actions.replayDelivery),
          onBack: () => {
            go('/settings/people/integrations');
          },
          ...(next === null
            ? {}
            : {
                onOlder: () => {
                  go(`${here}?after=${encodeURIComponent(next)}`);
                },
              }),
          ...(search['after'] === undefined
            ? {}
            : {
                onNewest: () => {
                  go(here);
                },
              }),
        };
      }
      case 'Organisation':
        return {
          load: loadable,
          onUpdateSettings: thenRefresh(actions.updateSettings),
          onCreateEntity: thenRefresh(actions.createEntity),
          onUpdateEntity: thenRefresh(actions.updateEntity),
          onCreateLocation: thenRefresh(actions.createLocation),
          onUpdateLocation: thenRefresh(actions.updateLocation),
          onChangeZone: thenRefresh(actions.changeZone),
          onSetNumbering: thenRefresh(actions.setNumbering),
          onSetPayBand: thenRefresh(actions.setPayBand),
          tab: at('tab'),
          onTabChange: (tab: string) => {
            note({ tab: tab === 'entities' ? null : tab }, 'push');
          },
        };
      case 'ExportBuilder': {
        // Where the builder starts, from the address: an export described in
        // words, or the directory's Export button with its conditions.
        const format = oneOf(search['format'], ['xlsx', 'csv', 'pdf'], null);
        const asOf = search['asOf'];
        const exportAudience =
          load.status === 'ready'
            ? (load.data as { who?: readonly { value: string; label: string }[] }).who?.find(
                (w) => w.value === 'conditions',
              )?.label
            : undefined;
        const initial = {
          ...(search['who'] === undefined ? {} : { who: search['who'] }),
          ...(search['fields'] === undefined
            ? {}
            : { fields: search['fields'].split(',').filter((k) => k !== '') }),
          ...(asOf !== undefined && /^\d{4}-\d{2}-\d{2}$/.test(asOf) ? { asOf } : {}),
          ...(format === null ? {} : { format }),
          ...(search['photos'] === 'true' ? { photos: true } : {}),
          ...(search['reason'] === undefined ? {} : { reason: search['reason'].slice(0, 500) }),
        };
        return {
          load: loadable,
          initial,
          onExport: async (choice: Parameters<typeof actions.requestExport>[0]) =>
            download(
              await actions.requestExport({
                ...choice,
                // The directory's conditions, as the address carries them; People authorizes them.
                ...(choice.who === 'conditions'
                  ? {
                      conditions: conditionsOf(search['conditions']) ?? [],
                      match: search['match'] === 'any' ? ('any' as const) : ('all' as const),
                      // Named on the file's provenance sheet as the builder names it.
                      ...(exportAudience === undefined ? {} : { filter: exportAudience }),
                    }
                  : {}),
              }),
            ),
          // Described in words (docs/ai-settings.md): the choices go into the
          // address, and the builder starts again from them for a person to check.
          onDescribe: async (sentence: string) => {
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
            return { ok: true, by: plan.by, note: plan.note, notes: plan.notes };
          },
        };
      }
      case 'ImportFlow': {
        const stage = importing.stages.at(-1) ?? { step: 'upload' };
        const next = (
          result: actions.Staged,
          uploadId: string,
          mapping: Readonly<Record<number, string | null>>,
        ): Outcome => {
          if (!result.ok) return result;
          setImporting((s) => ({
            uploadId,
            mapping,
            stages: [...s.stages, result.stage as Stage],
          }));
          return { ok: true };
        };
        const again = { ok: false, message: 'Choose the file again' } as const;
        // Nothing published: setup comes first, for an administrator to run.
        const ready =
          load.status === 'ready' ? (load.data as { setUp?: boolean; admin?: boolean }) : {};
        return {
          load: { status: 'ready', data: stage },
          ...(ready.setUp === false
            ? { setup: { href: ready.admin === true ? `/people/setup?then=${IMPORT}` : null } }
            : {}),
          onUpload: async (file: File, progress: (percent: number) => void): Promise<Outcome> => {
            const target = await actions.startImportUpload({ name: file.name, size: file.size });
            if (!target.ok) return target;
            if (!(await putFile(target, file, progress))) {
              return { ok: false, message: 'The upload did not go through; try again' };
            }
            return next(await actions.completeImportUpload(target.uploadId), target.uploadId, {});
          },
          onMap: async (mapping: Readonly<Record<number, string | null>>) => {
            const id = importing.uploadId;
            return id === null ? again : next(await actions.dryRunImport(id, mapping), id, mapping);
          },
          onCommit: async (options?: { readonly applyWithoutApproval?: boolean }) => {
            const id = importing.uploadId;
            return id === null
              ? again
              : next(
                  await actions.commitImport(
                    id,
                    importing.mapping,
                    options?.applyWithoutApproval === true,
                  ),
                  id,
                  importing.mapping,
                );
          },
          onDownloadBlocked: () => {
            // A signed link to the stored report: it downloads, and expires.
            const url = stage.blockedUrl;
            if (typeof url === 'string') window.location.assign(url);
          },
          onBack: () => {
            setImporting((s) => ({
              ...s,
              stages: s.stages.length > 1 ? s.stages.slice(0, -1) : s.stages,
            }));
          },
          // New information in the file: proposed, reviewed, added (docs/ai-settings.md).
          newFields: {
            propose: async (mapping: Readonly<Record<number, string | null>>) => {
              const id = importing.uploadId;
              return id === null ? again : actions.proposeImportFields(id, mapping);
            },
            review: async (mapping: Readonly<Record<number, string | null>>, proposals: readonly unknown[]) => {
              const id = importing.uploadId;
              return id === null ? again : actions.reviewImportFields(id, mapping, proposals);
            },
            apply: async (
              mapping: Readonly<Record<number, string | null>>,
              proposals: readonly unknown[],
              summary: string,
            ) => {
              const id = importing.uploadId;
              return id === null ? again : actions.addImportFields(id, mapping, proposals, summary);
            },
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
          // "What changed", in the assistant's words where People says it may.
          onWhatChanged: (tab: string) => actions.whatChanged(tab, at('segment')),
          // The Schedules button: the schedules page's own actions.
          schedules: {
            onCreate: thenRefresh(actions.createReportSchedule),
            onUpdate: thenRefresh(actions.updateReportSchedule),
            onPause: thenRefresh(actions.pauseReportSchedule),
            onResume: thenRefresh(actions.resumeReportSchedule),
            onDelete: thenRefresh(actions.deleteReportSchedule),
          },
        };
      case 'ImportExport':
        return {
          load: loadable,
          kind: oneOf(at('kind'), ['import', 'export'], null),
          onKindChange: (kind: string) => {
            note({ kind: kind === 'all' ? null : kind }, 'push');
          },
          search: at('q') ?? '',
          onSearchChange: (text: string) => {
            note({ q: typed(text) }, 'replace');
          },
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
      // Drawn in the browser, the screen is its header's shape until it is: the
      // trail and the tabs the frame will give it.
      fallback={
        <Skeleton
          shape="page"
          label="Loading People"
          breadcrumb={frame?.section != null}
          tabs={frame?.tabs?.length ?? 0}
        />
      }
    />
  );
}
