import { render, screen, within } from '@testing-library/react';
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
    const row = screen.getByRole('row', { name: /Lucía Ortega/ });
    expect(within(row).getByText('Sensitive')).toBeInTheDocument();
    expect(within(row).getByText('Pending approval')).toBeInTheDocument();
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
    expect(screen.queryByRole('button', { name: /Approve the change to Me's/ })).toBeNull();
    expect(screen.getByText(/Another HR member decides your own change/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /Approve the change to Lucía Ortega's/ }));
    await user.type(screen.getByLabelText('Note'), 'Checked against the form');
    await user.click(screen.getByRole('button', { name: 'Approve' }));
    expect(onDecide).toHaveBeenCalledWith('c1', true, 'Checked against the form');
  });

  it('lets the only HR member approve their own change, only after a dialog says what that means', async () => {
    const onSelfApprove = vi.fn(done);
    const onDecide = vi.fn(done);
    const { container } = render(
      <Approvals
        load={{
          status: 'ready',
          data: {
            isHr: true,
            items: [{ ...item, name: 'Priya Shah', mine: true, canDecide: false, canSelfApprove: true }],
          },
        }}
        onDecide={onDecide}
        onWithdraw={vi.fn(done)}
        onSelfApprove={onSelfApprove}
      />,
    );
    expect(await axeViolations(container)).toEqual([]);
    expect(screen.queryByText(/Another HR member decides your own change/)).toBeNull();
    const user = fast();
    await user.click(
      screen.getByRole('button', { name: "Approve the change to Priya Shah's IBAN yourself" }),
    );
    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByText(/no other member to approve it/)).toBeInTheDocument();
    expect(within(dialog).getByText(/audit trail will show that you approved your own change/))
      .toBeInTheDocument();
    expect(await axeViolations(document.body)).toEqual([]);
    expect(onSelfApprove).not.toHaveBeenCalled();
    await user.click(within(dialog).getByRole('button', { name: 'Approve it myself' }));
    expect(onSelfApprove).toHaveBeenCalledWith('c1');
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
    const row = screen.getByRole('row', { name: /Lucía Ortega/ });
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

  it('offers the only HR member, on their own record, to approve it themselves', async () => {
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
});
