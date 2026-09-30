import { TooltipProvider } from '@reach/ui';
import { render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { axeViolations } from '../test/axe';
import { fast } from '../test/user';
import { NEW_FIELDS } from './new-information.fixture';
import { NewInformation, type NewFieldsView } from './new-information';

/**
 * New information in this file: the proposed fields, what happens for people
 * not in the file, and one review, before anything is added.
 */

function mount(view: NewFieldsView = NEW_FIELDS) {
  const props = {
    view,
    onReview: vi.fn(() =>
      Promise.resolve({
        ok: true as const,
        data: {
          ...view,
          summary:
            'Adds 3 fields: 1 to a new Emergency contact section, 1 to Employment, 1 to a new Bank and pay section. Values for 128 people from this file. 342 people will be asked for their emergency contact.',
          problems: [],
        },
      }),
    ),
    onApply: vi.fn(() => Promise.resolve({ ok: true as const })),
    onSkip: vi.fn(),
    onBack: vi.fn(),
  };
  const rendered = render(<NewInformation {...props} />, { wrapper: TooltipProvider });
  return { ...props, rendered };
}

describe('new information in this file', () => {
  it('shows one readable card per column, with the reason, and sensitive ones flagged', async () => {
    const { rendered } = mount();
    expect(screen.getByRole('heading', { name: 'New information in this file' })).toBeTruthy();
    expect(screen.getByText('“Emergency contact” → Emergency contact')).toBeTruthy();
    expect(screen.getByText(/Only they know it|contact details are personal/iu)).toBeTruthy();
    expect(screen.getByText('Financial')).toBeTruthy();
    expect(await axeViolations(rendered.container)).toEqual([]);
  });

  it('lets HR change a field, or leave a column out', async () => {
    const user = fast();
    mount();
    await user.click(screen.getByRole('button', { name: 'Change T-shirt size' }));
    const name = screen.getByLabelText('Name');
    await user.clear(name);
    await user.type(name, 'Shirt size');
    expect(screen.getByText('“T-shirt size” → Shirt size')).toBeTruthy();
    await user.click(
      screen.getAllByRole('button', { name: 'Don’t import this column' })[2] as HTMLElement,
    );
    expect(screen.getByText('Not imported')).toBeTruthy();
  });

  it('asks what happens for people not in the file, recommending one with its reason and count', async () => {
    const user = fast();
    const { rendered } = mount();
    await user.click(screen.getByRole('button', { name: 'Next: people not in this file' }));
    expect(screen.getByRole('heading', { name: 'People not in this file' })).toBeTruthy();
    expect(
      screen.getAllByText('342 people here get no value from this file.').length,
    ).toBeGreaterThan(0);
    expect(screen.getByText(/Recommended: HR records it/u)).toBeTruthy();
    expect(await axeViolations(rendered.container)).toEqual([]);
  });

  it('reviews in words, then adds the fields with the choices made, and nothing before', async () => {
    const user = fast();
    const { onReview, onApply, rendered } = mount();
    await user.click(
      screen.getAllByRole('button', { name: 'Don’t import this column' })[2] as HTMLElement,
    );
    await user.click(screen.getByRole('button', { name: 'Next: people not in this file' }));
    const cost = screen.getByRole('radiogroup', { name: 'Cost centre' });
    await user.click(within(cost).getByRole('radio', { name: /Leave it empty/u }));
    expect(onApply).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'Review' }));
    expect(onReview).toHaveBeenCalledOnce();
    await screen.findByText(/342 people will be asked for their emergency contact/u);
    expect(await axeViolations(rendered.container)).toEqual([]);
    await user.click(screen.getByRole('button', { name: 'Add 3 fields and continue' }));
    expect(onApply).toHaveBeenCalledOnce();
    const [proposals, summary] = onApply.mock.calls[0] as unknown as [
      readonly { key: string; include: boolean; forExisting: { kind: string } }[],
      string,
    ];
    // Every column goes back, the left-out one marked so: People adds only the kept ones.
    expect(proposals.find((p) => p.key === 't_shirt_size')?.include).toBe(false);
    expect(proposals.filter((p) => p.include).map((p) => [p.key, p.forExisting.kind])).toEqual([
      ['emergency_contact', 'ask'],
      ['cost_centre', 'leave'],
      ['iban', 'ask'],
    ]);
    expect(summary).toMatch(/^Adds 3 fields/u);
  });

  it('for HR without an administrator: the proposal to read, a clear message, and no way to add', async () => {
    const user = fast();
    const { onSkip } = mount({
      ...NEW_FIELDS,
      canCreate: false,
      blocked:
        'Only a People administrator can add fields. Ask one to run this import, or import without these columns.',
    });
    expect(screen.getByText(/Only a People administrator can add fields/u)).toBeTruthy();
    expect(screen.queryByRole('button', { name: /^Change /u })).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Next: people not in this file' }));
    await user.click(screen.getByRole('button', { name: 'Review' }));
    await screen.findByText(/Values for 128 people/u);
    expect(screen.queryByRole('button', { name: /and continue$/u })).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Import without these columns' }));
    expect(onSkip).toHaveBeenCalledOnce();
  });
});
