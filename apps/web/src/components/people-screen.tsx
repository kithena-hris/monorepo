'use client';

import type { Route } from 'next';
import { useRouter } from 'next/navigation';
import { useMemo, useState, useTransition, type JSX } from 'react';

import * as actions from '../app/people/actions';
import type { ScreenLoad } from '../lib/people-screens';
import { RemoteScreen } from './remote-screen';

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
  readonly route: { readonly entry: string; readonly component: string } | null;
  readonly load: ScreenLoad;
  readonly params: Readonly<Record<string, string>>;
  readonly search: Readonly<Record<string, string>>;
  readonly today: string;
}

/** Save a file the browser holds, without a round trip. */
function download(name: string, base64: string, type = 'text/csv'): void {
  const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
  const url = URL.createObjectURL(new Blob([bytes], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}

type Stage = Record<string, unknown> & { step: string; blockedCsv?: string };

export function PeopleScreen({ route, load, params, search, today }: PeopleScreenProps): JSX.Element {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const refresh = (): void => {
    startTransition(() => {
      router.refresh();
    });
  };
  const go = (to: string): void => {
    router.push(to as Route);
  };

  /** A write, then the page again from the server when it went through. */
  const thenRefresh =
    <A extends unknown[]>(act: (...args: A) => Promise<Outcome>) =>
    async (...args: A): Promise<Outcome> => {
      const result = await act(...args);
      if (result.ok) refresh();
      return result;
    };

  // The import is the one screen whose state lives between requests, and it
  // lives here: People keeps nothing between upload, mapping and commit.
  const [importing, setImporting] = useState<{
    file: File | null;
    mapping: Readonly<Record<number, string | null>>;
    stages: Stage[];
  }>({ file: null, mapping: {}, stages: [{ step: 'upload' }] });

  const loadable = useMemo(() => {
    if (load.status === 'ready') return { status: 'ready' as const, data: load.data };
    if (load.status === 'error') return { status: 'error' as const, message: load.message, retry: refresh };
    return null;
    // `refresh` is stable in behaviour; the load is what matters.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [load]);

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
        return { load: loadable, onSave: thenRefresh(actions.saveOwnSection) };
      case 'Profile': {
        const id = params['id'];
        return {
          load: loadable,
          onSave: thenRefresh(
            id === undefined
              ? actions.saveOwnSection
              : (sectionKey: string, changed: Readonly<Record<string, unknown>>) =>
                  actions.savePersonSection(id, sectionKey, changed),
          ),
        };
      }
      case 'Directory': {
        const filters: Record<string, string> = {};
        for (const pair of (search['filter'] ?? '').split(',')) {
          const at = pair.indexOf(':');
          if (at > 0) filters[pair.slice(0, at)] = pair.slice(at + 1);
        }
        const query = (next: { search?: string; filters?: Record<string, string> }) => {
          const q = new URLSearchParams();
          const text = next.search ?? search['search'] ?? '';
          const f = next.filters ?? filters;
          if (text !== '') q.set('search', text);
          const joined = Object.entries(f)
            .map(([k, v]) => `${k}:${v}`)
            .join(',');
          if (joined !== '') q.set('filter', joined);
          const qs = q.toString();
          router.replace(`/people/directory${qs === '' ? '' : `?${qs}`}` as Route);
        };
        const can =
          load.status === 'ready' && typeof load.data === 'object' && load.data !== null
            ? ((load.data as { can?: { import?: boolean; export?: boolean } }).can ?? {})
            : {};
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
          ...(can.export === true ? { onExport: () => { go('/people/export'); } } : {}),
          ...(can.import === true ? { onImport: () => { go('/people/import'); } } : {}),
        };
      }
      case 'CompletenessGrid':
        return { load: loadable, onSave: thenRefresh(actions.saveGrid) };
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
        const step = async (
          act: typeof actions.proposeImport,
          file: File,
          mapping: Readonly<Record<number, string | null>>,
        ): Promise<Outcome> => {
          const form = new FormData();
          form.set('file', file);
          form.set('mapping', JSON.stringify(mapping));
          const result = await act(form);
          if (!result.ok) return result;
          setImporting((s) => ({
            file,
            mapping,
            stages: [...s.stages, result.stage as Stage],
          }));
          return { ok: true };
        };
        return {
          load: { status: 'ready', data: stage },
          onUpload: (file: File) => step(actions.proposeImport, file, {}),
          onMap: (mapping: Readonly<Record<number, string | null>>) =>
            importing.file === null
              ? Promise.resolve({ ok: false, message: 'Choose the file again' })
              : step(actions.dryRunImport, importing.file, mapping),
          onCommit: () =>
            importing.file === null
              ? Promise.resolve({ ok: false, message: 'Choose the file again' })
              : step(actions.commitImport, importing.file, importing.mapping),
          onDownloadBlocked: () => {
            const csv = stage.blockedCsv;
            const name = importing.file?.name.replace(/\.[^.]+$/, '') ?? 'import';
            if (typeof csv === 'string') download(`${name}-blocked.csv`, csv);
          },
          onBack: () => {
            setImporting((s) => ({ ...s, stages: s.stages.length > 1 ? s.stages.slice(0, -1) : s.stages }));
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
