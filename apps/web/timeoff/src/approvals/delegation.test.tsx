import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { Delegation as Framed } from '../index';
import { axeViolations } from '../test/axe';
import { acme, delegation } from './acme.fixture';
import { Delegation, type DelegationData } from './delegation';

/** Delegating approvals (T19) on Acme's demo data: Marco, with Nora Becker above him. */

const ready = (data: DelegationData) => ({ status: 'ready' as const, data });

describe('delegation (T19)', () => {
  it('sets a delegate automatically whenever Marco is away, without salary requests', async () => {
    const { container } = render(<Delegation load={ready(delegation())} />);
    expect(screen.getByRole('heading', { name: 'While I’m away' })).toBeTruthy();
    expect(
      screen.getByRole('checkbox', { name: 'Set automatically whenever my time off is approved' }),
    ).toHaveAttribute('aria-checked', 'true');
    expect(
      screen.getByRole('checkbox', { name: 'Let your delegate see salary-related requests' }),
    ).toHaveAttribute('aria-checked', 'false');
    expect(
      screen.getByText('If neither of you decides in 3 working days, it goes to Nora Becker.'),
    ).toBeTruthy();
    expect(screen.getByText('Nobody has asked you to decide for them.')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();
    expect(await axeViolations(container)).toEqual([]);
  });

  it('saves the delegate chosen, for Marco, and removes one already set', async () => {
    const onSave = vi.fn(() => Promise.resolve({ ok: true as const }));
    const onRemove = vi.fn(() => Promise.resolve({ ok: true as const }));
    const data = delegation();
    render(
      <Framed
        load={ready({
          ...data,
          delegation: {
            delegateId: acme.omar,
            delegateName: 'Omar Haddad',
            range: { from: '2026-10-13', to: '2026-10-16' },
            automatic: true,
            salaryRelated: false,
          },
          coveringFor: [
            { approverId: acme.leo, approverName: 'Leo Rossi', range: null, automatic: true },
          ],
        })}
        onSave={onSave}
        onRemove={onRemove}
      />,
    );
    expect(
      screen.getByRole('checkbox', { name: 'Let Omar see salary-related requests' }),
    ).toBeTruthy();
    expect(screen.getByText('Whenever their time off is approved')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(onSave).toHaveBeenCalledWith(acme.marco, {
      delegateId: acme.omar,
      range: { from: '2026-10-13', to: '2026-10-16' },
      automatic: true,
      salaryRelated: false,
    });
    expect(await screen.findByText('Saved')).toBeTruthy();
    const remove = screen.getByRole('button', { name: 'Remove delegate' });
    await vi.waitFor(() => {
      expect(remove).not.toBeDisabled();
    });
    fireEvent.click(remove);
    expect(onRemove).toHaveBeenCalledWith(acme.marco);
  });

  it('loads in its own shape', async () => {
    const { container } = render(<Delegation load={{ status: 'loading' }} />);
    expect(screen.getByRole('status').textContent).toContain('Loading your delegation');
    expect(await axeViolations(container)).toEqual([]);
  });
});
