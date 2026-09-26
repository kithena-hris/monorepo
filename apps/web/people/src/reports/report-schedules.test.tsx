import { render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { fast } from '../test/user';
import { axeViolations } from '../test/axe';
import { ReportRuns } from './report-runs';
import {
  EACH_SEES_THEIR_OWN,
  ReportSchedules,
  needsConfirmation,
  type ReportSchedulesProps,
  type ReportSchedulesState,
  type ScheduleRow,
} from './report-schedules';

const PRIYA = '00000000-0000-4000-8000-0000000000b1';
const MARCO = '00000000-0000-4000-8000-0000000000b2';

const row: ScheduleRow = {
  id: '00000000-0000-4000-8000-0000000000c1',
  name: 'Monday roster',
  ownerName: 'Priya Shah',
  paused: false,
  segmentId: null,
  segmentName: null,
  filter: [],
  kind: 'export',
  format: 'xlsx',
  fields: null,
  reason: null,
  every: 'week',
  weekday: 1,
  day: null,
  hour: 7,
  legalEntityId: null,
  recipients: [{ accountId: PRIYA, name: 'Priya Shah' }],
  lastRun: { period: '2026-09-21', missed: 0, outcome: 'partial' },
};

const state = (over: Partial<ReportSchedulesState> = {}): ReportSchedulesState => ({
  canManage: true,
  schedules: [row],
  segments: [
    {
      id: '00000000-0000-4000-8000-0000000000d1',
      name: 'Madrid',
      forExport: true,
      forSummary: true,
    },
  ],
  people: [
    { accountId: PRIYA, name: 'Priya Shah', workEmail: 'priya@acme.example' },
    { accountId: MARCO, name: 'Marco Rossi', workEmail: 'marco@acme.example' },
  ],
  legalEntities: [],
  fields: [{ key: 'job_title', label: 'Job title', section: 'Work' }],
  ...over,
});

function props(over: Partial<ReportSchedulesProps> = {}): ReportSchedulesProps {
  const done = () => Promise.resolve({ ok: true as const });
  return {
    load: { status: 'ready', data: state() },
    onCreate: vi.fn(done),
    onUpdate: vi.fn(done),
    onPause: vi.fn(done),
    onResume: vi.fn(done),
    onDelete: vi.fn(done),
    ...over,
  };
}

describe('the scheduled reports screen (PEO-069)', () => {
  it('lists each schedule with its cadence, recipients, last run and status', async () => {
    const { container } = render(<ReportSchedules {...props()} />);
    const table = screen.getByRole('table', { name: 'Scheduled reports' });
    expect(within(table).getByText('Monday roster')).toBeInTheDocument();
    expect(within(table).getByText('Weekly on Monday at 07:00')).toBeInTheDocument();
    expect(within(table).getByText('Partly sent')).toBeInTheDocument();
    expect(within(table).getByText('Active')).toBeInTheDocument();
    expect(within(table).getByRole('link', { name: 'History' })).toHaveAttribute(
      'href',
      `/people/reports/${row.id}`,
    );
    expect(await axeViolations(container)).toEqual([]);
  });

  it('pauses, and deletes only once the deletion is confirmed', async () => {
    const p = props();
    render(<ReportSchedules {...p} />);
    const user = fast();
    await user.click(screen.getByRole('button', { name: 'Pause' }));
    expect(p.onPause).toHaveBeenCalledWith(row.id);
    await user.click(screen.getByRole('button', { name: 'Delete' }));
    expect(p.onDelete).not.toHaveBeenCalled();
    const confirm = screen.getByRole('alertdialog');
    await user.click(within(confirm).getByRole('button', { name: 'Delete' }));
    expect(p.onDelete).toHaveBeenCalledWith(row.id);
  });

  it('says under the recipients what each recipient gets', async () => {
    render(<ReportSchedules {...props()} />);
    await fast().click(screen.getByRole('button', { name: 'Edit' }));
    const dialog = screen.getByRole('dialog', { name: 'Edit Monday roster' });
    expect(within(dialog).getByText(EACH_SEES_THEIR_OWN)).toBeInTheDocument();
    expect(
      within(dialog).getByRole('button', { name: 'What each recipient gets' }),
    ).toBeInTheDocument();
  });

  it('saves a change that keeps who gets it and what it covers without asking again', async () => {
    const p = props();
    render(<ReportSchedules {...p} />);
    const user = fast();
    await user.click(screen.getByRole('button', { name: 'Edit' }));
    const dialog = screen.getByRole('dialog', { name: 'Edit Monday roster' });
    const name = within(dialog).getByRole('textbox', { name: /Name/ });
    await user.clear(name);
    await user.type(name, 'Monday list');
    await user.click(within(dialog).getByRole('button', { name: 'Save' }));
    expect(p.onUpdate).toHaveBeenCalledWith(
      row.id,
      expect.objectContaining({ name: 'Monday list' }),
    );
  });

  it('will not save a new schedule until the recipient confirmation is accepted', async () => {
    const p = props();
    render(<ReportSchedules {...p} />);
    const user = fast();
    await user.click(screen.getByRole('button', { name: 'New scheduled report' }));
    const dialog = screen.getByRole('dialog', { name: 'New scheduled report' });
    await user.type(within(dialog).getByRole('textbox', { name: /Name/ }), 'Team list');
    await user.click(within(dialog).getByRole('button', { name: 'Recipients' }));
    await user.click(screen.getByRole('option', { name: /Marco Rossi/ }));
    await user.keyboard('{Escape}');
    await user.click(within(dialog).getByRole('button', { name: 'Save' }));
    expect(p.onCreate).not.toHaveBeenCalled();

    const confirm = screen.getByRole('dialog', {
      name: 'Each recipient gets only what they may see',
    });
    expect(confirm).toHaveTextContent('different recipients may receive different people');
    await user.click(within(confirm).getByRole('button', { name: 'I understand, save it' }));
    expect(p.onCreate).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'Team list', recipients: [MARCO] }),
    );
  });

  it('shows anybody else only that HR schedules reports', () => {
    render(
      <ReportSchedules
        {...props({ load: { status: 'ready', data: state({ canManage: false }) } })}
      />,
    );
    expect(
      screen.getByText('Only HR and People administrators schedule reports.'),
    ).toBeInTheDocument();
    expect(screen.queryByRole('table')).toBeNull();
  });
});

describe('needsConfirmation', () => {
  const draft = {
    name: 'x',
    segmentId: null,
    filter: [],
    kind: 'export' as const,
    format: 'xlsx' as const,
    fields: null,
    reason: null,
    every: 'week' as const,
    weekday: 1,
    day: 1,
    hour: 7,
    legalEntityId: null,
    recipients: [PRIYA],
  };

  it('asks for a new schedule, and when recipients or the audience change', () => {
    expect(needsConfirmation(null, draft)).toBe(true);
    expect(needsConfirmation(row, draft)).toBe(false);
    expect(needsConfirmation(row, { ...draft, hour: 9 })).toBe(false);
    expect(needsConfirmation(row, { ...draft, recipients: [PRIYA, MARCO] })).toBe(true);
    expect(needsConfirmation(row, { ...draft, segmentId: 'd1' })).toBe(true);
  });
});

describe('a scheduled report’s history', () => {
  it('says per recipient what happened, and what a run covered', async () => {
    const { container } = render(
      <ReportRuns
        load={{
          status: 'ready',
          data: {
            id: row.id,
            name: 'Monday roster',
            runs: [
              {
                period: '2026-09-21',
                missed: 2,
                finishedAt: '2026-09-21T08:00:00.000Z',
                outcome: 'partial',
                recipients: [
                  { accountId: PRIYA, name: 'Priya Shah', outcome: 'sent' },
                  { accountId: MARCO, name: 'Marco Rossi', outcome: 'FIELD_NOT_FILTERABLE' },
                ],
              },
            ],
          },
        }}
      />,
    );
    expect(screen.getByText('Covers 2 earlier periods')).toBeInTheDocument();
    expect(screen.getByText('Priya Shah: sent')).toBeInTheDocument();
    expect(screen.getByText('Marco Rossi: may not filter by this audience')).toBeInTheDocument();
    expect(await axeViolations(container)).toEqual([]);
  });
});
