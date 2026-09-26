import { TooltipProvider } from '@reach/ui';
import { render, screen, within } from '@testing-library/react';
import axe from 'axe-core';
import type { ReactElement } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { page, userEvent } from 'vitest/browser';

import { Analytics } from '../analytics/analytics';
import { BulkEdit } from '../bulk/bulk-edit';
import { CompletenessGrid } from '../completeness/completeness-grid';
import { Directory } from '../directory/directory';
import { ExportBuilder } from '../export/export-builder';
import { ImportFlow } from '../import/import-flow';
import { Onboarding } from '../onboarding/onboarding';
import { PersonHistory } from '../profile/history';
import { Profile } from '../profile/profile';
import type { RecordField } from '../record/model';
import { FieldEditor } from '../settings/field-editor';
import { FieldRegistry } from '../settings/field-registry';
import { Integrations } from '../settings/integrations/integrations';
import { Organisation } from '../settings/organisation';
import { WebhookLog } from '../settings/integrations/webhook-log';
import { FullValues } from '../export/full-values';
import { PeopleHome } from '../home/people-home';
import { IdentifierReviews } from '../review/identifier-reviews';
import { PublishDialog } from '../settings/publish';
import { PeopleSetup } from '../setup/people-setup';

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

/** At rest: a box mid-way through a scale-in reports the scaled size. */
async function settled(): Promise<void> {
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
            choices: { legalEntities: [], countries: [] },
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
        choices={{ legalEntities: [], countries: [{ value: 'ES', label: 'Spain' }] }}
        fields={[{ key: 'grade', label: 'Grade', options: [] }]}
        advise={never}
        onSave={ok}
      />,
    );
    const sheet = await screen.findByRole('dialog', { name: 'Edit Permit' });
    for (let step = 1; step <= 2; step += 1) {
      await userEvent.click(within(sheet).getByRole('button', { name: 'Next' }));
      await settled();
      expect(await violations(document.body)).toEqual([]);
      // The conditions and the rules; the stepper above them is Reach's, and
      // measured where Reach is.
      for (const group of sheet.querySelectorAll('fieldset')) expect(underFloor(group)).toEqual([]);
    }
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
    expect(getComputedStyle(dialog).bottom).toBe('0px');
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
    // HR's termination, as a dialog over it.
    await userEvent.click(screen.getByRole('button', { name: 'Terminate' }));
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
      <PeopleHome load={{ status: 'ready', data: { hr: true, admin: true, finance: false } }} />,
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
    await userEvent.click(screen.getByRole('button', { name: 'Edit Acme Iberia SL' }));
    await settled();
    expect(await violations(document.body)).toEqual([]);
    expect(underFloor(document.body)).toEqual([]);
  });

  it('the directory, as cards', async () => {
    await checked(
      <Directory
        load={{
          status: 'ready',
          data: {
            active: 2,
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
      />,
    );
    // A phone gets cards; the table is a desk's.
    expect(screen.queryByRole('table')).toBeNull();
    expect(screen.getByRole('button', { name: 'Details for Lena Moreau' })).toBeVisible();
  });

  it('the completeness grid, as one card per person', async () => {
    await checked(
      <CompletenessGrid
        load={{
          status: 'ready',
          data: {
            since: 'Since version 4',
            waiting: { people: 61, lastReminded: null },
            completedThisWeek: 3,
            toFill: 2,
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
              },
              {
                personId: 'j',
                name: 'Joan Bosch',
                department: 'Engineering',
                manager: null,
                missing: ['cost_centre'],
              },
            ],
          },
        }}
        onSave={ok}
        // Paged (PEO-122): the page buttons are finger-sized too.
        onNextPage={vi.fn()}
        onFirstPage={vi.fn()}
      />,
    );
    expect(screen.getByRole('button', { name: 'Next page' })).toBeInTheDocument();
    screen.getByRole('combobox', { name: 'Cost centre for Lena Moreau' }).focus();
    await userEvent.keyboard('{Tab}');
    expect(screen.getByRole('combobox', { name: 'Cost centre for Joan Bosch' })).toHaveFocus();
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
                fields: [field({ key: 'job_title', label: 'Job title' }), field({ key: 'desk', label: 'Desk' })],
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
                changes: [{ key: 'job_title', label: 'Job title', dated: true, before: null, after: 'Lead' }],
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

  it('the import upload', async () => {
    await checked(
      <ImportFlow
        load={{ status: 'ready', data: { step: 'upload' } }}
        onUpload={ok}
        onMap={ok}
        onCommit={ok}
        onDownloadBlocked={vi.fn()}
        onBack={vi.fn()}
      />,
    );
  });

  it('the import review', async () => {
    await checked(
      <ImportFlow
        load={{
          status: 'ready',
          data: {
            step: 'review',
            file: { name: 'people.xlsx', rows: 3, sheet: null },
            dryRun: {
              counts: { create: 2, update: 0, unchanged: 0, blocked: 1, duplicate: 0 },
              incomplete: { count: 1, byField: [{ label: 'Cost centre', count: 1 }] },
              ignoredColumns: [],
              blocked: [{ row: 3, person: null, problem: 'No work email', cell: 'D3 — empty' }],
            },
          },
        }}
        onUpload={ok}
        onMap={ok}
        onCommit={ok}
        onDownloadBlocked={vi.fn()}
        onBack={vi.fn()}
      />,
    );
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
      />,
    );
  });

  it('analytics, with every chart’s numbers one tap away', async () => {
    await checked(
      <Analytics
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
