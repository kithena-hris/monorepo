import { render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { axeViolations } from '../test/axe';
import { fast } from '../test/user';
import { FieldChange } from './field-change';
import { START_DAY } from './field-change.fixture';

const MARCO = '00000000-0000-4000-8000-0000000000a2';
const GRACE = '00000000-0000-4000-8000-0000000000a3';

describe('FieldChange', () => {
  it('shows what converts, with examples, and every value that does not, with whose it is and why', async () => {
    const { container } = render(
      <FieldChange
        load={{ status: 'ready', data: START_DAY }}
        onApply={vi.fn()}
        onBack={vi.fn()}
      />,
    );
    expect(
      screen.getByRole('heading', { level: 1, name: 'Change Start day to date' }),
    ).toBeVisible();
    expect(screen.getByText('2 convert')).toBeVisible();
    const examples = screen.getByRole('list', { name: 'Example conversions' });
    expect(within(examples).getByText('12/03/2024')).toBeVisible();
    expect(within(examples).getByText('12 Mar 2024')).toBeVisible();
    expect(screen.getByText(/read as day\/month\/year/)).toBeVisible();
    const unfit = screen.getByRole('list', { name: 'Values that don’t fit' });
    expect(within(unfit).getByText('Marco Rossi')).toBeVisible();
    expect(within(unfit).getByText('when he starts')).toBeVisible();
    expect(within(unfit).getByText('Not a calendar date')).toBeVisible();
    expect(await axeViolations(container)).toEqual([]);
  });

  it('asks the employee by default, and publishes an edit typed on the spot', async () => {
    const user = fast();
    const onApply = vi.fn(() => Promise.resolve({ ok: true as const }));
    const { container } = render(
      <FieldChange
        load={{ status: 'ready', data: START_DAY }}
        onApply={onApply}
        onBack={vi.fn()}
      />,
    );
    await user.click(
      screen.getByRole('combobox', { name: /What to do with Grace Hopper’s value/ }),
    );
    await user.click(await screen.findByRole('option', { name: 'Type the right value' }));
    // An edit with nothing typed is held back, and says so.
    await user.click(screen.getByRole('button', { name: 'Publish the change' }));
    expect(onApply).not.toHaveBeenCalled();
    expect(screen.getByText('1 value still needs typing in.')).toBeVisible();

    await user.click(screen.getByRole('button', { name: /New Start day for Grace Hopper/ }));
    const days = await screen.findAllByRole('button', { name: /\b15\b/ });
    await user.click(days[0] as HTMLElement);
    expect(await axeViolations(container)).toEqual([]);
    await user.click(screen.getByRole('button', { name: 'Publish the change' }));
    expect(onApply).toHaveBeenCalledWith([
      { personId: MARCO, action: 'request' },
      {
        personId: GRACE,
        action: 'edit',
        value: expect.stringMatching(/^\d{4}-\d{2}-15$/) as unknown,
      },
    ]);
  });

  it('decides for every value at once, or for the ones selected', async () => {
    const user = fast();
    const onApply = vi.fn(() => Promise.resolve({ ok: false as const, message: 'Refused' }));
    render(
      <FieldChange
        load={{ status: 'ready', data: START_DAY }}
        onApply={onApply}
        onBack={vi.fn()}
      />,
    );
    await user.click(screen.getByRole('combobox', { name: 'For all 2' }));
    await user.click(await screen.findByRole('option', { name: 'HR fills it in later' }));
    await user.click(screen.getByRole('button', { name: 'Apply' }));
    await user.click(screen.getByRole('checkbox', { name: 'Select Marco Rossi' }));
    await user.click(screen.getByRole('combobox', { name: 'For the 1 selected' }));
    await user.click(await screen.findByRole('option', { name: 'Remove it' }));
    await user.click(screen.getByRole('button', { name: 'Apply' }));
    await user.click(screen.getByRole('button', { name: 'Publish the change' }));
    expect(onApply).toHaveBeenCalledWith([
      { personId: MARCO, action: 'clear' },
      { personId: GRACE, action: 'hr' },
    ]);
    // Refused: said, and nothing was published.
    expect(await screen.findByText('Refused')).toBeVisible();
  });

  it('waits in the shape of the page, and says when it could not check', async () => {
    const { container, rerender } = render(
      <FieldChange load={{ status: 'loading' }} onApply={vi.fn()} onBack={vi.fn()} />,
    );
    expect(screen.getByLabelText('Checking every value')).toHaveAttribute('aria-busy', 'true');
    expect(await axeViolations(container)).toEqual([]);
    rerender(
      <FieldChange
        load={{ status: 'error', message: 'No published field called start_day' }}
        onApply={vi.fn()}
        onBack={vi.fn()}
      />,
    );
    expect(screen.getByText('No published field called start_day')).toBeVisible();
  });
});
