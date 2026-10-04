import { AssistantLauncher, TooltipProvider } from '@reach/ui';
import { render, screen, within } from '@testing-library/react';
import axe from 'axe-core';
import type { ReactElement } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { page, userEvent } from 'vitest/browser';

import { Analytics } from '../analytics/analytics';
import { Approvals } from '../approvals/approvals';
import { BulkEdit } from '../bulk/bulk-edit';
import { CompletenessGrid } from '../completeness/completeness-grid';
import { Directory } from '../directory/directory';
import { ExportBuilder } from '../export/export-builder';
import { ImportFlow } from '../import/import-flow';
import {
  DONE,
  MAPPING,
  MAPPING_WITH_OFFICE,
  NEW_FIELDS,
  PLAN,
  PLAN_WITH_OFFICE,
} from '../import/import.fixture';
import { Onboarding } from '../onboarding/onboarding';
import { PersonHistory } from '../profile/history';
import { Profile } from '../profile/profile';
import type { RecordField } from '../record/model';
import { FieldEditor } from '../settings/field-editor';
import { FieldRegistry } from '../settings/field-registry';
import { FieldChange } from '../settings/field-change';
import { START_DAY } from '../settings/field-change.fixture';
import { Integrations } from '../settings/integrations/integrations';
import { Organisation } from '../settings/organisation';
import { WebhookLog } from '../settings/integrations/webhook-log';
import { FullValues } from '../export/full-values';
import { PeopleHome } from '../home/people-home';
import { overview } from '../home/people-home.fixture';
import { IdentifierReviews } from '../review/identifier-reviews';
import { ImportExport } from '../import/import-export';
import { Duplicates } from '../review/duplicates';
import { PublishDialog } from '../settings/publish';
import { PeopleSetup } from '../setup/people-setup';
import { WhatChanged } from '../analytics/what-changed';
import { FOR_NORA, SEPTEMBER } from '../analytics/what-changed.fixture';

/**
 * Every screen at 390×844 with a coarse pointer and the real stylesheet
 * (PRD §17.3): axe over the rendered page, contrast included, and every tap
 * target measured against the 44px floor rather than eyeballed.
 */

const ok = () => Promise.resolve({ ok: true as const });
const never = () => new Promise<never>(() => undefined);

/** WCAG 2.5.8 and the iOS HIG: nothing a finger has to hit is smaller. */
const FLOOR = 44;

const TARGETS =
  'button, a[href], input:not([type="hidden"]), select, textarea, [role="switch"], [role="checkbox"], [role="radio"], [role="combobox"], [role="tab"]';

/** Targets under the floor, by name and size. A `::before` hit area counts, as Reach draws one. */
function underFloor(root: Element): string[] {
  return [...root.querySelectorAll<HTMLElement>(TARGETS)].flatMap((el) => {
    if (el.closest('[aria-hidden="true"]') !== null) return [];
    // What a finger actually hits: a field's whole shell (the input fills it),
    // or the card-sized label a `RadioCard` wraps its radio in.
    const surface =
      el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement
        ? (el.parentElement ?? el)
        : (el.closest('label') ?? el);
    const box = surface.getBoundingClientRect();
    if (box.width === 0 || box.height === 0) return [];
    const hit = getComputedStyle(el, '::before');
    const width = Math.max(box.width, Number.parseFloat(hit.width) || 0);
    const height = Math.max(box.height, Number.parseFloat(hit.height) || 0);
    if (width >= FLOOR - 0.5 && height >= FLOOR - 0.5) return [];
    const name = el.getAttribute('aria-label') ?? el.textContent.trim().slice(0, 40);
    return [
      `${el.tagName.toLowerCase()} "${name}" ${String(Math.round(width))}×${String(Math.round(height))}`,
    ];
  });
}

async function violations(root: Element): Promise<string[]> {
  const result = await axe.run(root, { rules: { region: { enabled: false } } });
  return result.violations.map(
    (v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`,
  );
}

function mount(ui: ReactElement) {
  return render(ui, { wrapper: TooltipProvider });
}

/**
 * At rest: a box mid-way through a scale-in reports the scaled size, and one
 * mid-way through a fade reports blended colours. Two frames first, so a
 * surface that opens on mount (a sheet, a dialog) has started its animation
 * before they are collected: on a slow runner it had not, and axe measured a
 * button through a sheet still fading in.
 */
async function settled(): Promise<void> {
  await new Promise<void>((resolve) => {
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        resolve();
      });
    });
  });
  await Promise.all(
    document
      .getAnimations()
      .filter((a) => a.effect?.getComputedTiming().endTime !== Number.POSITIVE_INFINITY)
      .map((a) => a.finished.catch(() => undefined)),
  );
}

async function checked(ui: ReactElement): Promise<void> {
  mount(ui);
  await settled();
  const root = document.body;
  expect(await violations(root)).toEqual([]);
  expect(underFloor(root)).toEqual([]);
}

const field = (over: Partial<RecordField> & Pick<RecordField, 'key' | 'label'>): RecordField => ({
  description: null,
  dataType: 'text',
  options: [],
  required: false,
  readOnly: false,
  ...over,
});

describe('at 390×844, with a finger', () => {
  it('uses the coarse control sizes', () => {
    expect(matchMedia('(pointer: coarse)').matches).toBe(true);
    expect(window.innerWidth).toBe(390);
  });

  // The checks below are only as real as axe is: a page that breaks it must
  // come back with violations, contrast included, or every pass is vacuous.
  it('fails white on white and an unnamed button', async () => {
    mount(
      // Near-white: at exactly 1:1 axe calls the text deliberately hidden.
      <div style={{ background: '#fff', color: '#eee' }}>
        <p>White on white.</p>
        <button type="button">
          <svg aria-hidden="true" width="16" height="16" />
        </button>
      </div>,
    );
    await settled();
    const ids = (await violations(document.body)).map((v) => v.split(':')[0]);
    expect(ids).toEqual(expect.arrayContaining(['color-contrast', 'button-name']));
  });

  it('the field registry', async () => {
    await checked(
      <FieldRegistry
        load={{
          status: 'ready',
          data: {
            published: { version: 3, publishedAt: '12 Sep' },
            unpublishedChanges: 1,
            sections: [
              {
                key: 'hr',
                label: 'HR information',
                visibility: ['hr'],
                ownership: ['hr'],
                origin: 'core',
                fixed: false,
              },
            ],
            fields: [
              {
                key: 'cost_centre',
                sectionKey: 'hr',
                label: 'Cost centre',
                description: null,
                dataType: 'select',
                options: ['ENG-204'],
                requiredness: 'always',
                requiredWhen: null,
                ownership: ['hr'],
                visibility: ['hr'],
                visibilityRules: [],
                collectAt: 'hr_only',
                classification: 'internal',
                piiKind: 'none',
                origin: 'tenant',
                pending: 'added',
              },
            ],
            choices: { legalEntities: [], countries: [], employmentTypes: [], workModels: [] },
          },
        }}
        today="2026-09-22"
        advise={never}
        onReorderSections={ok}
        onReorderFields={ok}
        onAddSection={ok}
        onSaveField={ok}
        preview={never}
        onPublish={ok}
      />,
    );
  });

  it('the predicate editor and custom visibility rules, on steps two and three (PEO-065, PEO-066)', async () => {
    const when = {
      combine: 'all' as const,
      clauses: [
        { operand: 'country' as const, in: ['ES'] },
        { operand: 'attribute' as const, key: 'grade', is: 'equals' as const, equals: 'senior' },
      ],
    };
    mount(
      <FieldEditor
        open
        onOpenChange={vi.fn()}
        section={{
          key: 'hr',
          label: 'HR information',
          visibility: ['hr'],
          ownership: ['hr'],
          origin: 'core',
          fixed: false,
        }}
        field={{
          key: 'permit',
          sectionKey: 'hr',
          label: 'Permit',
          description: null,
          dataType: 'text',
          options: [],
          requiredness: 'conditional',
          requiredWhen: when,
          ownership: ['hr'],
          visibility: ['hr'],
          visibilityRules: [{ scopes: ['manager'], when }],
          collectAt: 'hr_only',
          classification: 'internal',
          piiKind: 'none',
          origin: 'tenant',
          pending: null,
        }}
        takenKeys={[]}
        choices={{
          legalEntities: [],
          countries: [{ value: 'ES', label: 'Spain' }],
          employmentTypes: [],
          workModels: [],
        }}
        fields={[{ key: 'grade', label: 'Grade', options: [] }]}
        advise={never}
        onSave={ok}
      />,
    );
    const sheet = await screen.findByRole('dialog', { name: 'Edit Permit' });
    await settled();
    expect(await violations(document.body)).toEqual([]);
    // Every part is on one page: the conditions and the rules; the section
    // list and the access matrix are Reach's, and measured where Reach is.
    for (const group of sheet.querySelectorAll('fieldset')) expect(underFloor(group)).toEqual([]);
  });

  it('publishing, as a sheet from the bottom', async () => {
    await checked(
      <PublishDialog
        open
        onOpenChange={vi.fn()}
        today="2026-09-22"
        preview={() =>
          Promise.resolve({
            nextVersion: 4,
            unchanged: false,
            changes: [
              {
                kind: 'added',
                key: 'cost_centre',
                summary: 'Cost centre added',
                specialCategory: false,
              },
            ],
            impact: {
              evaluated: 412,
              becomingIncomplete: 88,
              becomingComplete: 0,
              forEmployees: 61,
              forStaff: 27,
            },
            integrationsNotified: 3,
          })
        }
        onPublish={ok}
      />,
    );
    await screen.findByText('Become incomplete');
    const dialog = screen.getByRole('dialog');
    // Anchored to the bottom edge, not centred: read from the style rather than
    // the box, which is mid-way through sliding in.
    // Reach 2 floats the sheet a half-rem above the edge (or the safe area).
    expect(Number.parseFloat(getComputedStyle(dialog).bottom)).toBeLessThanOrEqual(8);
    expect(underFloor(dialog)).toEqual([]);
  });

  it('the setup wizard', async () => {
    await checked(
      <PeopleSetup
        load={{
          status: 'ready',
          data: {
            legalEntity: { name: 'Acme Iberia SL', country: 'ES' },
            entityConfirmed: false,
            countries: [{ code: 'ES', name: 'Spain' }],
            packs: [],
            published: null,
            profile: null,
          },
        }}
        onConfirmEntity={ok}
        onPublish={ok}
        onSaveProfile={ok}
        onFinish={vi.fn()}
      />,
    );
  });

  it('a profile', async () => {
    await checked(
      <Profile
        load={{
          status: 'ready',
          data: {
            person: {
              name: 'Adam Reyes',
              summary: 'Support Engineer · Barcelona',
              avatarUrl: null,
              missing: 1,
            },
            sections: [
              {
                key: 'contact',
                label: 'Contact',
                visibility: ['self', 'hr'],
                readsLogged: false,
                fields: [field({ key: 'mobile', label: 'Mobile', dataType: 'phone' })],
              },
            ],
            values: {},
            calendar: { today: '2026-09-25', timeZone: 'Pacific/Kiritimati' },
            employment: {
              status: 'active',
              periods: [
                {
                  period: 1,
                  startedOn: '2026-01-01',
                  lastWorkingDay: null,
                  leavingReason: null,
                  eligibleForRehire: null,
                  noticeFrom: null,
                  rehireOverrideReason: null,
                },
              ],
            },
          },
        }}
        onSave={ok}
        onMove={ok}
      />,
    );
    // The Actions menu, a finger's width a row; then HR's termination, as a dialog over it.
    await userEvent.click(screen.getByRole('button', { name: 'Actions' }));
    await settled();
    expect(underFloor(document.body)).toEqual([]);
    await userEvent.click(screen.getByRole('menuitem', { name: 'Terminate' }));
    await settled();
    expect(await violations(document.body)).toEqual([]);
    expect(underFloor(document.body)).toEqual([]);
  });

  it('a history, as of a date (PEO-064)', async () => {
    await checked(
      <PersonHistory
        load={{
          status: 'ready',
          data: {
            person: { id: 'p', name: 'Adam Reyes' },
            asOf: '2026-04-15',
            sections: [
              {
                key: 'compensation',
                label: 'Compensation',
                visibility: ['self', 'hr'],
                fields: [
                  field({
                    key: 'base_salary',
                    label: 'Base salary',
                    dataType: 'money',
                    readOnly: true,
                  }),
                ],
              },
            ],
            dated: ['base_salary'],
            values: { base_salary: { amountMinor: '5100000', currency: 'EUR' } },
            changes: [
              {
                id: 'fix',
                key: 'base_salary',
                value: { amountMinor: '5100000', currency: 'EUR' },
                effectiveFrom: '2026-03-01',
                recordedAt: '2026-06-02T08:30:00.000Z',
                by: 'Priya Shah',
                supersedes: 'typo',
                supersededBy: null,
              },
              {
                id: 'typo',
                key: 'base_salary',
                value: { amountMinor: '5000000', currency: 'EUR' },
                effectiveFrom: '2026-03-01',
                recordedAt: '2026-03-15T09:12:00.000Z',
                by: 'Priya Shah',
                supersedes: null,
                supersededBy: 'fix',
              },
            ],
          },
        }}
        onAsOf={vi.fn()}
        onBack={vi.fn()}
      />,
    );
  });

  it('People home', async () => {
    await checked(
      <PeopleHome
        load={{
          status: 'ready',
          data: overview({ roles: { hr: true, admin: true, finance: false } }),
        }}
      />,
    );
  });

  it('the organisation settings, and a dialog over them', async () => {
    const entity = {
      id: 'e1',
      name: 'Acme Iberia SL',
      country: 'ES',
      timeZone: 'Europe/Madrid',
      archived: false,
    };
    await checked(
      <Organisation
        load={{
          status: 'ready',
          data: {
            canManage: true,
            settings: {
              defaultTimeZone: 'Europe/Madrid',
              cohortMinimum: 10,
              slug: 'acme',
              displayName: 'Acme',
            },
            legalEntities: [entity],
            locations: [
              {
                id: 'l1',
                legalEntityId: 'e1',
                name: 'Madrid office',
                country: 'ES',
                timeZone: 'Europe/Madrid',
                zones: [{ effectiveFrom: '2026-01-01', timeZone: 'Europe/Madrid' }],
                archived: false,
              },
            ],
            numberings: [{ legalEntityId: 'e1', prefix: 'ES-', digits: 5, nextValue: 42 }],
            countries: [{ code: 'ES', name: 'Spain' }],
            timeZones: ['Etc/UTC', 'Europe/Madrid'],
            retentionFloors: [
              {
                floor: 'es-labour',
                months: 48,
                status: 'unreviewed',
                reviewedBy: null,
                reviewedOn: null,
              },
            ],
          },
        }}
        onUpdateSettings={ok}
        onCreateEntity={ok}
        onUpdateEntity={ok}
        onCreateLocation={ok}
        onUpdateLocation={ok}
        onChangeZone={ok}
        onSetNumbering={ok}
      />,
    );
    // Each row's actions are in its menu, on the card under a finger (H7).
    await userEvent.click(screen.getByRole('button', { name: 'Actions for Acme Iberia SL' }));
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Edit' }));
    await settled();
    expect(await violations(document.body)).toEqual([]);
    expect(underFloor(document.body)).toEqual([]);
  });

  it('the directory, as a list of people', async () => {
    await checked(
      <Directory
        load={{
          status: 'ready',
          data: {
            total: 2,
            active: 2,
            notStarted: 0,
            incomplete: 1,
            columns: [{ key: 'job_title', label: 'Job title' }],
            filterable: [
              {
                key: 'cost_centre',
                label: 'Cost centre',
                options: [{ value: 'ENG-204', label: 'ENG-204' }],
              },
            ],
            people: [
              {
                id: 'a',
                name: 'Adam Reyes',
                email: null,
                avatarUrl: null,
                values: { job_title: 'Support Engineer' },
                missing: 0,
              },
              {
                id: 'l',
                name: 'Lena Moreau',
                email: null,
                avatarUrl: null,
                values: { job_title: 'Staff Engineer' },
                missing: 2,
              },
            ],
          },
        }}
        search=""
        onSearchChange={vi.fn()}
        filters={{}}
        onFiltersChange={vi.fn()}
        onOpen={vi.fn()}
        view="cards"
        onViewChange={vi.fn()}
        // Search in words and the next page as the list ends, on a phone too.
        onAsk={() =>
          Promise.resolve({
            ok: true as const,
            by: 'rules' as const,
            note: null,
            unused: [],
            filters: 1,
            search: null,
          })
        }
        onLoadMore={() => new Promise(() => undefined)}
        next="cursor-1"
      />,
    );
    // A phone gets a list of people, each row their profile; the table is a desk's.
    expect(screen.queryByRole('table')).toBeNull();
    const people = screen.getByRole('list', { name: 'People' });
    expect(within(people).getByRole('link', { name: /Lena Moreau/ })).toBeVisible();
    // List or Org chart, the width of the page (MV3); Cards is a desk's.
    const views = screen
      .getAllByRole('radiogroup', { name: 'Show people as' })
      .filter((g) => g.checkVisibility());
    expect(views).toHaveLength(1);
    expect(within(views[0] as HTMLElement).getByRole('radio', { name: 'List' })).toBeChecked();
  });

  /* Smart search on the People tab (MA1–MA3). */
  const crowd = {
    total: 388,
    active: 388,
    notStarted: null,
    incomplete: null,
    columns: [{ key: 'job_title', label: 'Job title' }],
    fields: [
      {
        key: 'department',
        label: 'Team',
        kind: 'select',
        options: [{ value: 'eng', label: 'Engineering' }],
      },
      { key: 'bank_account', label: 'Bank account', kind: 'text', options: [] },
    ],
    query: {
      conditions: [
        { key: 'department', op: 'in', values: ['eng'] },
        { key: 'bank_account', op: 'empty', values: [] },
      ],
      match: 'all',
      sort: null,
    },
    remind: ['bank_account'],
    filterable: [],
    people: Array.from({ length: 30 }, (_, i) => ({
      id: `p${String(i)}`,
      name: `Person ${String(i + 1)}`,
      email: null,
      avatarUrl: null,
      values: { job_title: 'Engineer' },
      missing: null,
    })),
  };
  const smart = {
    search: '',
    onSearchChange: vi.fn(),
    filters: {},
    onFiltersChange: vi.fn(),
    onOpen: vi.fn(),
    onConditionsChange: vi.fn(),
  };

  it('smart search: the question, its chips scrolling sideways, and Remind all in thumb reach (MA1)', async () => {
    await checked(
      <Directory
        {...smart}
        load={{ status: 'ready', data: crowd }}
        asked="engineers missing bank details"
        onAsk={vi.fn()}
        onRemind={() => Promise.resolve({ ok: true as const, asked: 388, more: false })}
      />,
    );
    const row = screen.getByRole('group', { name: 'Understood as' });
    // One line that scrolls, never a wrap.
    expect(getComputedStyle(row).flexWrap).toBe('nowrap');
    expect(getComputedStyle(row).overflowX).toBe('auto');
    const remind = screen.getByRole('button', { name: 'Remind all' });
    expect(remind).toBeVisible();
    expect(remind.closest('div')).toHaveTextContent('388 people');
  });

  it('smart search: results scrolling forever, with where you are and the way back (MA2)', async () => {
    mount(
      <Directory
        {...smart}
        load={{ status: 'ready', data: crowd }}
        asked="engineers missing bank details"
        onAsk={vi.fn()}
        onLoadMore={() => new Promise(() => undefined)}
        next="cursor-1"
      />,
    );
    window.scrollTo({ top: 1200 });
    const back = await screen.findByRole('button', { name: 'Back to top' });
    expect(screen.getByText(/^\d+ of 388$/u)).toBeVisible();
    await settled();
    expect(underFloor(document.body)).toEqual([]);
    expect(await violations(document.body)).toEqual([]);
    await userEvent.click(back);
    await vi.waitFor(() => {
      expect(screen.queryByRole('button', { name: 'Back to top' })).toBeNull();
    });
    window.scrollTo({ top: 0 });
  });

  it('smart search: when it is unclear, one reading a row, a thumb wide (MA3)', async () => {
    const onAsk = vi.fn(() =>
      Promise.resolve({
        ok: true as const,
        by: 'rules' as const,
        note: null,
        unused: [],
        filters: 0,
        search: null,
        ask: {
          topic: 'leaving',
          phrase: 'leaving soon',
          readings: [
            { label: 'Have given notice', conditions: [], match: 'all' as const, count: 3 },
            { label: 'Both', conditions: [], match: 'any' as const, count: 8 },
          ],
        },
      }),
    );
    mount(<Directory {...smart} load={{ status: 'ready', data: crowd }} onAsk={onAsk} />);
    await userEvent.fill(
      screen.getByRole('searchbox', { name: 'Search people' }),
      'people leaving soon',
    );
    await userEvent.keyboard('{Enter}');
    const card = await screen.findByRole('group', { name: 'What does “leaving soon” mean?' });
    expect(
      within(card).getByRole('heading', { name: 'What does “leaving soon” mean?' }),
    ).toBeVisible();
    for (const choice of within(card).getAllByRole('button')) {
      expect(choice.getBoundingClientRect().height).toBeGreaterThanOrEqual(44);
    }
    await settled();
    expect(underFloor(document.body)).toEqual([]);
    expect(await violations(document.body)).toEqual([]);
  });

  it('the completeness grid, as one card per person', async () => {
    await checked(
      <CompletenessGrid
        load={{
          status: 'ready',
          data: {
            since: 'Since version 4',
            waiting: { people: 61, lastReminded: null, due: 61 },
            completedThisWeek: 3,
            toFill: 2,
            blocking: 4,
            fields: [
              {
                key: 'cost_centre',
                label: 'Cost centre',
                options: [{ value: 'ENG-204', label: 'ENG-204' }],
                person: false,
              },
            ],
            rows: [
              {
                personId: 'l',
                name: 'Lena Moreau',
                department: 'Engineering',
                manager: null,
                missing: ['cost_centre'],
                owner: 'hr',
                remindedAt: null,
              },
              {
                personId: 'j',
                name: 'Joan Bosch',
                department: 'Engineering',
                manager: null,
                missing: ['cost_centre'],
                owner: 'hr',
                remindedAt: null,
              },
              // Hers to give: reminded, not filled in (MV2).
              {
                personId: 'u',
                name: 'Lucía Fernández',
                department: 'Sales',
                manager: null,
                missing: ['cost_centre'],
                owner: 'employee',
                remindedAt: null,
              },
            ],
          },
        }}
        onSave={ok}
        onRemind={ok}
        // Paged (PEO-122): the page buttons are finger-sized too.
        onNextPage={vi.fn()}
        onFirstPage={vi.fn()}
      />,
    );
    expect(screen.getByRole('button', { name: 'Next page' })).toBeInTheDocument();
    // A phone gets the percentage as a bar, and a row a person (MV2); the table is a desk's.
    expect(screen.queryByRole('table', { name: 'Missing information' })).toBeNull();
    const people = screen.getByRole('list', { name: 'Missing information' });
    expect(within(people).getAllByText('Missing: Cost centre')).toHaveLength(3);
    // Hers to give: Remind, not Fill in.
    expect(within(people).getByRole('button', { name: 'Remind Lucía Fernández' })).toBeVisible();
    await userEvent.click(within(people).getByRole('button', { name: 'Fill in Lena Moreau' }));
    await settled();
    expect(underFloor(document.body)).toEqual([]);
    expect(screen.getByRole('combobox', { name: 'Cost centre for Lena Moreau' })).toHaveFocus();
    await userEvent.keyboard('{Tab}');
    expect(screen.getByRole('combobox', { name: 'Cost centre for Joan Bosch' })).toHaveFocus();
  });

  it('import and export, two tiles and one history (MV5)', async () => {
    await checked(
      <ImportExport
        load={{
          status: 'ready',
          data: {
            canImport: true,
            now: '2026-09-29T15:00:00.000Z',
            history: {
              items: [
                {
                  id: 'i1',
                  kind: 'import',
                  title: 'new-joiners.csv',
                  by: { name: 'Ada Lovelace', avatarUrl: null },
                  at: '2026-09-15T09:00:00.000Z',
                  imported: { created: 12, updated: 0, blocked: 2 },
                  exported: null,
                  downloadable: false,
                  reportUrl: 'https://files.test/report?sig=s',
                },
              ],
              next: null,
              paged: false,
            },
          },
        }}
      />,
    );
    expect(screen.getByRole('link', { name: 'Import' })).toBeVisible();
    expect(screen.getByRole('link', { name: 'Export' })).toBeVisible();
    expect(screen.queryByRole('table')).toBeNull();
    const history = within(screen.getByRole('list', { name: 'Imports and exports' }));
    expect(history.getByRole('link', { name: /new-joiners\.csv/ })).toBeVisible();
    // The row's line is the result, then when.
    expect(history.getByText('12 created · 2 skipped · 15 Sep')).toBeVisible();
  });

  it('bulk edit, its preview as one card per person (PEO-071)', async () => {
    await checked(
      <BulkEdit
        load={{
          status: 'ready',
          data: {
            people: [
              { id: 'l', name: 'Lena Moreau' },
              { id: 'j', name: 'Joan Bosch' },
            ],
            sections: [
              {
                key: 'hr',
                label: 'HR',
                visibility: ['hr'],
                fields: [
                  field({ key: 'job_title', label: 'Job title' }),
                  field({ key: 'desk', label: 'Desk' }),
                ],
              },
            ],
            today: '2026-09-26',
            limit: 50,
          },
        }}
        onPreview={() =>
          Promise.resolve({
            ok: true,
            committed: false,
            rows: [
              {
                personId: 'l',
                name: 'Lena Moreau',
                outcome: 'changed',
                changes: [
                  {
                    key: 'job_title',
                    label: 'Job title',
                    dated: true,
                    before: null,
                    after: 'Lead',
                  },
                ],
                refusal: null,
                findings: [],
              },
              {
                personId: 'j',
                name: 'Joan Bosch',
                outcome: 'refused',
                changes: [],
                refusal: { code: 'UNIQUE_VALUE_TAKEN', message: 'Somebody else holds that value' },
                findings: [],
              },
            ],
          })
        }
        onCommit={never}
        onBack={vi.fn()}
      />,
    );
    await userEvent.click(screen.getByRole('button', { name: 'Preview changes' }));
    const list = await screen.findByRole('list', { name: 'Per person' });
    expect(within(list).getByText('Somebody else holds that value')).toBeVisible();
    await settled();
    expect(await violations(document.body)).toEqual([]);
    expect(underFloor(document.body)).toEqual([]);
  });

  it('integrations', async () => {
    await checked(
      <Integrations
        load={{
          status: 'ready',
          data: {
            schemaVersion: 4,
            deliveries24h: 12,
            events: ['people.person.hired'],
            fields: [{ key: 'hire_date', label: 'Hire date', refused: null }],
            endpoints: [
              {
                id: 'e1',
                url: 'https://hooks.example.com/people',
                enabled: true,
                events: ['people.person.hired'],
                allowlist: ['hire_date'],
                retrying: 0,
                problem: null,
                lastDelivery: null,
                secretRotated: null,
              },
            ],
          },
        }}
        onCreate={() => Promise.resolve({ ok: true, secret: 's' })}
        onUpdate={ok}
        onRotate={() => Promise.resolve({ ok: true, secret: 's' })}
      />,
    );
  });

  it('a field’s change of type, every value reviewed', async () => {
    await checked(
      <FieldChange load={{ status: 'ready', data: START_DAY }} onApply={ok} onBack={vi.fn()} />,
    );
  });

  it('the webhook delivery log', async () => {
    await checked(
      <WebhookLog
        load={{
          status: 'ready',
          data: {
            endpoint: { id: 'e1', url: 'https://hooks.example.com/people', enabled: true },
            deliveries: [
              {
                id: 'd1',
                eventName: 'people.person.hired',
                status: 'failed',
                attempts: 12,
                lastResponse: 500,
                createdAt: '2026-09-24T09:00:00.000Z',
                deliveredAt: null,
                replayOf: null,
              },
            ],
            next: 'x',
          },
        }}
        onReplay={ok}
        onBack={() => undefined}
        onOlder={() => undefined}
      />,
    );
  });

  it('full values, for finance and for HR', async () => {
    await checked(
      <FullValues
        load={{
          status: 'ready',
          data: {
            canRequest: true,
            canDecide: true,
            fields: [{ key: 'es_nif', label: 'NIF / NIE' }],
            requests: [
              {
                id: 'r1',
                state: 'pending',
                mine: false,
                requestedBy: 'Adam Ruiz',
                reason: 'September payroll',
                fields: ['NIF / NIE'],
                requestedAt: '2026-09-24T09:00:00.000Z',
                expiresAt: '2026-10-01T09:00:00.000Z',
                note: null,
                link: null,
              },
              {
                id: 'r2',
                state: 'issued',
                mine: true,
                requestedBy: 'Priya Shah',
                reason: 'Audit',
                fields: ['NIF / NIE'],
                requestedAt: '2026-09-23T09:00:00.000Z',
                expiresAt: '2026-09-30T09:00:00.000Z',
                note: null,
                link: 'https://files.example.com/x',
              },
            ],
          },
        }}
        onRequest={ok}
        onDecide={ok}
      />,
    );
  });

  it('identifiers to review, for HR (PEO-125)', async () => {
    await checked(
      <IdentifierReviews
        load={{
          status: 'ready',
          data: {
            items: [
              {
                personId: 'p1',
                name: 'Lucía Ortega',
                attributeKey: 'es_nif',
                label: 'NIF / NIE',
                last4: '678A',
                findings: [
                  {
                    level: 'mismatch',
                    code: 'check_mismatch',
                    message:
                      'Matches the national format, but the control letter does not compute.',
                  },
                ],
                enteredAt: '2026-09-24T09:00:00.000Z',
              },
            ],
          },
        }}
        onDecide={ok}
        onReveal={() => Promise.resolve({ ok: true as const, value: '12345678A' })}
      />,
    );
  });

  it('two possible duplicates side by side, for HR (PEO-074)', async () => {
    await checked(
      <Duplicates
        load={{
          status: 'ready',
          data: {
            items: [],
            comparison: {
              people: [
                { id: 'p1', name: 'Ada Lovelace', status: 'active', refusal: null },
                {
                  id: 'p2',
                  name: 'Augusta Lovelace',
                  status: 'provisional',
                  refusal: 'Never hired.',
                },
              ],
              rows: [
                {
                  key: 'given_name',
                  label: 'Legal first name',
                  values: ['Ada', 'Augusta'],
                  same: false,
                  takeable: [false, true],
                },
              ],
            },
          },
        }}
        onCompare={vi.fn()}
        onBack={vi.fn()}
        onMerge={ok}
        onDismiss={ok}
        onUnmerge={ok}
      />,
    );
  });

  describe('the import', () => {
    const flow = (data: Parameters<typeof ImportFlow>[0]['load']) => (
      <ImportFlow
        load={data}
        onUpload={ok}
        propose={() => Promise.resolve({ ok: true as const, data: NEW_FIELDS })}
        plan={() => Promise.resolve({ ok: true as const, data: PLAN })}
        run={ok}
        onDownloadBlocked={vi.fn()}
        onBack={vi.fn()}
        onDone={vi.fn()}
      />
    );
    const again = async (): Promise<void> => {
      await settled();
      expect(await violations(document.body)).toEqual([]);
      expect(underFloor(document.body)).toEqual([]);
    };

    it('the upload', async () => {
      await checked(flow({ status: 'ready', data: { step: 'upload' } }));
    });

    it('the mapping', async () => {
      await checked(flow({ status: 'ready', data: MAPPING }));
    });

    it('new fields, one card at a time, with Skip and Create in thumb reach (MA8)', async () => {
      await checked(flow({ status: 'ready', data: MAPPING }));
      await userEvent.click(screen.getByRole('button', { name: 'Next' }));
      await screen.findByText('New fields · 1 of 3');
      // The import's own bar, as drawn: back to Import, the step as the title,
      // and no large title or stepper under it.
      const bar = screen.getByRole('navigation', { name: 'Back' });
      expect(within(bar).getByRole('button', { name: 'Import' })).toBeInTheDocument();
      expect(screen.queryByRole('navigation', { name: 'Importing people' })).toBeNull();
      expect(
        screen.getByRole('heading', { name: 'These columns aren’t fields yet' }),
      ).toBeInTheDocument();
      expect(screen.getByRole('region', { name: 'Proposed fields' })).toBeInTheDocument();
      await again();
      await userEvent.click(screen.getByRole('button', { name: 'Create field' }));
      await screen.findByText('New fields · 2 of 3');
      await userEvent.click(screen.getByRole('button', { name: 'Skip' }));
      await screen.findByText('New fields · 3 of 3');
      // Special category is imported like the rest: no "Import anyway".
      expect(screen.getByRole('button', { name: 'Create field' })).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'Import anyway' })).toBeNull();
      await again();
    });

    it('the people without a value, then the plan in a sentence and Approve (MA9)', async () => {
      await checked(flow({ status: 'ready', data: MAPPING }));
      await userEvent.click(screen.getByRole('button', { name: 'Next' }));
      // One card at a time: the same two buttons serve every card, so each
      // press waits for its card, or it lands on the one before and the plan
      // never comes.
      for (const [i, name] of ['Create field', 'Create field', 'Skip'].entries()) {
        await screen.findByText(`New fields · ${String(i + 1)} of 3`);
        await userEvent.click(screen.getByRole('button', { name }));
      }
      expect(await screen.findByText(PLAN.short)).toBeInTheDocument();
      expect(
        screen.getByRole('heading', { name: '4 people have no T-shirt size' }),
      ).toBeInTheDocument();
      // Who, by name: each a card whose title is the name.
      const who = screen.getByRole('table', { name: 'People without T-shirt size' });
      expect(within(who).getAllByRole('row').at(1)).toHaveTextContent('Kevin Malone');
      expect(screen.getByRole('button', { name: 'Approve and run' })).toBeEnabled();
      await again();
    });

    it('the plan', async () => {
      const noNewColumns = { ...MAPPING, columns: MAPPING.columns.slice(0, 2) };
      await checked(flow({ status: 'ready', data: noNewColumns }));
      await userEvent.click(screen.getByRole('button', { name: 'Next' }));
      await screen.findByRole('heading', { name: 'Here’s everything that will happen' });
      // A cell left empty is a card titled by whose it is, under "See rows".
      await userEvent.click(screen.getByRole('button', { name: 'See rows' }));
      const left = screen.getByRole('table', { name: 'Left empty for HR' });
      const [title] = within(within(left).getAllByRole('row')[1] as HTMLElement).getAllByRole(
        'cell',
      );
      expect(title).toHaveTextContent('Pam Beesly');
      await again();
    });

    it('the work locations in the file, each a card, Next in thumb reach', async () => {
      mount(
        <ImportFlow
          load={{ status: 'ready', data: MAPPING_WITH_OFFICE }}
          onUpload={ok}
          propose={() => Promise.resolve({ ok: true as const, data: NEW_FIELDS })}
          plan={() => Promise.resolve({ ok: true as const, data: PLAN_WITH_OFFICE })}
          run={ok}
          onDownloadBlocked={vi.fn()}
          onBack={vi.fn()}
          admin
        />,
      );
      await userEvent.click(screen.getByRole('button', { name: 'Next' }));
      await screen.findByRole('heading', {
        name: '3 work locations in this file. Here’s how each maps.',
      });
      // Pinned above the tab bar, as MA8's Skip and Create are.
      const next = screen.getByRole('button', { name: 'Next: new fields' });
      expect(next.closest('[data-pinned-bar]') ?? next.parentElement).toHaveClass('sticky');
      // Another system's long id wraps above where it goes: nothing runs off the card.
      for (const title of screen.getAllByRole('heading', { level: 3 })) {
        expect(title.getBoundingClientRect().right).toBeLessThanOrEqual(window.innerWidth);
      }
      // Whoever a value leaves empty is a card titled by their name.
      const left = screen.getByRole('table', { name: /^Left without a work location/ });
      expect(within(left).getAllByRole('row').at(1)).toHaveTextContent('Toby Flenderson');
      await again();
    });

    it('done', async () => {
      await checked(flow({ status: 'ready', data: DONE }));
    });
  });

  it('the export builder', async () => {
    await checked(
      <ExportBuilder
        load={{
          status: 'ready',
          data: {
            today: '2026-09-22',
            who: [{ value: 'team', label: 'My team', count: 8 }],
            sections: [
              { key: 'work', label: 'Work', fields: [{ key: 'work_model', label: 'Work model' }] },
            ],
          },
        }}
        onExport={ok}
        onDescribe={() =>
          Promise.resolve({ ok: true as const, by: 'rules' as const, note: null, notes: [] })
        }
      />,
    );
  });

  it('an export from one sentence, waiting for approval (MA10)', async () => {
    await checked(
      <ExportBuilder
        load={{
          status: 'ready',
          data: {
            today: '2026-10-01',
            who: [
              { value: 'everyone', label: 'Everybody you can see', count: 412 },
              { value: 'conditions', label: 'Everybody whose team is Engineering', count: 148 },
            ],
            sections: [
              {
                key: 'pay',
                label: 'Pay',
                fields: [
                  { key: 'given_name', label: 'Given name' },
                  { key: 'base_salary', label: 'Base salary' },
                  { key: 'bonus', label: 'Bonus' },
                ],
              },
            ],
            preview: {
              recipient: { accountId: 'a-sofia', name: 'Sofia Lindqvist' },
              candidates: [{ accountId: 'a-sofia', name: 'Sofia Lindqvist' }],
              people: 148,
              sensitive: ['base_salary'],
              gap: {
                fields: [{ key: 'base_salary', label: 'Base salary', people: 148 }],
                unlisted: 0,
              },
              approvers: [{ accountId: 'a-nora', name: 'Nora Becker' }],
              tooLarge: false,
              emailed: true,
              canSchedule: true,
              self: 'a-ada',
            },
          },
        }}
        address={{
          q: 'Madrid engineering salaries as of 30 June for Finance',
          read: 'rules',
          who: 'conditions',
          fields: ['given_name', 'base_salary'],
          asOf: '2026-06-30',
          reason: '2027 budget',
        }}
        onExport={ok}
        onShare={ok}
        onSchedule={ok}
        onDescribe={() =>
          Promise.resolve({ ok: true as const, by: 'rules' as const, note: null, notes: [] })
        }
      />,
    );
  });

  it('the file explains itself, on a phone (AI14)', async () => {
    await checked(
      <ExportBuilder
        load={{
          status: 'ready',
          data: {
            today: '2026-10-01',
            who: [{ value: 'everyone', label: 'Everybody you can see', count: 412 }],
            sections: [],
            record: {
              id: '0199a3f0-7c1e-7d2a-9b1e-4f6a8c2d1e00',
              code: 'EXP-0199A3F0',
              status: 'completed',
              mine: false,
              requestedBy: { accountId: 'a-ada', name: 'Ada Lovelace' },
              sentTo: { accountId: 'a-sofia', name: 'Sofia Lindqvist' },
              openedAt: '2026-10-01T14:40:00.000Z',
              approvedBy: {
                accountId: 'a-nora',
                name: 'Nora Becker',
                at: '2026-10-01T14:31:00.000Z',
              },
              reason: 'Budget planning for 2027',
              rowCount: 148,
              fields: ['Name', 'Base salary'],
              sensitive: 1,
              asOf: '2026-06-30',
              format: 'xlsx',
              expiresAt: '2026-10-08T14:31:00.000Z',
              about: {
                title: 'Everybody whose team is Engineering, 30 June 2026',
                paragraphs: [
                  '148 people, with their name and base salary as they were at the end of 30 June 2026.',
                ],
                footnote: 'Confidential · link expires 8 October 2026 · export ID EXP-0199A3F0',
              },
              keptUntil: null,
              links: [{ name: 'people-2026-10-01.xlsx', url: 'https://files.test/x' }],
              now: '2026-10-01T15:00:00.000Z',
            },
          },
        }}
        onExport={ok}
      />,
    );
  });

  it('insights, a tab with every chart’s numbers one tap away', async () => {
    await checked(
      <Analytics
        tab="data-quality"
        load={{
          status: 'ready',
          data: {
            asOf: 'As of 22 Sep 2026',
            source: 'snapshot',
            sourceNote: 'snapshot taken 04:00 today',
            headcount: {
              value: 912,
              change: 10,
              trend: [
                { label: 'Feb', value: 842 },
                { label: 'Aug', value: 912 },
              ],
            },
            attrition: null,
            complete: { percent: 78.6, incomplete: 88 },
            expiringIn90Days: 7,
            movement: {
              period: 'Feb – Aug',
              opening: 842,
              joiners: 128,
              moves: 0,
              leavers: 58,
              closing: 912,
            },
            completenessBySection: [{ label: 'HR information', value: 99 }],
            expiries: {
              today: '2026-09-22',
              items: [
                { kind: 'work_permit', personId: 's', name: 'Sana Khan', day: '2026-10-22' },
                { kind: 'probation', personId: 'r', name: 'Rui Dias', day: '2026-11-03' },
              ],
            },
            funnel: [
              { label: 'Invited', value: 128 },
              { label: 'Complete', value: 61 },
            ],
          },
        }}
      />,
    );
    // No chart forces the page sideways; a time axis scrolls inside its own box.
    expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(window.innerWidth);
    // The expiry lanes are the taller, finger-sized ones a coarse pointer gets (PEO-122).
    const lane = screen.getAllByTitle('Sana Khan')[0]?.parentElement;
    expect(lane?.getBoundingClientRect().height).toBeGreaterThanOrEqual(56);
  });
});

describe('a floating button over a pinned footer (MA7)', () => {
  it('rises above the footer, so Approve is the thing under a finger at its centre', async () => {
    mount(
      <>
        <Approvals
          load={{
            status: 'ready',
            data: {
              isHr: true,
              items: [
                {
                  id: 'c1',
                  personId: 'p1',
                  name: 'Tom Fischer',
                  key: 'base_salary',
                  label: 'Base salary',
                  kind: 'value',
                  value: { amountMinor: '8400000', currency: 'EUR' },
                  current: { amountMinor: '6100000', currency: 'EUR' },
                  readable: true,
                  effectiveFrom: '2026-10-01',
                  requestedAt: '2026-09-22T09:40:00.000Z',
                  expiresAt: '2026-09-29T09:40:00.000Z',
                  requestedBy: 'Nora Becker',
                  reason: null,
                  mine: false,
                  canDecide: true,
                  canAsk: true,
                  canMark: true,
                  flags: [
                    { code: 'raise', title: 'A 38% raise', detail: 'Sales median is 4%' },
                    { code: 'band', title: 'Above the band', detail: 'Band tops out at €78k' },
                  ],
                  flagNote: 'This might be fine: a promotion would explain both.',
                  flagSummary: 'A 38% raise, above the band',
                },
              ],
            },
          }}
          onDecide={ok}
          onWithdraw={ok}
          onMarkNotUnusual={ok}
          onAsk={ok}
          change="c1"
          onChangeOpen={() => undefined}
        />
        {/* Where the shell puts it under a finger: the corner above the tab bar. */}
        <AssistantLauncher
          label="Ask"
          onOpen={() => undefined}
          className="fixed end-4 bottom-24 z-40"
        />
      </>,
    );
    await settled();
    // Every scroll position the footer is pinned at: the top of the page and the end of it.
    let looked = 0;
    for (const y of [0, document.documentElement.scrollHeight]) {
      window.scrollTo(0, y);
      // The launcher measures once a frame.
      await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      await settled();
      const approve = screen.getByRole('button', { name: /with note$/ });
      const box = approve.getBoundingClientRect();
      if (box.bottom <= 0 || box.top >= window.innerHeight) continue;
      // At its centre, as asked, and at each end too: a corner under the button is still covered.
      const middle = box.top + box.height / 2;
      for (const x of [box.left + 4, box.left + box.width / 2, box.right - 4]) {
        expect(document.elementFromPoint(x, middle)?.closest('button')).toBe(approve);
      }
      looked += 1;
    }
    expect(looked).toBeGreaterThan(0);
  });
});

describe('approvals on a phone, with a flagged change (MA7)', () => {
  it('draws why it is flagged and the decision, and every target is a finger’s', async () => {
    await checked(
      <Approvals
        load={{
          status: 'ready',
          data: {
            isHr: true,
            items: [
              {
                id: 'c1',
                personId: 'p1',
                name: 'Tom Fischer',
                key: 'base_salary',
                label: 'Base salary',
                kind: 'value',
                value: { amountMinor: '8400000', currency: 'EUR' },
                current: { amountMinor: '6100000', currency: 'EUR' },
                readable: true,
                effectiveFrom: '2026-10-01',
                requestedAt: '2026-09-22T09:40:00.000Z',
                expiresAt: '2026-09-29T09:40:00.000Z',
                requestedBy: 'Nora Becker',
                reason: null,
                mine: false,
                canDecide: true,
                canAsk: true,
                canMark: true,
                flags: [
                  { code: 'raise', title: 'A 38% raise', detail: 'Sales median is 4%' },
                  { code: 'band', title: 'Above the band', detail: 'Band tops out at €78k' },
                ],
                comparisons: [
                  { label: 'This change', percent: '38', highlight: true },
                  { label: 'Sales median', percent: '4', highlight: false },
                ],
                flagNote: 'This might be fine: a promotion would explain both.',
                flagSummary: 'A 38% raise, above the band',
              },
            ],
          },
        }}
        onDecide={ok}
        onWithdraw={ok}
        onMarkNotUnusual={ok}
        onAsk={ok}
        change="c1"
        onChangeOpen={() => undefined}
      />,
    );
    expect(screen.getByRole('heading', { name: 'Why this is flagged' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /with note$/ })).toBeInTheDocument();
    expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(window.innerWidth);
  });

  it('puts what gets flagged under the Flagged tab, switches a finger’s', async () => {
    await checked(
      <Approvals
        load={{
          status: 'ready',
          data: {
            isHr: true,
            items: [],
            canTune: true,
            checks: [
              {
                code: 'raise',
                title: 'Raise much bigger than usual',
                detail: 'Compared with the team’s raises this year',
                on: true,
              },
              {
                code: 'unusual_time',
                title: 'Requested at an unusual time',
                detail: 'Outside the requester’s working hours',
                on: false,
              },
            ],
            last90: { flagged: 11, rejected: 3, marked: 6 },
          },
        }}
        onDecide={ok}
        onWithdraw={ok}
        onSetCheck={ok}
        tab="flagged"
        onTabChange={() => undefined}
      />,
    );
    expect(screen.getByRole('heading', { name: 'What Kithena checks' })).toBeInTheDocument();
    expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(window.innerWidth);
  });
});

describe('onboarding on a phone, keyboard up', () => {
  it('completes a section end to end with Save reachable, and stopping keeps what was saved', async () => {
    const onSave = vi.fn(ok);
    mount(
      <Onboarding
        load={{
          status: 'ready',
          data: {
            firstName: 'Adam',
            saved: [],
            values: {},
            sections: [
              {
                key: 'emergency',
                label: 'Emergency contacts',
                ask: 'required',
                visibility: ['self', 'hr'],
                fields: [
                  field({ key: 'contact_name', label: 'Their name', required: true }),
                  field({
                    key: 'relationship',
                    label: 'Relationship',
                    description: 'Partner, parent, friend',
                  }),
                  field({ key: 'contact_email', label: 'Their email', dataType: 'email' }),
                  field({
                    key: 'contact_phone',
                    label: 'Phone number',
                    dataType: 'phone',
                    required: true,
                  }),
                ],
              },
              {
                key: 'bank',
                label: 'Bank details',
                ask: 'required',
                visibility: ['self', 'hr'],
                fields: [
                  field({ key: 'iban', label: 'IBAN', dataType: 'bank_account', required: true }),
                ],
              },
            ],
          },
        }}
        onSave={onSave}
      />,
    );
    expect(await violations(document.body)).toEqual([]);
    expect(underFloor(document.body)).toEqual([]);

    // A software keyboard takes roughly the lower 40% of an 844px screen.
    await page.viewport(390, 500);
    const form = screen.getByRole('form', { name: 'Emergency contacts' });
    await userEvent.type(within(form).getByLabelText(/Their name/), 'Marta Ortega');
    await userEvent.type(within(form).getByLabelText(/Phone number/), '612345678');

    const save = within(form).getByRole('button', { name: 'Save and continue' });
    const box = save.getBoundingClientRect();
    expect(box.top).toBeGreaterThanOrEqual(0);
    expect(box.bottom).toBeLessThanOrEqual(window.innerHeight);
    await userEvent.click(save);

    expect(onSave).toHaveBeenCalledOnce();
    expect(onSave).toHaveBeenCalledWith('emergency', {
      contact_name: 'Marta Ortega',
      contact_phone: expect.stringContaining('612345678') as unknown,
    });
    // Abandoned here: the second section is unsaved and the first is kept.
    await screen.findByRole('form', { name: 'Bank details' });
    expect(screen.getByText(/1 of 2 sections done/)).toBeVisible();
    await page.viewport(390, 844);
  });
});

describe('what changed on a phone (MA4, MA5)', () => {
  const four = {
    ...SEPTEMBER,
    title: 'September in four points',
    points: [
      ...SEPTEMBER.points,
      {
        key: 'span',
        figure: '2',
        text: '2 managers now have more than 8 direct reports.',
        parts: [{ text: '2 managers now have more than 8 direct reports.', strong: false }],
        sources: [{ kind: 'org-chart' as const, label: 'Org chart' }],
        audience: null,
      },
    ],
  };

  it('holds the first three points and Share summary, every target a finger’s', async () => {
    await checked(
      <WhatChanged
        load={{ status: 'ready', data: four }}
        onExportingChange={vi.fn()}
        onAsk={vi.fn()}
      />,
    );
    expect(screen.getByRole('heading', { name: 'September in four points' })).toBeVisible();
    expect(screen.getByText(/Headcount grew from/)).toBeVisible();
    expect(screen.getByText(/2 managers now have more than 8/)).not.toBeVisible();
    // The design's phone card: no period control, follow-up or charts beside it.
    expect(screen.getByRole('radio', { name: 'This quarter', hidden: true })).not.toBeVisible();
    expect(
      screen.getByRole('textbox', { name: 'Ask a follow-up', hidden: true }),
    ).not.toBeVisible();
    expect(screen.getByRole('button', { name: 'Share summary' })).toBeVisible();
    await userEvent.click(screen.getByRole('button', { name: 'Show 1 more' }));
    expect(screen.getByText(/2 managers now have more than 8/)).toBeVisible();
    expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(window.innerWidth);
  });

  it('shares as a sheet from the bottom, rewritten for its recipient', async () => {
    await checked(
      <WhatChanged
        load={{ status: 'ready', data: SEPTEMBER }}
        exporting={{
          format: 'email',
          recipient: 'nora',
          tone: 'short',
          charts: true,
          madeLine: true,
        }}
        onExportingChange={vi.fn()}
        onDraft={() => Promise.resolve({ ok: true as const, data: FOR_NORA })}
        onSend={vi.fn()}
      />,
    );
    const dialog = screen.getByRole('dialog', { name: /Share the September summary/ });
    expect(await within(dialog).findByText('Rewritten for Nora')).toBeVisible();
    expect(within(dialog).getByText('Message')).toBeVisible();
    expect(within(dialog).getByRole('button', { name: 'Send to Nora' })).toBeVisible();
    expect(within(dialog).queryByRole('button', { name: 'Download' })).toBeNull();
    expect(Number.parseFloat(getComputedStyle(dialog).bottom)).toBeLessThanOrEqual(8);
    await settled();
    expect(underFloor(dialog)).toEqual([]);
    expect(await violations(document.body)).toEqual([]);
  });
});
