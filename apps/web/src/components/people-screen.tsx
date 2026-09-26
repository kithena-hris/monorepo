'use client';

import type { Route } from 'next';
import { useRouter } from 'next/navigation';
import { useState, useTransition, type JSX } from 'react';

import * as actions from '../app/people/actions';
import type { ScreenLoad } from '../lib/people-screens';
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
  file: File,
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

type Stage = Record<string, unknown> & { step: string; blockedUrl?: string | null };

export function PeopleScreen({
  route,
  load,
  params,
  search,
  today,
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
          onFinish: () => {
            go('/people/me');
          },
        };
      case 'Onboarding':
        return {
          load: loadable,
          onSave: thenRefresh(actions.saveOwnSection),
          onCheck: (sectionKey: string, changed: Readonly<Record<string, unknown>>) =>
            actions.checkIdentifiers(null, sectionKey, changed),
        };
      case 'Profile': {
        const id = params['id'];
        return {
          load: loadable,
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
                onPlace: thenRefresh(
                  (placement: Parameters<typeof actions.placePerson>[1]) =>
                    actions.placePerson(id, placement),
                ),
              }),
          searchPeople: actions.searchPeople,
          onHistory: () => {
            go(id === undefined ? '/people/me/history' : `/people/${id}/history`);
          },
        };
      }
      // A date is a URL, so Back returns to the one before (PEO-064).
      case 'PersonHistory': {
        const id = params['id'];
        const here = id === undefined ? '/people/me/history' : `/people/${id}/history`;
        return {
          load: loadable,
          onAsOf: (asOf: string | null) => {
            go(asOf === null ? here : `${here}?asOf=${encodeURIComponent(asOf)}`);
          },
          onBack: () => {
            go(id === undefined ? '/people/me' : `/people/${id}`);
          },
        };
      }
      case 'Directory': {
        const filters: Record<string, string> = {};
        for (const pair of (search['filter'] ?? '').split(',')) {
          const at = pair.indexOf(':');
          if (at > 0) filters[pair.slice(0, at)] = pair.slice(at + 1);
        }
        // A new search or filter starts at the first page; a page is a
        // history entry, so Back returns to the one before (PEO-117).
        const query = (next: {
          search?: string;
          filters?: Record<string, string>;
          after?: string;
        }) => {
          const q = new URLSearchParams();
          const text = next.search ?? search['search'] ?? '';
          const f = next.filters ?? filters;
          if (text !== '') q.set('search', text);
          const joined = Object.entries(f)
            .map(([k, v]) => `${k}:${v}`)
            .join(',');
          if (joined !== '') q.set('filter', joined);
          if (next.after !== undefined) q.set('after', next.after);
          const qs = q.toString();
          const to = `/people/directory${qs === '' ? '' : `?${qs}`}` as Route;
          if (next.after === undefined) router.replace(to);
          else router.push(to);
        };
        const data =
          load.status === 'ready' && typeof load.data === 'object' && load.data !== null
            ? (load.data as {
                can?: { import?: boolean; export?: boolean };
                next?: string | null;
              })
            : {};
        const can = data.can ?? {};
        const next = data.next ?? null;
        return {
          load: loadable,
          search: search['search'] ?? '',
          onSearchChange: (text: string) => {
            query({ search: text });
          },
          filters,
          onFiltersChange: (next: Record<string, string>) => {
            query({ filters: next });
          },
          onOpen: (personId: string) => {
            go(`/people/${personId}`);
          },
          ...(can.export === true
            ? {
                onExport: () => {
                  go('/people/export');
                },
              }
            : {}),
          ...(can.import === true
            ? {
                onImport: () => {
                  go('/people/import');
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
          ...(search['after'] === undefined
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
          ...(next === null
            ? {}
            : {
                onNextPage: () => {
                  router.push(`/people/completeness?after=${encodeURIComponent(next)}` as Route);
                },
              }),
          ...(search['after'] === undefined
            ? {}
            : {
                onFirstPage: () => {
                  router.push('/people/completeness');
                },
              }),
        };
      }
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
            go(`/people/settings/integrations/${id}`);
          },
        };
      case 'RoleSettings':
        return {
          load: loadable,
          onGrant: thenRefresh(actions.grantRole),
          onRevoke: thenRefresh(actions.revokeRole),
        };
      case 'PeopleHome':
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
      case 'WebhookLog': {
        const next =
          load.status === 'ready' && typeof load.data === 'object' && load.data !== null
            ? ((load.data as { next?: string | null }).next ?? null)
            : null;
        const here = `/people/settings/integrations/${params['id'] ?? ''}`;
        return {
          load: loadable,
          onReplay: thenRefresh(actions.replayDelivery),
          onBack: () => {
            go('/people/settings/integrations');
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
        };
      case 'ExportBuilder':
        return {
          load: loadable,
          onExport: async (choice: Parameters<typeof actions.requestExport>[0]) => {
            const made = await actions.requestExport(choice);
            if (!made.ok) return made;
            // A small export is ready now: open its file. A queued one is
            // announced when it is ready, as the screen says.
            const first = made.links[0];
            if (first !== undefined) window.location.assign(first.url);
            return { ok: true };
          },
        };
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
        return {
          load: { status: 'ready', data: stage },
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
          onCommit: async () => {
            const id = importing.uploadId;
            return id === null
              ? again
              : next(await actions.commitImport(id, importing.mapping), id, importing.mapping);
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
        };
      }
      case 'Analytics':
        return { load: loadable };
      default:
        return {};
    }
  })();

  return <RemoteScreen name="people" area="People" route={route} props={props} />;
}
