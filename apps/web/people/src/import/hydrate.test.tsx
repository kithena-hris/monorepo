// @vitest-environment jsdom
import { createElement } from 'react';
import { describe, expect, it } from 'vitest';

import { framed } from '../frame';
import { serveAndHydrate } from '../test/hydrate';
import { ImportExport as ImportExportScreen } from './import-export';
import { ImportFlow as ImportFlowScreen } from './import-flow';
import { RUN_GOING } from './import.fixture';

/**
 * Import & export as the shell serves it: the history is in the first HTML,
 * a running import shows how far it is, and hydrating changes nothing.
 */
const ImportExport = framed(ImportExportScreen);
const ImportFlow = framed(ImportFlowScreen);
const ok = () => Promise.resolve({ ok: true as const });

describe('Import & export, hydrated', () => {
  it('serves the page with its history and the running import, and hydrates it unchanged', async () => {
    const { html, errors } = await serveAndHydrate(
      createElement(ImportExport, {
        load: {
          status: 'ready',
          data: {
            canImport: true,
            now: '2026-09-29T15:00:00.000Z',
            history: {
              items: [
                {
                  id: 'e1',
                  kind: 'export',
                  title: 'Budget planning for 2027',
                  by: { name: 'Sofia Lindqvist', avatarUrl: null },
                  at: '2026-09-20T09:02:00.000Z',
                  imported: null,
                  exported: { rows: 42, format: 'xlsx' },
                  downloadable: false,
                  reportUrl: null,
                },
              ],
              next: null,
              paged: false,
            },
          },
        },
        running: RUN_GOING,
      }),
    );
    expect(html).toContain('Budget planning for 2027');
    expect(html).toContain('312 of 1,000 people');
    expect(errors).toEqual([]);
  });

  it('serves a running import’s own page with its progress, and hydrates it unchanged', async () => {
    const { html, errors } = await serveAndHydrate(
      createElement(ImportFlow, {
        load: { status: 'ready', data: { step: 'run', run: RUN_GOING } },
        onUpload: ok,
        propose: () => Promise.resolve({ ok: false as const, message: '' }),
        plan: () => Promise.resolve({ ok: false as const, message: '' }),
        run: ok,
        onDownloadBlocked: () => undefined,
        onBack: () => undefined,
      }),
    );
    expect(html).toContain('312 of 1,000 people');
    expect(errors).toEqual([]);
  });
});
