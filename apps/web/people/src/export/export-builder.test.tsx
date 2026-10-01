import { render, screen, within } from '@testing-library/react';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { fast } from '../test/user';
import { axeViolations } from '../test/axe';
import {
  ExportBuilder,
  suggestionsFor,
  type AddressPatch,
  type ExportAddress,
  type ExportBuilderProps,
  type ExportState,
} from './export-builder';
import type { ExportRecord, ShareRequest } from './export-done';
import type { SendPreview } from './send-panel';

const SOFIA = '00000000-0000-4000-8000-0000000000fe';
const NORA = '00000000-0000-4000-8000-0000000000fd';
const ME = '00000000-0000-4000-8000-0000000000ff';

/** What HR reads, and what a manager's profile view leaves them. */
const asHr: ExportState = {
  today: '2026-10-01',
  who: [
    { value: 'everyone', label: 'Everybody you can see', count: 412 },
    {
      value: 'conditions',
      label: 'Everybody whose team is Engineering and location is Madrid',
      count: 148,
    },
  ],
  sections: [
    {
      key: 'personal',
      label: 'Personal',
      fields: [
        { key: 'given_name', label: 'Given name' },
        { key: 'family_name', label: 'Family name' },
      ],
    },
    {
      key: 'job',
      label: 'Job',
      fields: [
        { key: 'employee_number', label: 'Employee number' },
        { key: 'job_title', label: 'Job title' },
      ],
    },
    {
      key: 'pay',
      label: 'Pay',
      fields: [
        { key: 'base_salary', label: 'Base salary' },
        { key: 'bonus', label: 'Bonus' },
      ],
    },
  ],
};
const asManager: ExportState = {
  today: '2026-10-01',
  who: [{ value: 'team', label: 'My team', count: 8 }],
  sections: [{ key: 'work', label: 'Work', fields: [{ key: 'work_model', label: 'Work model' }] }],
};

const preview = (over: Partial<SendPreview> = {}): SendPreview => ({
  recipient: { accountId: SOFIA, name: 'Sofia Lindqvist' },
  candidates: [
    { accountId: NORA, name: 'Nora Becker' },
    { accountId: SOFIA, name: 'Sofia Lindqvist' },
  ],
  people: 148,
  sensitive: ['base_salary'],
  gap: { fields: [{ key: 'base_salary', label: 'Base salary', people: 148 }], unlisted: 0 },
  approvers: [{ accountId: NORA, name: 'Nora Becker' }],
  tooLarge: false,
  emailed: true,
  canSchedule: true,
  self: ME,
  ...over,
});

const described: ExportAddress = {
  q: 'salaries for everyone in Madrid engineering as of 30 June, for Finance’s 2027 budget',
  read: 'rules',
  who: 'conditions',
  fields: ['given_name', 'family_name', 'job_title', 'base_salary'],
  asOf: '2026-06-30',
  format: 'xlsx',
  reason: 'Budget planning for 2027, requested by Finance',
};

/** The address as the host keeps it: a patch of strings, read back into the page's state. */
function patched(address: ExportAddress, patch: AddressPatch): ExportAddress {
  const next: Record<string, unknown> = { ...address };
  for (const [k, v] of Object.entries(patch)) {
    if (k === 'fields') next[k] = v === null ? null : v.split(',');
    else if (k === 'photos') next[k] = v === 'true';
    else if (k === 'hand') next[k] = v === '1';
    else next[k] = v;
  }
  return next;
}

function Page(
  props: Omit<ExportBuilderProps, 'address' | 'onAddress'> & {
    start?: ExportAddress;
    seen?: (a: ExportAddress) => void;
  },
) {
  const { start = {}, seen, ...rest } = props;
  const [address, setAddress] = useState(start);
  return (
    <ExportBuilder
      {...rest}
      address={address}
      onAddress={(patch) => {
        const next = patched(address, patch);
        seen?.(next);
        setAddress(next);
      }}
    />
  );
}

const ok = () => Promise.resolve({ ok: true as const });

describe('Export from one sentence (AI13)', () => {
  it('shows what was built, the access problem before the file exists, and asks the right person', async () => {
    const user = fast();
    const onShare = vi.fn(ok);
    const onExport = vi.fn(ok);
    const { container } = render(
      <Page
        load={{ status: 'ready', data: { ...asHr, preview: preview() } }}
        start={described}
        onExport={onExport}
        onShare={onShare}
        onDescribe={vi.fn()}
      />,
    );
    expect(screen.getByRole('heading', { name: 'Here’s the export I’ve built' })).toBeTruthy();
    expect(screen.getByRole('searchbox', { name: 'Describe the export' })).toHaveValue(described.q);
    // Who, fields, as of, format; and the reason, for the audit log.
    expect(
      screen.getAllByText('Everybody whose team is Engineering and location is Madrid'),
    ).toHaveLength(1);
    expect(screen.getAllByText('148 people').length).toBeGreaterThan(0);
    expect(screen.getAllByText('30 June 2026').length).toBeGreaterThan(0);
    expect(
      screen.getAllByText('Budget planning for 2027, requested by Finance').length,
    ).toBeGreaterThan(0);
    expect(screen.getByText('Base salary needs Sofia’s access')).toBeTruthy();
    expect(
      screen.getByText(/waits for Nora Becker to approve sending this one file/u),
    ).toBeTruthy();

    expect(screen.getByRole('radio', { name: 'Send to Sofia' })).toHaveAttribute(
      'data-state',
      'on',
    );
    expect(
      screen.getByText('Sofia gets a link that expires in 7 days and only opens for Sofia.'),
    ).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Send when Nora approves' }));
    expect(onShare).toHaveBeenCalledWith(
      {
        who: 'conditions',
        fields: ['given_name', 'family_name', 'job_title', 'base_salary'],
        asOf: '2026-06-30',
        format: 'xlsx',
        reason: 'Budget planning for 2027, requested by Finance',
      },
      SOFIA,
    );
    await user.click(screen.getByRole('button', { name: 'Download now (without base salary)' }));
    expect(onExport).toHaveBeenCalledWith(
      expect.objectContaining({ fields: ['given_name', 'family_name', 'job_title'] }),
    );
    expect(await axeViolations(container)).toEqual([]);
  });

  it('sends at once to somebody who could read all of it', async () => {
    const user = fast();
    const onShare = vi.fn(ok);
    render(
      <Page
        load={{
          status: 'ready',
          data: { ...asHr, preview: preview({ gap: null, approvers: [] }) },
        }}
        start={described}
        onExport={vi.fn()}
        onShare={onShare}
      />,
    );
    expect(screen.queryByText(/needs Sofia’s access/u)).toBeNull();
    expect(screen.queryByRole('button', { name: /Download now/u })).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Send to Sofia' }));
    expect(onShare).toHaveBeenCalledWith(expect.objectContaining({ format: 'xlsx' }), SOFIA);
  });

  it('cannot go anywhere without a reason, and the reason is edited in place', async () => {
    const user = fast();
    const seen = vi.fn();
    render(
      <Page
        load={{ status: 'ready', data: { ...asHr, preview: preview({ recipient: null }) } }}
        start={{ ...described, reason: null }}
        onExport={vi.fn()}
        onShare={vi.fn()}
        seen={seen}
      />,
    );
    expect(screen.getByRole('button', { name: 'Download Excel' })).toBeDisabled();
    await user.type(
      screen.getByRole('textbox', { name: /Reason, for the audit log/u }),
      'Payroll check',
    );
    await user.click(screen.getByRole('button', { name: 'Save reason' }));
    expect(seen).toHaveBeenLastCalledWith(expect.objectContaining({ reason: 'Payroll check' }));
    expect(screen.getByRole('button', { name: 'Download Excel' })).toBeEnabled();
  });

  it('turns a suggestion chip into the choices, and adjusts by hand in the address', async () => {
    const user = fast();
    const seen = vi.fn();
    render(
      <Page
        load={{ status: 'ready', data: { ...asHr, preview: preview() } }}
        start={described}
        onExport={vi.fn()}
        seen={seen}
      />,
    );
    const chips = within(screen.getByRole('group', { name: 'Suggestions' }));
    await user.click(chips.getByRole('button', { name: 'Also add bonus' }));
    expect(seen).toHaveBeenLastCalledWith(
      expect.objectContaining({
        fields: ['given_name', 'family_name', 'job_title', 'base_salary', 'bonus'],
      }),
    );
    await user.click(chips.getByRole('button', { name: 'Mask names' }));
    expect(seen).toHaveBeenLastCalledWith(
      expect.objectContaining({
        fields: ['job_title', 'base_salary', 'bonus', 'employee_number'],
      }),
    );
    await user.click(screen.getByRole('button', { name: 'Adjust by hand' }));
    await user.click(screen.getByRole('radio', { name: /CSV/u }));
    expect(seen).toHaveBeenLastCalledWith(expect.objectContaining({ format: 'csv' }));
  });

  it('offers a manager only what their profile view shows, and downloads only that', async () => {
    const user = fast();
    const onExport = vi.fn(ok);
    const { container } = render(
      <Page
        load={{ status: 'ready', data: asManager }}
        start={{ reason: 'Team offsite' }}
        onExport={onExport}
      />,
    );
    for (const withheld of ['Base salary', 'Pay', 'Employee number']) {
      expect(container.textContent).not.toContain(withheld);
    }
    // Nobody to send to and no schedule for a manager: Download is all there is.
    expect(screen.queryByRole('radio', { name: /Send/u })).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Download Excel' }));
    expect(onExport).toHaveBeenCalledWith({
      who: 'team',
      fields: ['work_model'],
      asOf: '2026-10-01',
      format: 'xlsx',
      reason: 'Team offsite',
    });
    expect(await axeViolations(container)).toEqual([]);
  });

  it('schedules it monthly, to the recipient', async () => {
    const user = fast();
    const onSchedule = vi.fn(ok);
    render(
      <Page
        load={{ status: 'ready', data: { ...asHr, preview: preview() } }}
        start={{ ...described, send: 'schedule', to: SOFIA }}
        onExport={vi.fn()}
        onShare={vi.fn()}
        onSchedule={onSchedule}
      />,
    );
    expect(screen.getByText(/On the 1st of every month, Sofia gets this export/u)).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Make this a monthly schedule' }));
    expect(onSchedule).toHaveBeenCalledWith(expect.objectContaining({ format: 'xlsx' }), SOFIA);
  });

  it('has loading and error states', async () => {
    const { container, rerender } = render(
      <ExportBuilder load={{ status: 'loading' }} onExport={vi.fn()} />,
    );
    expect(screen.getByText('Loading the export builder')).toBeInTheDocument();
    rerender(<ExportBuilder load={{ status: 'error', message: 'Down' }} onExport={vi.fn()} />);
    expect(screen.getByText('Down')).toBeInTheDocument();
    expect(await axeViolations(container)).toEqual([]);
  });

  it('described in words: the host puts the plan in the address, and says who read it', async () => {
    const user = fast();
    const onDescribe = vi.fn(() =>
      Promise.resolve({
        ok: true as const,
        by: 'rules' as const,
        note: 'The assistant isn’t set up here, so People read it without the assistant.',
        notes: ['1 November 2026 is still to come, so the export is as of today.'],
      }),
    );
    render(
      <Page load={{ status: 'ready', data: asHr }} onExport={vi.fn()} onDescribe={onDescribe} />,
    );
    expect(screen.getByRole('heading', { name: 'Your export' })).toBeTruthy();
    await user.type(
      screen.getByRole('searchbox', { name: 'Describe the export' }),
      'payroll as of 1 November{Enter}',
    );
    expect(onDescribe).toHaveBeenCalledWith('payroll as of 1 November');
    expect(await screen.findByText(/is still to come/u)).toBeTruthy();
    expect(screen.getByText(/without the assistant/u)).toBeTruthy();
  });
});

describe('suggestionsFor', () => {
  it('offers one more field beside the sensitive one, names left out, and the other format', () => {
    expect(
      suggestionsFor(asHr, ['given_name', 'base_salary'], 'xlsx', ['base_salary']).map((s) => [
        s.label,
        s.patch,
      ]),
    ).toEqual([
      ['Also add bonus', { fields: 'given_name,base_salary,bonus' }],
      ['Mask names', { fields: 'base_salary,employee_number' }],
      ['As CSV', { format: 'csv' }],
    ]);
  });

  it('offers nothing it cannot do: no names to mask when names are all there is', () => {
    expect(suggestionsFor(asHr, ['given_name'], 'csv', []).map((s) => s.label)).toEqual([
      'Also add family name',
      'As Excel',
    ]);
  });
});

const record: ExportRecord = {
  id: '0199a3f0-7c1e-7d2a-9b1e-4f6a8c2d1e00',
  code: 'EXP-0199A3F0',
  status: 'completed',
  mine: true,
  requestedBy: { accountId: ME, name: 'Ada Lovelace' },
  sentTo: { accountId: SOFIA, name: 'Sofia Lindqvist' },
  openedAt: '2026-10-01T14:40:00.000Z',
  approvedBy: { accountId: NORA, name: 'Nora Becker', at: '2026-10-01T14:31:00.000Z' },
  reason: 'Budget planning for 2027',
  rowCount: 148,
  fields: ['Name', 'Job title', 'Level', 'Base salary', 'FTE', 'Cost centre'],
  sensitive: 1,
  asOf: '2026-06-30',
  format: 'xlsx',
  expiresAt: '2026-10-08T14:31:00.000Z',
  about: {
    title: 'Everybody whose team is Engineering and location is Madrid, 30 June 2026',
    paragraphs: [
      '148 people, with their name, job title, level, base salary, FTE and cost centre as they were at the end of 30 June 2026.',
      'Made by Ada Lovelace on 1 October 2026 for Sofia Lindqvist. Why: Budget planning for 2027.',
    ],
    footnote: 'Confidential · link expires 8 October 2026 · export ID EXP-0199A3F0',
  },
  keptUntil: null,
  links: [],
  now: '2026-10-01T15:00:00.000Z',
};

describe('The file explains itself (AI14)', () => {
  it('says where it went, who approved it, when it was opened, what it holds, and what was recorded', async () => {
    const user = fast();
    const onSchedule = vi.fn(ok);
    const { container } = render(
      <Page
        load={{ status: 'ready', data: { ...asHr, preview: preview(), record } }}
        start={described}
        onExport={vi.fn()}
        onSchedule={onSchedule}
      />,
    );
    expect(screen.getByRole('heading', { name: 'Sent to Sofia Lindqvist' })).toBeTruthy();
    expect(
      screen.getByText(/Nora Becker approved at \d\d:\d\d · the link opened at \d\d:\d\d/u),
    ).toBeTruthy();
    expect(screen.getByRole('heading', { name: record.about?.title ?? '' })).toBeTruthy();
    expect(screen.getByText(record.about?.footnote ?? '')).toBeTruthy();
    const recorded = within(
      screen.getByRole('heading', { name: 'Recorded' }).closest('section') ?? document.body,
    );
    expect(recorded.getByText('6, 1 sensitive')).toBeTruthy();
    expect(recorded.getByText('Nora Becker')).toBeTruthy();
    expect(recorded.getByText('No end date set yet')).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Make this a monthly schedule' }));
    expect(onSchedule).toHaveBeenCalledWith(expect.objectContaining({ format: 'xlsx' }), SOFIA);
    expect(
      await screen.findByText(/It goes on the 1st of every month at 07:00 to Sofia/u),
    ).toBeTruthy();
    expect(await axeViolations(container)).toEqual([]);
  });

  it('hands the recipient their file, and says when it has gone', () => {
    const url = 'https://api.kithena.test/v1/exports/files/x?expires=e&sig=s';
    const theirs: ExportRecord = {
      ...record,
      mine: false,
      links: [{ name: 'people-2026-10-01.xlsx', url }],
    };
    const { rerender } = render(
      <ExportBuilder
        load={{ status: 'ready', data: { ...asManager, record: theirs } }}
        onExport={vi.fn()}
      />,
    );
    expect(screen.getByRole('heading', { name: 'From Ada Lovelace' })).toBeTruthy();
    expect(screen.getByRole('link', { name: 'people-2026-10-01.xlsx' })).toHaveAttribute(
      'href',
      url,
    );
    expect(screen.queryByRole('button', { name: 'Make this a monthly schedule' })).toBeNull();
    rerender(
      <ExportBuilder
        load={{
          status: 'ready',
          data: { ...asManager, record: { ...theirs, status: 'expired', links: [] } },
        }}
        onExport={vi.fn()}
      />,
    );
    expect(screen.getByText('This export is no longer available')).toBeTruthy();
    expect(screen.queryByRole('link')).toBeNull();
  });
});

describe('A request to send, waiting (AI13 → AI14)', () => {
  const share: ShareRequest = {
    id: '0199a3f0-0000-7000-8000-000000000001',
    state: 'pending',
    requestedBy: { accountId: ME, name: 'Ada Lovelace' },
    recipient: { accountId: SOFIA, name: 'Sofia Lindqvist' },
    reason: 'Budget planning for 2027',
    requestedAt: '2026-10-01T14:00:00.000Z',
    expiresAt: '2026-10-08T14:00:00.000Z',
    decidedBy: null,
    decidedAt: null,
    note: null,
    fields: ['Name', 'Base salary'],
    gap: { fields: [{ key: 'base_salary', label: 'Base salary', people: 148 }], unlisted: 0 },
    asOf: '2026-06-30',
    format: 'xlsx',
    audience: 'Everybody whose team is Engineering and location is Madrid',
    exportId: null,
    mine: false,
    canDecide: true,
    approvers: [{ accountId: NORA, name: 'Nora Becker' }],
  };

  it('shows an administrator what it holds and what the recipient could not read, and decides it', async () => {
    const user = fast();
    const onDecide = vi.fn(ok);
    const { container } = render(
      <ExportBuilder
        load={{ status: 'ready', data: { ...asHr, share } }}
        onExport={vi.fn()}
        onDecide={onDecide}
      />,
    );
    expect(
      screen.getByRole('heading', {
        name: 'Ada Lovelace wants to send an export to Sofia Lindqvist',
      }),
    ).toBeTruthy();
    expect(screen.getByText(/Base salary for 148 people/u)).toBeTruthy();
    await user.type(screen.getByRole('textbox', { name: 'Note' }), 'For the 2027 budget only');
    await user.click(screen.getByRole('button', { name: 'Approve and send' }));
    expect(onDecide).toHaveBeenCalledWith(share.id, true, 'For the 2027 budget only');
    expect(await axeViolations(container)).toEqual([]);
  });

  it('tells the requester what it waits on, with nothing to press', () => {
    render(
      <ExportBuilder
        load={{
          status: 'ready',
          data: { ...asHr, share: { ...share, mine: true, canDecide: false } },
        }}
        onExport={vi.fn()}
        onDecide={vi.fn()}
      />,
    );
    expect(
      screen.getByRole('heading', {
        name: 'Waiting for Nora to approve sending it to Sofia Lindqvist',
      }),
    ).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Approve and send' })).toBeNull();
  });
});
