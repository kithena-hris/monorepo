import { TooltipProvider } from '@reach/ui';
import { render as mount, screen, within } from '@testing-library/react';
import type { ReactElement } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { axeViolations } from '../test/axe';
import { fast } from '../test/user';
import { Profile, type ProfileState } from '../profile/profile';
import { SectionForm } from '../record/section-form';
import type { PendingValue, RecordSection } from '../record/model';
import { renderReview } from '../review/review.fixture';
import type { ApprovalItem, ApprovalsState } from './approvals';

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

/** Review with only changes in it: HR's, or an employee's own. */
const changes = (data: ApprovalsState, props: Parameters<typeof renderReview>[1] = {}) =>
  renderReview({ approvals: data, roles: { hr: data.isHr, admin: false, finance: false } }, props);

describe('changes in Review (PEO-077)', () => {
  it('shows the value in force beside the one asked for, both masked, and marks the field', async () => {
    const { container } = changes({ isHr: true, items: [item] });
    expect(await axeViolations(container)).toEqual([]);
    // Her change, open beside the list.
    const row = screen.getByRole('region', { name: /Lucía Ortega/ });
    expect(within(row).getByText('•••• 3000')).toBeInTheDocument();
    expect(within(row).getByText('•••• 1332')).toBeInTheDocument();
  });

  it('approves with a note, and offers nothing to decide on one’s own', async () => {
    const onDecide = vi.fn(done);
    const data = {
      isHr: true,
      items: [item, { ...item, id: 'c2', mine: true, canDecide: false, name: 'Me' }],
    };
    // Their own change is under I asked, with nothing to decide on it.
    const asked = changes(data, { tab: 'asked' });
    expect(screen.queryByRole('button', { name: /Approve the change to Me's/ })).toBeNull();
    expect(screen.getByText(/Another HR member must approve your change/)).toBeInTheDocument();
    asked.unmount();
    changes(data, { onDecide });
    const user = fast();
    await user.type(screen.getByLabelText('Note'), 'Checked against the form');
    await user.click(screen.getByRole('button', { name: /Approve the change to Lucía Ortega's/ }));
    expect(onDecide).toHaveBeenCalledWith('c1', true, 'Checked against the form');
  });

  it('lets a requester no other HR member can approve for approve their own change, only after a dialog says what that means', async () => {
    const onSelfApprove = vi.fn(done);
    const onDecide = vi.fn(done);
    const { container } = changes(
      {
        isHr: true,
        items: [
          { ...item, name: 'Priya Shah', mine: true, canDecide: false, canSelfApprove: true },
        ],
      },
      { onDecide, onSelfApprove },
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
    const { container } = changes(
      {
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
      { onSelfApprove: vi.fn(done) },
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
    changes({ isHr: false, items: [{ ...item, mine: true, canDecide: false }] }, { onWithdraw });
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
    const data = {
      isHr: true,
      items: [
        { ...item, requestedAt: '2026-09-23T09:00:00.000Z' },
        { ...item, id: 'second', name: 'Tom Fischer', personId: 'p2' },
        { ...item, id: 'mine', name: 'Adam Novak', mine: true, canDecide: false },
      ],
    };
    const waiting = changes(data);
    expect(screen.getByRole('region', { name: /Lucía Ortega/ })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /Tom Fischer/ }));
    expect(screen.getByRole('region', { name: /Tom Fischer/ })).toBeInTheDocument();
    waiting.unmount();
    changes(data, { tab: 'asked' });
    expect(screen.getByRole('region', { name: /Adam Novak/ })).toBeInTheDocument();
  });
});

describe('Review’s chip, in the address', () => {
  it('opens on the chip a link named, and hands a chosen one to the host', async () => {
    const onKindChange = vi.fn();
    changes({ isHr: true, items: [item] }, { kind: 'changes', onKindChange });
    expect(screen.getByRole('radio', { name: /Changes/ })).toHaveAttribute('aria-checked', 'true');
    await fast().click(screen.getByRole('radio', { name: /All/ }));
    expect(onKindChange).toHaveBeenCalledWith(null);
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
    const { container } = changes(data);
    expect(await axeViolations(container)).toEqual([]);
    const list = screen.getByRole('list', { name: 'Waiting for a decision' });
    // The row says why before it is opened, and what changes.
    expect(within(list).getByText('A 38% raise, above the band')).toBeInTheDocument();
    expect(within(list).getByText('Base salary €61k → €84k · from 1 Oct')).toBeInTheDocument();
    const detail = screen.getByRole('region', { name: /Tom Fischer/ });
    expect(
      within(detail).getByRole('heading', { name: 'Why this is flagged' }),
    ).toBeInTheDocument();
    expect(within(detail).getByText('A 38% raise')).toBeInTheDocument();
    expect(
      within(detail).getByText(
        'Sales raises this year had a median of 4%, and the largest was 12%.',
      ),
    ).toBeInTheDocument();
    expect(within(detail).getByText(/a promotion would explain both/)).toBeInTheDocument();
    expect(
      within(detail).getByText(
        'Flags never approve or reject anything. They only ask you to look twice.',
      ),
    ).toBeInTheDocument();
    expect(
      within(detail).getByText('Required when you approve something flagged.'),
    ).toBeInTheDocument();
  });

  it('asks for a note before approving it', async () => {
    const onDecide = vi.fn(done);
    changes(data, { onDecide });
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
    changes(data, { onDecide, onMarkNotUnusual, onAsk });
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
    const { container } = changes(
      {
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
          {
            code: 'manager_pay',
            title: 'Pay that only a person’s manager can see',
            detail: 'Count it in Flagged for the managers who can',
            on: true,
          },
        ],
        last90: { flagged: 11, rejected: 3, marked: 6 },
      },
      { tab: 'flagged', onSetCheck },
    );
    expect(await axeViolations(container)).toEqual([]);
    const list = screen.getByRole('list', { name: 'Waiting for a decision' });
    expect(within(list).getByText('Tom Fischer')).toBeInTheDocument();
    expect(within(list).queryByText('Rui Dias')).toBeNull();
    expect(screen.getByRole('heading', { name: 'What Kithena checks' })).toBeInTheDocument();
    expect(screen.getByText('11')).toBeInTheDocument();
    expect(screen.getByText('Marked not unusual')).toBeInTheDocument();
    expect(screen.getByText('What it never does')).toBeInTheDocument();
    await fast().click(screen.getByRole('switch', { name: 'Requested at an unusual time' }));
    expect(onSetCheck).toHaveBeenCalledWith('unusual_time', true);
    // The setting beside the checks, switched the same way.
    expect(screen.getByText('Count it in Flagged for the managers who can')).toBeInTheDocument();
    await fast().click(
      screen.getByRole('switch', { name: 'Pay that only a person’s manager can see' }),
    );
    expect(onSetCheck).toHaveBeenCalledWith('manager_pay', false);
  });

  it('shows HR the checks without the switches, unless they are an administrator', () => {
    changes(
      {
        ...data,
        canTune: false,
        checks: [
          { code: 'raise', title: 'Raise much bigger than usual', detail: 'x', on: true },
          { code: 'manager_pay', title: 'Pay that only a person’s manager can see', detail: 'x', on: true },
        ],
        last90: { flagged: 0, rejected: 0, marked: 0 },
      },
      { tab: 'flagged', onSetCheck: vi.fn(done) },
    );
    expect(screen.getByRole('switch', { name: 'Raise much bigger than usual' })).toBeDisabled();
    expect(
      screen.getByRole('switch', { name: 'Pay that only a person’s manager can see' }),
    ).toBeDisabled();
    expect(screen.getByText('A People administrator switches these.')).toBeInTheDocument();
  });

  it('opens the change a link named, and hands a chosen one to the host', async () => {
    const onItemChange = vi.fn();
    changes(data, { item: 'change-c2', onItemChange });
    expect(screen.getByRole('region', { name: /Rui Dias/ })).toBeInTheDocument();
    await fast().click(screen.getByRole('button', { name: /Tom Fischer/ }));
    expect(onItemChange).toHaveBeenCalledWith('change-t1');
  });
});

describe('a question about a change', () => {
  it('is answered by the requester, once, beside their change', async () => {
    const onAnswer = vi.fn(done);
    const { container } = changes(
      {
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
      { onAnswer },
    );
    expect(await axeViolations(container)).toEqual([]);
    expect(
      screen.getByText(/Sofia Lindqvist asked: “Is this the promotion\?”/),
    ).toBeInTheDocument();
    const user = fast();
    await user.type(screen.getByLabelText('Your answer'), 'Yes, from 1 October');
    await user.click(screen.getByRole('button', { name: 'Send answer' }));
    expect(onAnswer).toHaveBeenCalledWith('q1', 'Yes, from 1 October');
  });
});

describe('the Decided tab', () => {
  const decided: ApprovalItem = {
    ...item,
    canDecide: false,
    state: 'approved',
    decidedBy: 'Sofia Lindqvist',
    decidedAt: '2026-09-23T09:00:00.000Z',
    note: 'Promotion to Sales manager',
    flags: [{ code: 'raise', title: 'Raise much bigger than usual', detail: '' }],
    flagSummary: 'Raise much bigger than usual',
  };

  it('shows HR what was decided, by whom, with the note and what flagged it (E9)', () => {
    changes({ isHr: true, items: [], decided: [decided] }, { tab: 'decided' });
    const table = screen.getByRole('table', { name: 'Decided in the last 90 days' });
    expect(within(table).getByText('Lucía Ortega')).toBeInTheDocument();
    expect(within(table).getByText('Sofia Lindqvist')).toBeInTheDocument();
    expect(within(table).getByText('Approved')).toBeInTheDocument();
    expect(
      within(table).getByText(/Flagged when decided: Raise much bigger than usual/),
    ).toBeInTheDocument();
    expect(within(table).getByText(/Note: “Promotion to Sales manager”/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Approve/ })).toBeNull();
  });

  it('shows an employee their own decided changes the same way', () => {
    changes({ isHr: false, items: [], decided: [{ ...decided, mine: true }] }, { tab: 'decided' });
    const table = screen.getByRole('table', { name: 'Decided in the last 90 days' });
    expect(within(table).getByText('Approved')).toBeInTheDocument();
    expect(within(table).getByText('Sofia Lindqvist')).toBeInTheDocument();
  });
});
