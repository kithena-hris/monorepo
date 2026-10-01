import { TooltipProvider } from '@reach/ui';
import { render as mount, screen, within } from '@testing-library/react';
import type { ReactElement } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { axeViolations } from '../test/axe';
import { fast } from '../test/user';
import { Profile, type ProfileState } from '../profile/profile';
import { SectionForm } from '../record/section-form';
import type { PendingValue, RecordSection } from '../record/model';
import { Approvals, type ApprovalItem } from './approvals';

const pending: PendingValue = {
  id: 'c1',
  key: 'iban',
  label: 'IBAN',
  kind: 'value',
  value: { last4: '1332' },
  effectiveFrom: '2026-09-22',
  requestedAt: '2026-09-22T09:00:00.000Z',
  expiresAt: '2026-09-29T09:00:00.000Z',
  requestedBy: 'You',
  reason: null,
  mine: true,
  canDecide: false,
};

const item: ApprovalItem = {
  ...pending,
  personId: 'p1',
  name: 'Lucía Ortega',
  requestedBy: 'Lucía Ortega',
  mine: false,
  canDecide: true,
  readable: true,
  current: { last4: '3000' },
};

const done = () => Promise.resolve({ ok: true as const });
// The comparison bars carry tooltips, as the host provides them.
const render = (ui: ReactElement) => mount(ui, { wrapper: TooltipProvider });

describe('the approvals inbox (PEO-077)', () => {
  it('shows the value in force beside the one asked for, both masked, and marks the field', async () => {
    const { container } = render(
      <Approvals
        load={{ status: 'ready', data: { isHr: true, items: [item] } }}
        onDecide={vi.fn(done)}
        onWithdraw={vi.fn(done)}
      />,
    );
    expect(await axeViolations(container)).toEqual([]);
    // Her change, open beside the list.
    const row = screen.getByRole('region', { name: /Lucía Ortega/ });
    expect(within(row).getByText('•••• 3000')).toBeInTheDocument();
    expect(within(row).getByText('•••• 1332')).toBeInTheDocument();
  });

  it('approves with a note, and offers nothing to decide on one’s own', async () => {
    const onDecide = vi.fn(done);
    render(
      <Approvals
        load={{
          status: 'ready',
          data: {
            isHr: true,
            items: [item, { ...item, id: 'c2', mine: true, canDecide: false, name: 'Me' }],
          },
        }}
        onDecide={onDecide}
        onWithdraw={vi.fn(done)}
      />,
    );
    const user = fast();
    // Their own change is under I asked, with nothing to decide on it.
    await user.click(screen.getByRole('tab', { name: /I asked/ }));
    expect(screen.queryByRole('button', { name: /Approve the change to Me's/ })).toBeNull();
    expect(screen.getByText(/Another HR member must approve your change/)).toBeInTheDocument();
    await user.click(screen.getByRole('tab', { name: /Waiting for me/ }));
    await user.type(screen.getByLabelText('Note'), 'Checked against the form');
    await user.click(screen.getByRole('button', { name: /Approve the change to Lucía Ortega's/ }));
    expect(onDecide).toHaveBeenCalledWith('c1', true, 'Checked against the form');
  });

  it('lets a requester no other HR member can approve for approve their own change, only after a dialog says what that means', async () => {
    const onSelfApprove = vi.fn(done);
    const onDecide = vi.fn(done);
    const { container } = render(
      <Approvals
        load={{
          status: 'ready',
          data: {
            isHr: true,
            items: [
              { ...item, name: 'Priya Shah', mine: true, canDecide: false, canSelfApprove: true },
            ],
          },
        }}
        onDecide={onDecide}
        onWithdraw={vi.fn(done)}
        onSelfApprove={onSelfApprove}
      />,
    );
    expect(await axeViolations(container)).toEqual([]);
    expect(screen.queryByText(/Another HR member must approve your change/)).toBeNull();
    const user = fast();
    await user.click(
      screen.getByRole('button', { name: "Approve the change to Priya Shah's IBAN yourself" }),
    );
    const dialog = screen.getByRole('dialog');
    expect(
      within(dialog).getByText(/No other HR member can approve this change/),
    ).toBeInTheDocument();
    expect(
      within(dialog).getByText(
        /audit log will show you approved your own change because no one else could/,
      ),
    ).toBeInTheDocument();
    expect(await axeViolations(document.body)).toEqual([]);
    expect(onSelfApprove).not.toHaveBeenCalled();
    await user.click(within(dialog).getByRole('button', { name: 'Approve it myself' }));
    expect(onSelfApprove).toHaveBeenCalledWith('c1', null);
    expect(onDecide).not.toHaveBeenCalled();
  });

  it('shows a doubted identifier as awaiting its review, with the findings, and offers no approval', async () => {
    const { container } = render(
      <Approvals
        load={{
          status: 'ready',
          data: {
            isHr: true,
            items: [
              {
                ...item,
                key: 'es_nif',
                label: 'NIF / NIE',
                awaitingReview: true,
                findings: [
                  {
                    level: 'mismatch',
                    code: 'check_mismatch',
                    message: 'The control letter does not compute.',
                  },
                ],
              },
            ],
          },
        }}
        onDecide={vi.fn(done)}
        onWithdraw={vi.fn(done)}
        onSelfApprove={vi.fn(done)}
      />,
    );
    expect(await axeViolations(container)).toEqual([]);
    // Her change, open beside the list.
    const row = screen.getByRole('region', { name: /Lucía Ortega/ });
    expect(within(row).getByText('Awaiting identifier review')).toBeInTheDocument();
    expect(within(row).queryByText('Pending approval')).toBeNull();
    expect(within(row).getByText('The control letter does not compute.')).toBeInTheDocument();
    expect(within(row).queryByRole('button', { name: /^Approve/ })).toBeNull();
    expect(within(row).getByRole('button', { name: /^Reject/ })).toBeInTheDocument();
  });

  it('lets a requester withdraw their own', async () => {
    const onWithdraw = vi.fn(done);
    render(
      <Approvals
        load={{
          status: 'ready',
          data: { isHr: false, items: [{ ...item, mine: true, canDecide: false }] },
        }}
        onDecide={vi.fn(done)}
        onWithdraw={onWithdraw}
      />,
    );
    await fast().click(screen.getByRole('button', { name: /Withdraw the change/ }));
    expect(onWithdraw).toHaveBeenCalledWith('c1');
  });
});

const section: RecordSection = {
  key: 'pay',
  label: 'Pay',
  visibility: ['self', 'hr'],
  fields: [
    {
      key: 'iban',
      label: 'IBAN',
      description: null,
      dataType: 'bank_account',
      options: [],
      required: false,
      readOnly: false,
      sensitive: true,
    },
  ],
};

describe('a sensitive field on a record (PEO-077)', () => {
  it('is marked on the profile, and its pending value is shown apart from the value in force', async () => {
    const state: ProfileState = {
      person: { name: 'Lucía Ortega', summary: null, avatarUrl: null, missing: null },
      sections: [{ ...section, readsLogged: false }],
      values: { iban: { last4: '3000' } },
      pending: [pending],
    };
    const onWithdraw = vi.fn(done);
    const { container } = render(
      <Profile
        load={{ status: 'ready', data: state }}
        onSave={vi.fn(done)}
        onWithdraw={onWithdraw}
      />,
    );
    expect(await axeViolations(container)).toEqual([]);
    expect(screen.getByText('Sensitive')).toBeInTheDocument();
    expect(screen.getByText('•••• 3000')).toBeInTheDocument();
    expect(screen.getByText('Pending approval')).toBeInTheDocument();
    expect(screen.getByText('•••• 1332')).toBeInTheDocument();
    await fast().click(screen.getByRole('button', { name: 'Withdraw the change to IBAN' }));
    expect(onWithdraw).toHaveBeenCalledWith('c1');
  });

  it('offers a requester no other HR member can approve for, on the record, to approve it themselves', async () => {
    const onSelfApprove = vi.fn(done);
    render(
      <Profile
        load={{
          status: 'ready',
          data: {
            person: { name: 'Priya Shah', summary: null, avatarUrl: null, missing: null },
            sections: [{ ...section, readsLogged: false }],
            values: {},
            pending: [{ ...pending, canSelfApprove: true }],
          },
        }}
        onSave={vi.fn(done)}
        onSelfApprove={onSelfApprove}
      />,
    );
    const user = fast();
    await user.click(screen.getByRole('button', { name: 'Approve the change to IBAN yourself' }));
    await user.click(
      within(screen.getByRole('dialog')).getByRole('button', { name: 'Approve it myself' }),
    );
    expect(onSelfApprove).toHaveBeenCalledWith('c1');
  });

  it('says a save went to HR for approval, and names the field in its label', async () => {
    const onSave = vi.fn(() => Promise.resolve({ ok: true as const, held: ['IBAN'] }));
    render(<SectionForm section={section} values={{}} onSave={onSave} />);
    const user = fast();
    const input = screen.getByLabelText(/IBAN/);
    expect(input).toHaveAccessibleName(/Sensitive/);
    await user.type(input, 'DE89370400440532013000');
    await user.click(screen.getByRole('button', { name: 'Save' }));
    expect(await screen.findByText('Sent to HR for approval')).toBeInTheDocument();
  });
});

describe('a doubted identifier HR could not accept (PEO-125)', () => {
  const identification: RecordSection = {
    key: 'identification',
    label: 'Identification',
    visibility: ['self', 'hr'],
    fields: [
      {
        key: 'es_nif',
        label: 'NIF / NIE',
        description: null,
        dataType: 'national_id',
        options: [],
        required: false,
        readOnly: false,
        sensitive: true,
      },
    ],
  };

  it('tells the employee why on their record, and opens the field to correct it', async () => {
    const { container } = render(
      <Profile
        load={{
          status: 'ready',
          data: {
            person: { name: 'Lucía Ortega', summary: null, avatarUrl: null, missing: null },
            sections: [{ ...identification, readsLogged: false }],
            values: {},
            reviews: [
              {
                key: 'es_nif',
                label: 'NIF / NIE',
                state: 'sent_back',
                findings: [
                  {
                    level: 'mismatch',
                    code: 'check_mismatch',
                    message: 'The control letter does not compute.',
                  },
                ],
                note: 'The letter on your card is Z',
              },
            ],
          },
        }}
        onSave={vi.fn(done)}
      />,
    );
    expect(await axeViolations(container)).toEqual([]);
    expect(
      screen.getByText(/The letter on your card is Z\. Please correct it\./),
    ).toBeInTheDocument();
    expect(screen.getByText('HR could not accept your NIF / NIE')).toBeInTheDocument();
    await fast().click(screen.getByRole('button', { name: 'Correct NIF / NIE' }));
    expect(screen.getByRole('form', { name: 'Identification' })).toBeInTheDocument();
  });

  it('lists the changes for HR, one open beside the list, and the ones they asked apart', async () => {
    const user = fast();
    render(
      <Approvals
        load={{
          status: 'ready',
          data: {
            isHr: true,
            items: [
              item,
              { ...item, id: 'second', name: 'Tom Fischer', personId: 'p2' },
              { ...item, id: 'mine', name: 'Adam Novak', mine: true, canDecide: false },
            ],
          },
        }}
        onDecide={vi.fn(done)}
        onWithdraw={vi.fn(done)}
      />,
    );
    expect(screen.getByRole('region', { name: /Lucía Ortega/ })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /^Tom Fischer/ }));
    expect(screen.getByRole('region', { name: /Tom Fischer/ })).toBeInTheDocument();
    await user.click(screen.getByRole('tab', { name: /I asked/ }));
    expect(screen.getByRole('region', { name: /Adam Novak/ })).toBeInTheDocument();
  });
});

describe('the approvals tab, in the address', () => {
  it('opens on the tab a link named, and hands a chosen one to the host', async () => {
    const user = fast();
    const onTabChange = vi.fn();
    render(
      <Approvals
        load={{
          status: 'ready',
          data: {
            isHr: true,
            items: [item, { ...item, id: 'c2', mine: true, canDecide: false, name: 'Me' }],
          },
        }}
        onDecide={vi.fn(done)}
        onWithdraw={vi.fn(done)}
        tab="asked"
        onTabChange={onTabChange}
      />,
    );
    expect(screen.getByRole('tab', { name: /I asked/ })).toHaveAttribute('aria-selected', 'true');
    await user.click(screen.getByRole('tab', { name: /Waiting for me/ }));
    expect(onTabChange).toHaveBeenCalledWith('mine');
  });
});

describe('a flagged approval (design AI7)', () => {
  const tom: ApprovalItem = {
    ...item,
    id: 't1',
    personId: 'p9',
    name: 'Tom Fischer',
    key: 'base_salary',
    label: 'Base salary',
    value: { amountMinor: '8400000', currency: 'EUR' },
    current: { amountMinor: '6100000', currency: 'EUR' },
    effectiveFrom: '2026-10-01',
    requestedBy: 'Nora Becker',
    flags: [
      {
        code: 'raise',
        title: 'A 38% raise',
        detail: 'Sales raises this year had a median of 4%, and the largest was 12%.',
      },
      {
        code: 'band',
        title: 'Above the band',
        detail: '€84k is over the top of the Account executive L3 band (€62k–€78k).',
      },
    ],
    comparisons: [
      { label: 'This change', percent: '38', highlight: true },
      { label: 'Sales median', percent: '4', highlight: false },
      { label: 'Largest in Sales', percent: '12', highlight: false },
    ],
    flagNote:
      'This might be fine: a promotion would explain both. Check the reason before you decide.',
    flagSummary: 'A 38% raise, above the band',
    canAsk: true,
    canMark: true,
  };
  const data = { isHr: true, items: [tom, { ...item, id: 'c2', name: 'Rui Dias' }] };

  it('explains itself with the numbers it compared against, and an honest note', async () => {
    const { container } = render(
      <Approvals load={{ status: 'ready', data }} onDecide={vi.fn(done)} onWithdraw={vi.fn(done)} />,
    );
    expect(await axeViolations(container)).toEqual([]);
    const list = screen.getByRole('list', { name: 'Changes waiting for a decision' });
    // The row says why before it is opened, and what changes.
    expect(within(list).getByText('A 38% raise, above the band')).toBeInTheDocument();
    expect(within(list).getByText('Base salary €61k → €84k · from 1 Oct')).toBeInTheDocument();
    expect(within(list).getAllByText('Unusual')).toHaveLength(1);
    const detail = screen.getByRole('region', { name: /Tom Fischer/ });
    expect(within(detail).getByRole('heading', { name: 'Why this is flagged' })).toBeInTheDocument();
    expect(within(detail).getByText('A 38% raise')).toBeInTheDocument();
    expect(
      within(detail).getByText('Sales raises this year had a median of 4%, and the largest was 12%.'),
    ).toBeInTheDocument();
    expect(within(detail).getByText(/a promotion would explain both/)).toBeInTheDocument();
    expect(
      within(detail).getByText('Flags never approve or reject anything. They only ask you to look twice.'),
    ).toBeInTheDocument();
    expect(within(detail).getByText('Required when you approve something flagged.')).toBeInTheDocument();
  });

  it('asks for a note before approving it', async () => {
    const onDecide = vi.fn(done);
    render(<Approvals load={{ status: 'ready', data }} onDecide={onDecide} onWithdraw={vi.fn(done)} />);
    const user = fast();
    const approve = screen.getByRole('button', { name: /with note$/ });
    expect(approve).toHaveTextContent('Approve with note');
    await user.click(approve);
    expect(onDecide).not.toHaveBeenCalled();
    expect(screen.getByText('Add a note to approve something flagged.')).toBeInTheDocument();
    await user.type(screen.getByLabelText('Note'), 'Promotion to Sales manager');
    await user.click(approve);
    expect(onDecide).toHaveBeenCalledWith('t1', true, 'Promotion to Sales manager');
  });

  it('rejects without one, marks it not unusual, and asks the requester', async () => {
    const onDecide = vi.fn(done);
    const onMarkNotUnusual = vi.fn(done);
    const onAsk = vi.fn(done);
    render(
      <Approvals
        load={{ status: 'ready', data }}
        onDecide={onDecide}
        onWithdraw={vi.fn(done)}
        onMarkNotUnusual={onMarkNotUnusual}
        onAsk={onAsk}
      />,
    );
    const user = fast();
    await user.click(screen.getByRole('button', { name: 'Not unusual' }));
    expect(onMarkNotUnusual).toHaveBeenCalledWith('t1');
    await user.click(screen.getByRole('button', { name: 'Ask Nora' }));
    const dialog = screen.getByRole('dialog', { name: 'Ask Nora about this change' });
    expect(await axeViolations(document.body)).toEqual([]);
    await user.type(within(dialog).getByLabelText('Question'), 'Is this the promotion?');
    await user.click(within(dialog).getByRole('button', { name: 'Send question' }));
    expect(onAsk).toHaveBeenCalledWith('t1', 'Is this the promotion?');
    await user.click(screen.getByRole('button', { name: /Reject the change to Tom Fischer's/ }));
    expect(onDecide).toHaveBeenCalledWith('t1', false, null);
  });

  it('lists the flagged changes, and what gets flagged, on the Flagged tab (AI8)', async () => {
    const onSetCheck = vi.fn(done);
    const onTabChange = vi.fn();
    const { container } = render(
      <Approvals
        load={{
          status: 'ready',
          data: {
            ...data,
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
        onDecide={vi.fn(done)}
        onWithdraw={vi.fn(done)}
        tab="flagged"
        onTabChange={onTabChange}
        onSetCheck={onSetCheck}
      />,
    );
    expect(await axeViolations(container)).toEqual([]);
    expect(screen.getByRole('tab', { name: /Flagged/ })).toHaveTextContent('1');
    const list = screen.getByRole('list', { name: 'Changes waiting for a decision' });
    expect(within(list).queryByText('Rui Dias')).toBeNull();
    expect(screen.getByRole('heading', { name: 'What Kithena checks' })).toBeInTheDocument();
    expect(screen.getByText('11')).toBeInTheDocument();
    expect(screen.getByText('Marked not unusual')).toBeInTheDocument();
    expect(screen.getByText('What it never does')).toBeInTheDocument();
    await fast().click(screen.getByRole('switch', { name: 'Requested at an unusual time' }));
    expect(onSetCheck).toHaveBeenCalledWith('unusual_time', true);
  });

  it('shows HR the checks without the switches, unless they are an administrator', () => {
    render(
      <Approvals
        load={{
          status: 'ready',
          data: {
            ...data,
            canTune: false,
            checks: [{ code: 'raise', title: 'Raise much bigger than usual', detail: 'x', on: true }],
            last90: { flagged: 0, rejected: 0, marked: 0 },
          },
        }}
        onDecide={vi.fn(done)}
        onWithdraw={vi.fn(done)}
        tab="flagged"
        onTabChange={vi.fn()}
        onSetCheck={vi.fn(done)}
      />,
    );
    expect(screen.getByRole('switch', { name: 'Raise much bigger than usual' })).toBeDisabled();
    expect(screen.getByText('A People administrator switches these.')).toBeInTheDocument();
  });

  it('opens the change a link named, and hands a chosen one to the host', async () => {
    const onChangeOpen = vi.fn();
    render(
      <Approvals
        load={{ status: 'ready', data }}
        onDecide={vi.fn(done)}
        onWithdraw={vi.fn(done)}
        change="c2"
        onChangeOpen={onChangeOpen}
      />,
    );
    expect(screen.getByRole('region', { name: /Rui Dias/ })).toBeInTheDocument();
    await fast().click(screen.getByRole('button', { name: /^Tom Fischer/ }));
    expect(onChangeOpen).toHaveBeenCalledWith('t1');
  });
});

describe('a question about a change', () => {
  it('is answered by the requester, once, beside their change', async () => {
    const onAnswer = vi.fn(done);
    const { container } = render(
      <Approvals
        load={{
          status: 'ready',
          data: {
            isHr: false,
            items: [
              {
                ...item,
                mine: true,
                canDecide: false,
                questions: [
                  {
                    id: 'q1',
                    question: 'Is this the promotion?',
                    askedBy: 'Sofia Lindqvist',
                    askedAt: '2026-09-22T10:00:00.000Z',
                    answer: null,
                    answeredAt: null,
                    canAnswer: true,
                  },
                ],
              },
            ],
          },
        }}
        onDecide={vi.fn(done)}
        onWithdraw={vi.fn(done)}
        onAnswer={onAnswer}
      />,
    );
    expect(await axeViolations(container)).toEqual([]);
    expect(screen.getByText(/Sofia Lindqvist asked: “Is this the promotion\?”/)).toBeInTheDocument();
    const user = fast();
    await user.type(screen.getByLabelText('Your answer'), 'Yes, from 1 October');
    await user.click(screen.getByRole('button', { name: 'Send answer' }));
    expect(onAnswer).toHaveBeenCalledWith('q1', 'Yes, from 1 October');
  });
});

describe('the Decided tab', () => {
  it('shows what was decided, by whom, with the note and what flagged it', () => {
    render(
      <Approvals
        load={{
          status: 'ready',
          data: {
            isHr: true,
            items: [],
            decided: [
              {
                ...item,
                canDecide: false,
                state: 'approved',
                decidedBy: 'Sofia Lindqvist',
                decidedAt: '2026-09-23T09:00:00.000Z',
                note: 'Promotion to Sales manager',
                flags: [{ code: 'raise', title: 'Raise much bigger than usual', detail: '' }],
                flagSummary: 'Raise much bigger than usual',
              },
            ],
          },
        }}
        onDecide={vi.fn(done)}
        onWithdraw={vi.fn(done)}
        tab="decided"
        onTabChange={vi.fn()}
      />,
    );
    const detail = screen.getByRole('region', { name: /Lucía Ortega/ });
    expect(within(detail).getByText(/approved by Sofia Lindqvist/)).toBeInTheDocument();
    expect(within(detail).getByText('Note: “Promotion to Sales manager”')).toBeInTheDocument();
    expect(within(detail).getByText(/Flagged when decided: Raise much bigger than usual/)).toBeInTheDocument();
    expect(within(detail).queryByRole('button', { name: /Approve/ })).toBeNull();
  });
});
