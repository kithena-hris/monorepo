import { render, screen, waitFor, within } from '@testing-library/react';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { fast } from '../test/user';
import type { Loadable, Outcome } from '../load';
import type { Values } from '../record/model';
import { axeViolations } from '../test/axe';
import { PeopleSetup, type SetupState } from './people-setup';

const fresh: SetupState = {
  legalEntity: { name: 'Acme Iberia SL', country: 'ES' },
  entityConfirmed: false,
  countries: [
    { code: 'ES', name: 'Spain' },
    { code: 'GB', name: 'United Kingdom' },
  ],
  packs: [
    {
      country: 'ES',
      countryName: 'Spain',
      fields: 58,
      sections: [
        {
          key: 'personal',
          label: 'Personal information',
          summary: 'Legal name, date of birth',
          required: 3,
          requiredByLaw: 0,
          onByDefault: true,
        },
        {
          key: 'identification',
          label: 'Identification & right to work',
          summary: 'NIF/NIE, social security number',
          required: 2,
          requiredByLaw: 2,
          onByDefault: true,
        },
        {
          key: 'diversity',
          label: 'Diversity & voluntary self-ID',
          summary: 'Aggregate reporting only',
          required: 0,
          requiredByLaw: 0,
          onByDefault: false,
        },
      ],
    },
  ],
  published: null,
  profile: null,
};

const profile: NonNullable<SetupState['profile']> = {
  sections: [
    {
      key: 'personal',
      label: 'Personal information',
      visibility: ['self', 'hr'],
      fields: [
        {
          key: 'legal_name',
          label: 'Legal name',
          description: null,
          dataType: 'text',
          options: [],
          required: true,
          readOnly: false,
        },
        {
          key: 'pronouns',
          label: 'Pronouns',
          description: null,
          dataType: 'text',
          options: [],
          required: false,
          readOnly: false,
        },
      ],
    },
  ],
  values: {},
};

/** The shell, reduced to what the wizard needs of it: it re-reads after each write. */
function Harness({
  onPublish,
  onSaveProfile,
}: {
  readonly onPublish: (pack: { country: string; sections: readonly string[] }) => Promise<Outcome>;
  readonly onSaveProfile: (key: string, changed: Values) => Promise<Outcome>;
}) {
  const [state, setState] = useState<SetupState>(fresh);
  const load: Loadable<SetupState> = { status: 'ready', data: state };
  return (
    <PeopleSetup
      load={load}
      onConfirmEntity={(entity) => {
        setState((s) => ({ ...s, legalEntity: entity, entityConfirmed: true }));
        return Promise.resolve({ ok: true });
      }}
      onPublish={async (pack) => {
        const outcome = await onPublish(pack);
        if (outcome.ok) setState((s) => ({ ...s, published: 1, profile }));
        return outcome;
      }}
      onSaveProfile={async (key, changed) => {
        const outcome = await onSaveProfile(key, changed);
        if (outcome.ok) {
          setState((s) =>
            s.profile === null
              ? s
              : { ...s, profile: { ...s.profile, values: { ...s.profile.values, ...changed } } },
          );
        }
        return outcome;
      }}
      onFinish={vi.fn()}
    />
  );
}

describe('PeopleSetup', () => {
  it('takes a fresh tenant to a published version 1 and a complete first profile', async () => {
    const user = fast();
    const onPublish = vi.fn(() => Promise.resolve({ ok: true as const }));
    const onSaveProfile = vi.fn(() => Promise.resolve({ ok: true as const }));
    const { container } = render(<Harness onPublish={onPublish} onSaveProfile={onSaveProfile} />);

    // 1. The legal entity, as the back office recorded it.
    expect(screen.getByLabelText(/Registered name/)).toHaveValue('Acme Iberia SL');
    expect(await axeViolations(container)).toEqual([]);
    await user.click(screen.getByRole('button', { name: 'Continue' }));

    // 2. The country pack. A section the law requires cannot be switched off.
    expect(await screen.findByText(/so the Spain pack is selected/)).toBeInTheDocument();
    expect(screen.getByRole('switch', { name: 'Identification & right to work' })).toBeDisabled();
    expect(screen.getByRole('switch', { name: 'Diversity & voluntary self-ID' })).not.toBeChecked();
    await user.click(screen.getByRole('switch', { name: 'Personal information' }));
    await user.click(screen.getByRole('switch', { name: 'Personal information' }));
    expect(await axeViolations(container)).toEqual([]);
    await user.click(screen.getByRole('button', { name: 'Continue' }));

    // 3. Publish version 1.
    await user.click(screen.getByRole('button', { name: 'Publish version 1' }));
    expect(onPublish).toHaveBeenCalledWith({
      country: 'ES',
      sections: ['personal', 'identification'],
    });

    // 4. The admin's own profile, the first record evaluated against it.
    const form = await screen.findByRole('form', { name: 'Personal information' });
    expect(screen.getByText('1 missing')).toBeInTheDocument();
    expect(await axeViolations(container)).toEqual([]);
    await user.type(within(form).getByLabelText(/Legal name/), 'Priya Nair');
    await user.click(within(form).getByRole('button', { name: 'Save' }));
    expect(onSaveProfile).toHaveBeenCalledWith('personal', { legal_name: 'Priya Nair' });
    await waitFor(() => {
      expect(screen.getByText('Complete')).toBeInTheDocument();
    });
    expect(screen.getByRole('button', { name: 'Finish' })).toBeInTheDocument();
  });

  it('refuses to save a section with a required field empty, and says which', async () => {
    const user = fast();
    const onSaveProfile = vi.fn(() => Promise.resolve({ ok: true as const }));
    render(
      <Harness onPublish={() => Promise.resolve({ ok: true })} onSaveProfile={onSaveProfile} />,
    );
    await user.click(screen.getByRole('button', { name: 'Continue' }));
    await user.click(await screen.findByRole('button', { name: 'Continue' }));
    await user.click(screen.getByRole('button', { name: 'Publish version 1' }));
    const form = await screen.findByRole('form', { name: 'Personal information' });
    await user.click(within(form).getByRole('button', { name: 'Save' }));
    expect(within(form).getByText('Legal name is required.')).toBeInTheDocument();
    expect(onSaveProfile).not.toHaveBeenCalled();
  });

  it('keeps the admin on the step and says why when publishing fails', async () => {
    const user = fast();
    render(
      <Harness
        onPublish={() => Promise.resolve({ ok: false, message: 'The pack could not be applied' })}
        onSaveProfile={() => Promise.resolve({ ok: true })}
      />,
    );
    await user.click(screen.getByRole('button', { name: 'Continue' }));
    await user.click(await screen.findByRole('button', { name: 'Continue' }));
    await user.click(screen.getByRole('button', { name: 'Publish version 1' }));
    expect(await screen.findByText('The pack could not be applied')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Publish version 1' })).toBeInTheDocument();
  });

  it('resumes where the tenant left off', () => {
    render(
      <PeopleSetup
        load={{ status: 'ready', data: { ...fresh, entityConfirmed: true } }}
        onConfirmEntity={vi.fn()}
        onPublish={vi.fn()}
        onSaveProfile={vi.fn()}
        onFinish={vi.fn()}
      />,
    );
    expect(screen.getByText(/so the Spain pack is selected/)).toBeInTheDocument();
  });

  it('draws loading and error states', async () => {
    const { container, rerender } = render(
      <PeopleSetup
        load={{ status: 'loading' }}
        onConfirmEntity={vi.fn()}
        onPublish={vi.fn()}
        onSaveProfile={vi.fn()}
        onFinish={vi.fn()}
      />,
    );
    expect(screen.getByText('Loading the setup')).toBeInTheDocument();
    rerender(
      <PeopleSetup
        load={{ status: 'error', message: 'People is not reachable' }}
        onConfirmEntity={vi.fn()}
        onPublish={vi.fn()}
        onSaveProfile={vi.fn()}
        onFinish={vi.fn()}
      />,
    );
    expect(screen.getByText('People is not reachable')).toBeInTheDocument();
    expect(await axeViolations(container)).toEqual([]);
  });
});

describe('the first administrator’s held NIF (PEO-077)', () => {
  it('is theirs to approve alone, as the only HR member, after the dialog', async () => {
    const onSelfApprove = vi.fn(() => Promise.resolve({ ok: true as const }));
    const { container } = render(
      <PeopleSetup
        load={{
          status: 'ready',
          data: {
            ...fresh,
            entityConfirmed: true,
            published: 1,
            profile: {
              ...profile,
              pending: [
                {
                  id: 'c1',
                  key: 'legal_name',
                  label: 'Legal name',
                  kind: 'value',
                  value: 'Priya Shah',
                  effectiveFrom: '2026-09-26',
                  requestedAt: '2026-09-26T09:00:00.000Z',
                  expiresAt: '2026-10-03T09:00:00.000Z',
                  requestedBy: 'You',
                  reason: null,
                  mine: true,
                  canDecide: false,
                  canSelfApprove: true,
                },
              ],
            },
          },
        }}
        onConfirmEntity={vi.fn()}
        onPublish={vi.fn()}
        onSaveProfile={vi.fn()}
        onSelfApprove={onSelfApprove}
        onWithdraw={vi.fn()}
        onFinish={vi.fn()}
      />,
    );
    expect(await axeViolations(container)).toEqual([]);
    const user = fast();
    await user.click(
      screen.getByRole('button', { name: 'Approve the change to Legal name yourself' }),
    );
    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByText(/no other member to approve it/)).toBeInTheDocument();
    await user.click(within(dialog).getByRole('button', { name: 'Approve it myself' }));
    expect(onSelfApprove).toHaveBeenCalledWith('c1');
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).toBeNull();
    });
  });
});
