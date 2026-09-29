import { TooltipProvider } from '@reach/ui';
import { render as mount, screen, waitFor, within } from '@testing-library/react';
import type { ReactElement } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { fast } from '../test/user';
import type { RecordField } from '../record/model';
import { axeViolations } from '../test/axe';
import { Profile, type ProfileState } from './profile';

/** As the shell renders every screen: inside a TooltipProvider. */
const render = (ui: ReactElement, options: Parameters<typeof mount>[1] = {}) =>
  mount(ui, { wrapper: TooltipProvider, ...options });

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
  missing: null,
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

  it('downloads the record as a PDF where offered, and says why People refused', async () => {
    const user = fast();
    const onDownloadRecord = vi.fn(() =>
      Promise.resolve({ ok: false as const, message: 'No such person' }),
    );
    const { container, rerender } = render(
      <Profile load={{ status: 'ready', data: asHr }} onSave={vi.fn()} />,
    );
    expect(screen.queryByRole('menuitem', { name: 'Download PDF' })).toBeNull();
    rerender(
      <Profile
        load={{ status: 'ready', data: asHr }}
        onSave={vi.fn()}
        onDownloadRecord={onDownloadRecord}
      />,
    );
    await user.click(screen.getByRole('button', { name: 'Actions' }));
    await user.click(screen.getByRole('menuitem', { name: 'Download PDF' }));
    const dialog = await screen.findByRole('dialog');
    await user.type(within(dialog).getByRole('textbox', { name: 'Reason' }), 'Grievance file');
    await user.click(within(dialog).getByRole('button', { name: 'Download' }));
    expect(onDownloadRecord).toHaveBeenCalledWith('Grievance file');
    expect(await within(dialog).findByText('No such person')).toBeInTheDocument();
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

  it('draws a field kept in an upstream system read-only, saying where to change it (PEO-073)', async () => {
    const user = fast();
    const mirrored: ProfileState = {
      person,
      sections: [
        {
          key: 'contact',
          label: 'Contact',
          visibility: ['self', 'hr'],
          readsLogged: false,
          fields: [
            field({ key: 'mobile', label: 'Mobile', dataType: 'phone', readOnly: false }),
            field({ key: 'given_name', label: 'Given name', ownedBy: 'Okta', keptIn: 'Okta' }),
          ],
        },
      ],
      values: { given_name: 'Ada' },
    };
    render(<Profile load={{ status: 'ready', data: mirrored }} onSave={vi.fn()} />);
    await user.click(screen.getByRole('button', { name: 'Edit Contact' }));
    const form = screen.getByRole('form', { name: 'Contact' });
    expect(within(form).getByLabelText('Given name')).toBeDisabled();
    expect(within(form).getByText('Kept in Okta; change it there.')).toBeInTheDocument();
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
    expect(await axeViolations(container)).toEqual([]);
    // From the Actions menu, in a dialog.
    await user.click(screen.getByRole('button', { name: 'Actions' }));
    await user.click(await screen.findByRole('menuitem', { name: 'Change placement' }));
    const form = await screen.findByRole('form', { name: 'Placement' });
    expect(within(form).getByRole('button', { name: 'Move' })).toBeDisabled();

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
    expect(screen.queryByRole('button', { name: 'Actions' })).toBeNull();
    rerender(
      <Profile
        load={{ status: 'ready', data: asManager }}
        onSave={vi.fn()}
        onHistory={onHistory}
      />,
    );
    await fast().click(screen.getByRole('button', { name: 'Actions' }));
    await fast().click(screen.getByRole('menuitem', { name: 'History' }));
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

describe('Profile: what is missing', () => {
  /**
   * Ada's own record: two gaps People's verdict names — one hers to give, one
   * HR's — and a field required only of other people, empty here and not a gap.
   */
  const own: ProfileState = {
    person: { ...person, name: 'Ada Lovelace', missing: 2, canChangePhoto: true },
    sections: [
      {
        key: 'personal',
        label: 'Personal information',
        visibility: ['self', 'hr'],
        readsLogged: false,
        fields: [
          field({ key: 'phone', label: 'Personal phone', readOnly: false }),
          field({
            key: 'emergency_contact',
            label: 'Emergency contact',
            readOnly: false,
            required: true,
            missing: true,
          }),
          // Required of contractors only: empty on Ada's record, and not missing.
          field({ key: 'agency', label: 'Agency', readOnly: false, required: false, missing: false }),
        ],
      },
      {
        key: 'employment',
        label: 'Employment',
        visibility: ['self', 'hr'],
        readsLogged: false,
        fields: [
          field({ key: 'job_title', label: 'Job title', required: true }),
          field({
            key: 'cost_centre',
            label: 'Cost centre',
            required: true,
            missing: true,
            ownedBy: 'HR',
          }),
        ],
      },
    ],
    values: { phone: '+34 600 000 000', job_title: 'Engineer' },
  };

  it('marks each gap in place, counts them per section and overall, in words', async () => {
    const { container } = render(<Profile load={{ status: 'ready', data: own }} onSave={vi.fn()} />);
    expect(screen.getByText('2 missing')).toBeInTheDocument();
    expect(screen.getAllByText('1 missing')).toHaveLength(2);
    expect(screen.getAllByText('Missing')).toHaveLength(2);
    expect(screen.getByText('Not provided yet. HR fills this in.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Add Emergency contact' })).toBeInTheDocument();
    // Only what the verdict says: an empty field required of somebody else is not a gap.
    const agency = screen.getByText('Agency').closest('dt');
    expect(agency).not.toHaveTextContent('Missing');
    expect(await axeViolations(container)).toEqual([]);
  });

  it('opens a linked gap in its section with the cursor in it, and says it is missing', () => {
    render(
      <Profile
        load={{ status: 'ready', data: own }}
        onSave={vi.fn()}
        focusField="emergency_contact"
      />,
    );
    const input = screen.getByRole('textbox', { name: /Emergency contact/ });
    expect(input).toHaveFocus();
    expect(input).toHaveAccessibleName(/Emergency contact.*Missing/);
    expect(input).toHaveAccessibleDescription(/Required, and not provided yet/);
  });

  it('fills in the first gap from the header', async () => {
    const user = fast();
    render(<Profile load={{ status: 'ready', data: own }} onSave={vi.fn()} />);
    await user.click(screen.getByRole('button', { name: 'Actions' }));
    await user.click(screen.getByRole('menuitem', { name: 'Fill in missing details' }));
    await waitFor(() => {
      expect(screen.getByRole('textbox', { name: /Emergency contact/ })).toHaveFocus();
    });
  });

  it('names what is missing on the count, and goes to the first when pressed', async () => {
    const user = fast();
    render(<Profile load={{ status: 'ready', data: own }} onSave={vi.fn()} />);
    const chip = screen.getByRole('button', { name: /missing: .*Emergency contact.*Go to the first/ });
    await user.click(chip);
    await waitFor(() => {
      expect(screen.getByRole('textbox', { name: /Emergency contact/ })).toHaveFocus();
    });
  });

  it('lets the person change their photo, and hands the file to the shell', async () => {
    const user = fast();
    const onPhoto = vi.fn(() =>
      Promise.resolve({ ok: true as const, avatarUrl: '/people/photos/x?v=1' }),
    );
    const { container, rerender } = render(
      <Profile load={{ status: 'ready', data: own }} onSave={vi.fn()} onPhoto={onPhoto} />,
    );
    // jsdom has no object URLs; the picker's preview needs one.
    URL.createObjectURL = vi.fn(() => 'blob:preview');
    URL.revokeObjectURL = vi.fn();
    const file = new File(['png'], 'me.png', { type: 'image/png' });
    await user.upload(screen.getByLabelText('Photo'), file);
    expect(onPhoto).toHaveBeenCalledWith(file);
    expect(await axeViolations(container)).toEqual([]);
    // Somebody who may not change it sees the photo, not a picker.
    rerender(
      <Profile
        load={{ status: 'ready', data: { ...own, person: { ...own.person, canChangePhoto: false } } }}
        onSave={vi.fn()}
        onPhoto={onPhoto}
      />,
    );
    expect(screen.queryByLabelText('Photo')).toBeNull();
  });

  it('asks the person for an empty detail from beside it, and says when it was asked', async () => {
    const user = fast();
    const onRequest = vi.fn(() => Promise.resolve({ ok: true as const }));
    const state: ProfileState = {
      ...asManager,
      sections: [
        {
          key: 'work',
          label: 'Work',
          visibility: ['self', 'manager', 'hr'],
          readsLogged: false,
          fields: [
            field({ key: 'work_phone', label: 'Work phone', askable: true }),
            field({ key: 'hometown', label: 'Hometown', askable: true }),
            field({ key: 'employee_number', label: 'Employee number' }),
          ],
        },
      ],
      values: {},
      requests: [
        { key: 'hometown', label: 'Hometown', requestedAt: '2026-09-20T10:00:00Z', by: 'Toby Flenderson' },
      ],
    };
    const { container } = render(
      <Profile load={{ status: 'ready', data: state }} onSave={vi.fn()} onRequest={onRequest} />,
      { wrapper: TooltipProvider },
    );
    // Only what the employee fills in; HR's employee number is not theirs to add.
    expect(screen.queryByRole('button', { name: /Employee number/ })).toBeNull();
    expect(
      screen.getByRole('button', {
        name: 'Toby Flenderson asked Adam for this on September 20, 2026. Ask again',
      }),
    ).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Ask Adam to add Work phone' }));
    expect(onRequest).toHaveBeenCalledWith(['work_phone']);
    expect(
      await screen.findByRole('button', { name: 'Asked Adam for Work phone' }),
    ).toBeInTheDocument();
    // Both at once, in one email.
    await user.click(screen.getByRole('button', { name: 'Actions' }));
    await user.click(screen.getByRole('menuitem', { name: 'Ask Adam for 2 empty details' }));
    expect(onRequest).toHaveBeenLastCalledWith(['work_phone', 'hometown']);
    expect(await screen.findByText('Adam has been asked, by email.')).toBeInTheDocument();
    expect(await axeViolations(container)).toEqual([]);
  });

  it('tells the person what they were asked for, on their own profile', async () => {
    const user = fast();
    const state: ProfileState = {
      ...asManager,
      sections: [
        {
          key: 'work',
          label: 'Work',
          visibility: ['self', 'manager', 'hr'],
          readsLogged: false,
          fields: [field({ key: 'hometown', label: 'Hometown', readOnly: false })],
        },
      ],
      values: {},
      requests: [
        { key: 'hometown', label: 'Hometown', requestedAt: '2026-09-20T10:00:00Z', by: 'Toby Flenderson' },
      ],
    };
    render(<Profile load={{ status: 'ready', data: state }} onSave={vi.fn()} />);
    expect(screen.getByText('Toby Flenderson asked you to add a detail')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Add them' }));
    expect(screen.getByRole('textbox', { name: /Hometown/ })).toHaveFocus();
  });
});

describe('a profile read again', () => {
  it('shows what the server now holds, not what it first drew', () => {
    const wrap = { wrapper: TooltipProvider };
    const { rerender } = render(
      <Profile load={{ status: 'ready', data: asManager }} onSave={vi.fn()} />,
      wrap,
    );
    expect(screen.getByText('Hybrid')).toBeInTheDocument();
    rerender(
      <Profile
        load={{ status: 'ready', data: { ...asManager, values: { work_model: 'Remote' } } }}
        onSave={vi.fn()}
      />,
    );
    expect(screen.getByText('Remote')).toBeInTheDocument();
    expect(screen.queryByText('Hybrid')).toBeNull();
  });
});

describe('the record’s tab, in the address', () => {
  it('opens on the section a link named, and hands a chosen tab to the host', async () => {
    const user = fast();
    const onTabChange = vi.fn();
    render(
      <Profile
        load={{ status: 'ready', data: asHr }}
        onSave={vi.fn()}
        onMove={vi.fn()}
        tab="compensation"
        onTabChange={onTabChange}
      />,
    );
    expect(screen.getByRole('tab', { name: 'Compensation' })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    expect(screen.queryByText('Hybrid')).toBeNull();
    await user.click(screen.getByRole('tab', { name: 'Overview' }));
    expect(onTabChange).toHaveBeenCalledWith('overview');
  });

  it('opens on the overview for a section this record does not have', () => {
    render(
      <Profile
        load={{ status: 'ready', data: asHr }}
        onSave={vi.fn()}
        onMove={vi.fn()}
        tab="nonsense"
        onTabChange={vi.fn()}
      />,
    );
    expect(screen.getByRole('tab', { name: 'Overview' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByText('Hybrid')).toBeInTheDocument();
  });
});
