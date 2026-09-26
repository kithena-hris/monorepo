import { render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { fast } from '../test/user';
import type { RecordField } from '../record/model';
import { axeViolations } from '../test/axe';
import { Profile, type ProfileState } from './profile';

const field = (over: Partial<RecordField> & Pick<RecordField, 'key' | 'label'>): RecordField => ({
  description: null,
  dataType: 'text',
  options: [],
  required: false,
  readOnly: true,
  ...over,
});

const person = {
  name: 'Adam Reyes',
  summary: 'Support Engineer · Barcelona · started 1 Sep 2026',
  avatarUrl: null,
};

/**
 * The same person, as the application layer shapes it for HR and for his
 * manager. The two view models differ only by what the authorization decision
 * removed; the component is the same.
 */
const asHr: ProfileState = {
  person: { ...person, missing: 0 },
  sections: [
    {
      key: 'personal',
      label: 'Personal information',
      visibility: ['self', 'hr'],
      readsLogged: false,
      fields: [
        field({ key: 'date_of_birth', label: 'Date of birth', dataType: 'date' }),
        field({ key: 'nif', label: 'NIF', dataType: 'national_id' }),
      ],
    },
    {
      key: 'compensation',
      label: 'Compensation',
      visibility: ['self', 'hr', 'finance'],
      readsLogged: true,
      fields: [
        field({ key: 'base_salary', label: 'Base salary', dataType: 'money' }),
        field({ key: 'bank_account', label: 'Bank account', dataType: 'bank_account' }),
      ],
    },
    {
      key: 'work',
      label: 'Work',
      visibility: ['self', 'manager', 'hr'],
      readsLogged: false,
      fields: [field({ key: 'work_model', label: 'Work model' })],
    },
  ],
  values: {
    date_of_birth: '1994-03-14',
    nif: { last4: '384K' },
    base_salary: { amountMinor: '4800000', currency: 'EUR' },
    bank_account: { last4: '2291' },
    work_model: 'Hybrid',
  },
};

const asManager: ProfileState = {
  person: { ...person, missing: null },
  sections: [asHr.sections[2] as ProfileState['sections'][number]],
  values: { work_model: 'Hybrid' },
};

const WITHHELD = [
  'Personal information',
  'Date of birth',
  'NIF',
  'Compensation',
  'Base salary',
  'Bank account',
];

describe('Profile', () => {
  it('renders what HR may read, money from minor units and secrets masked', async () => {
    const { container } = render(
      <Profile load={{ status: 'ready', data: asHr }} onSave={vi.fn()} />,
    );
    expect(screen.getByText('Complete')).toBeInTheDocument();
    expect(screen.getByText('•••• 2291')).toBeInTheDocument();
    expect(screen.getByText(/48,000\.00/)).toBeInTheDocument();
    expect(screen.getByText('Reads are logged')).toBeInTheDocument();
    expect(await axeViolations(container)).toEqual([]);
  });

  it('gives a manager a DOM with none of the withheld labels: absent, not empty', async () => {
    const { container } = render(
      <Profile load={{ status: 'ready', data: asManager }} onSave={vi.fn()} />,
    );
    const text = container.textContent;
    for (const label of WITHHELD) expect(text).not.toContain(label);
    // No padlock, no greyed row, no completeness he is not shown.
    expect(screen.queryByText(/missing|Complete|Encrypted|hidden|locked/i)).toBeNull();
    expect(screen.getByText('Hybrid')).toBeInTheDocument();
    expect(await axeViolations(container)).toEqual([]);
  });

  it('prints no heading for a section that arrives with nothing readable in it', () => {
    const emptied: ProfileState = {
      ...asManager,
      sections: [
        ...asManager.sections,
        { ...(asHr.sections[1] as ProfileState['sections'][number]), fields: [] },
      ],
    };
    const { container } = render(
      <Profile load={{ status: 'ready', data: emptied }} onSave={vi.fn()} />,
    );
    expect(container.textContent).not.toContain('Compensation');
  });

  it('edits what the viewer owns, and names the owner of what they do not', async () => {
    const user = fast();
    const own: ProfileState = {
      person: { ...person, missing: 1 },
      sections: [
        {
          key: 'contact',
          label: 'Contact',
          visibility: ['self', 'hr'],
          readsLogged: false,
          fields: [
            field({ key: 'mobile', label: 'Mobile', dataType: 'phone', readOnly: false }),
            field({ key: 'employee_number', label: 'Employee number', ownedBy: 'HR' }),
          ],
        },
      ],
      values: { employee_number: 'E-0142' },
    };
    const onSave = vi.fn(() => Promise.resolve({ ok: true as const }));
    render(<Profile load={{ status: 'ready', data: own }} onSave={onSave} />);
    await user.click(screen.getByRole('button', { name: 'Edit Contact' }));
    const form = screen.getByRole('form', { name: 'Contact' });
    expect(within(form).getByLabelText('Employee number')).toBeDisabled();
    expect(within(form).getByText('Changed by HR.')).toBeInTheDocument();
    await user.type(within(form).getByLabelText(/Mobile/), '612345678');
    await user.click(within(form).getByRole('button', { name: 'Save' }));
    expect(onSave).toHaveBeenCalledWith('contact', {
      mobile: expect.stringContaining('612345678') as unknown,
    });
  });

  it('picks a manager by searching People, whoever they are among 50,000 (PEO-122)', async () => {
    const user = fast();
    const withManager: ProfileState = {
      person: { ...person, missing: 0 },
      sections: [
        {
          key: 'work',
          label: 'Work',
          visibility: ['self', 'hr'],
          readsLogged: false,
          fields: [
            field({
              key: 'manager_id',
              label: 'Manager',
              dataType: 'person_ref',
              readOnly: false,
              // Who is chosen now, named: the only person the view sends.
              options: [{ value: 'g', label: 'Grace Hopper' }],
            }),
          ],
        },
      ],
      values: { manager_id: 'g' },
    };
    const searchPeople = vi.fn(() => Promise.resolve([{ value: 'z', label: 'Zoë Person 49999' }]));
    const onSave = vi.fn(() => Promise.resolve({ ok: true as const }));
    const { container } = render(
      <Profile
        load={{ status: 'ready', data: withManager }}
        onSave={onSave}
        searchPeople={searchPeople}
      />,
    );
    await user.click(screen.getByRole('button', { name: 'Edit Work' }));
    const form = screen.getByRole('form', { name: 'Work' });
    const picker = within(form).getByRole('button', { name: 'Manager' });
    expect(picker).toHaveTextContent('Grace Hopper');
    expect(await axeViolations(container)).toEqual([]);
    await user.click(picker);
    await user.type(screen.getByRole('combobox', { name: 'Manager search' }), '49999');
    await user.click(await screen.findByRole('option', { name: 'Zoë Person 49999' }));
    await user.click(within(form).getByRole('button', { name: 'Save' }));
    expect(onSave).toHaveBeenCalledWith('work', { manager_id: 'z' });
  });

  it('lets HR move somebody, saying when the move is a transfer (PEO-123)', async () => {
    const user = fast();
    const placed: ProfileState = {
      ...asManager,
      placement: {
        legalEntityId: 'es',
        locationId: 'mad',
        entities: [
          { value: 'es', label: 'Acme Spain' },
          { value: 'us', label: 'Acme US' },
        ],
        locations: [
          { value: 'mad', label: 'Madrid', legalEntityId: 'es' },
          { value: 'sfo', label: 'San Francisco', legalEntityId: 'us' },
        ],
      },
    };
    const onPlace = vi.fn(() => Promise.resolve({ ok: true as const }));
    const { container } = render(
      <Profile load={{ status: 'ready', data: placed }} onSave={vi.fn()} onPlace={onPlace} />,
    );
    const form = screen.getByRole('form', { name: 'Placement' });
    expect(within(form).getByRole('button', { name: 'Move' })).toBeDisabled();
    expect(await axeViolations(container)).toEqual([]);

    await user.click(within(form).getByRole('combobox', { name: 'Legal entity' }));
    await user.click(await screen.findByRole('option', { name: 'Acme US' }));
    expect(within(form).getByText('This is a transfer')).toBeInTheDocument();
    await user.click(within(form).getByRole('combobox', { name: /Work location/ }));
    await user.click(await screen.findByRole('option', { name: 'San Francisco' }));
    await user.click(within(form).getByRole('button', { name: 'Move' }));
    expect(onPlace).toHaveBeenCalledWith({ legalEntityId: 'us', locationId: 'sfo' });
  });

  it('offers no move without the placement, or without somewhere to send it', () => {
    render(
      <Profile load={{ status: 'ready', data: asManager }} onSave={vi.fn()} onPlace={vi.fn()} />,
    );
    expect(screen.queryByRole('form', { name: 'Placement' })).toBeNull();
  });

  it('opens the history where the shell offers it (PEO-064)', async () => {
    const onHistory = vi.fn();
    const { rerender } = render(
      <Profile load={{ status: 'ready', data: asManager }} onSave={vi.fn()} />,
    );
    expect(screen.queryByRole('button', { name: 'History' })).toBeNull();
    rerender(
      <Profile
        load={{ status: 'ready', data: asManager }}
        onSave={vi.fn()}
        onHistory={onHistory}
      />,
    );
    await fast().click(screen.getByRole('button', { name: 'History' }));
    expect(onHistory).toHaveBeenCalledOnce();
  });

  it('has loading and error states', async () => {
    const { container, rerender } = render(
      <Profile load={{ status: 'loading' }} onSave={vi.fn()} />,
    );
    expect(screen.getByText('Loading this profile')).toBeInTheDocument();
    rerender(<Profile load={{ status: 'error', message: 'Not found' }} onSave={vi.fn()} />);
    expect(screen.getByText('Not found')).toBeInTheDocument();
    expect(await axeViolations(container)).toEqual([]);
  });
});
