import { render, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { fast } from '../test/user';
import type { RecordField } from '../record/model';
import { axeViolations } from '../test/axe';
import { Onboarding, type OnboardingState } from './onboarding';

const field = (over: Partial<RecordField> & Pick<RecordField, 'key' | 'label'>): RecordField => ({
  description: null,
  dataType: 'text',
  options: [],
  required: false,
  readOnly: false,
  ...over,
});

const state: OnboardingState = {
  firstName: 'Adam',
  saved: ['personal'],
  values: { legal_name: 'Adam Reyes' },
  sections: [
    {
      key: 'personal',
      label: 'Personal information',
      ask: 'required',
      visibility: ['self', 'hr'],
      fields: [field({ key: 'legal_name', label: 'Legal name', required: true })],
    },
    {
      key: 'emergency',
      label: 'Emergency contacts',
      ask: 'required',
      visibility: ['self', 'hr'],
      fields: [
        field({ key: 'contact_name', label: 'Their name', required: true }),
        field({ key: 'contact_phone', label: 'Phone number', dataType: 'phone', required: true }),
      ],
    },
    {
      key: 'diversity',
      label: 'Diversity questions',
      ask: 'voluntary',
      visibility: [],
      fields: [
        field({
          key: 'ethnicity',
          label: 'Ethnicity',
          dataType: 'select',
          options: [{ value: 'prefer_not_to_say', label: 'Prefer not to say' }],
        }),
      ],
    },
  ],
};

describe('Onboarding', () => {
  it('resumes at the first section not yet saved, and says who will see the answers', async () => {
    const { container } = render(
      <Onboarding load={{ status: 'ready', data: state }} onSave={vi.fn()} />,
    );
    expect(
      screen.getByText(
        '1 of 3 sections done. You can stop any time; nothing you have saved is lost.',
      ),
    ).toBeInTheDocument();
    const form = screen.getByRole('form', { name: 'Emergency contacts' });
    expect(screen.getByText('Only you and HR can see these.')).toBeInTheDocument();
    expect(within(form).getByLabelText(/Their name/)).toBeInTheDocument();
    expect(screen.getByText('Voluntary')).toBeInTheDocument();
    expect(await axeViolations(container)).toEqual([]);
  });

  it('saves each section on its own and moves on, so stopping leaves a partial record', async () => {
    const user = fast();
    const onSave = vi.fn(() => Promise.resolve({ ok: true as const }));
    render(<Onboarding load={{ status: 'ready', data: state }} onSave={onSave} />);
    const form = screen.getByRole('form', { name: 'Emergency contacts' });
    await user.type(within(form).getByLabelText(/Their name/), 'Marta Ortega');
    await user.type(within(form).getByLabelText(/Phone number/), '612345678');
    await user.click(within(form).getByRole('button', { name: 'Save and continue' }));

    expect(onSave).toHaveBeenCalledOnce();
    expect(onSave).toHaveBeenCalledWith('emergency', {
      contact_name: 'Marta Ortega',
      contact_phone: expect.stringContaining('612345678') as unknown,
    });
    // The next section opens; the saved one says so.
    await screen.findByRole('form', { name: 'Diversity questions' });
    expect(screen.getAllByText('Saved')).toHaveLength(2);
    expect(screen.getByText(/2 of 3 sections done/)).toBeInTheDocument();
  });

  it('keeps the values and names the section when a save fails', async () => {
    const user = fast();
    render(
      <Onboarding
        load={{ status: 'ready', data: state }}
        onSave={() =>
          Promise.resolve({ ok: false, message: 'No connection. Your answers are still here.' })
        }
      />,
    );
    const form = screen.getByRole('form', { name: 'Emergency contacts' });
    await user.type(within(form).getByLabelText(/Their name/), 'Marta');
    await user.type(within(form).getByLabelText(/Phone number/), '612345678');
    await user.click(within(form).getByRole('button', { name: 'Save and continue' }));
    expect(
      await within(form).findByText('No connection. Your answers are still here.'),
    ).toBeInTheDocument();
    expect(within(form).getByLabelText(/Their name/)).toHaveValue('Marta');
  });

  it('has loading, error and nothing-to-do states', async () => {
    const { container, rerender } = render(
      <Onboarding load={{ status: 'loading' }} onSave={vi.fn()} />,
    );
    expect(screen.getByText('Loading your onboarding')).toBeInTheDocument();
    rerender(<Onboarding load={{ status: 'error', message: 'Offline' }} onSave={vi.fn()} />);
    expect(screen.getByText('Offline')).toBeInTheDocument();
    rerender(
      <Onboarding load={{ status: 'ready', data: { ...state, sections: [] } }} onSave={vi.fn()} />,
    );
    expect(screen.getByText('Nothing to fill in')).toBeInTheDocument();
    await waitFor(async () => {
      expect(await axeViolations(container)).toEqual([]);
    });
  });
});
