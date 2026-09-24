import { render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { fast } from '../test/user';
import { axeViolations } from '../test/axe';
import { RoleSettings, type RoleSettingsProps, type RolesState } from './roles';

const PRIYA = '00000000-0000-4000-8000-0000000000b1';
const MARCO = '00000000-0000-4000-8000-0000000000b2';

const state = (over: Partial<RolesState> = {}): RolesState => ({
  viewerAccountId: PRIYA,
  canManage: true,
  people: [
    {
      accountId: PRIYA,
      personId: 'p1',
      name: 'Priya Shah',
      workEmail: 'priya@acme.example',
      roles: ['hr', 'people_admin'],
    },
    {
      accountId: MARCO,
      personId: 'p2',
      name: 'Marco Rossi',
      workEmail: 'marco@acme.example',
      roles: [],
    },
  ],
  ...over,
});

function props(over: Partial<RoleSettingsProps> = {}): RoleSettingsProps {
  return {
    load: { status: 'ready', data: state() },
    onGrant: vi.fn(() => Promise.resolve({ ok: true as const })),
    onRevoke: vi.fn(() => Promise.resolve({ ok: true as const })),
    ...over,
  };
}

describe('the roles screen (PEO-112)', () => {
  it('grants a role with the reason given', async () => {
    const p = props();
    render(<RoleSettings {...p} />);
    const user = fast();
    await user.click(screen.getByRole('checkbox', { name: 'Finance for Marco Rossi' }));
    const dialog = screen.getByRole('dialog', { name: 'Make Marco Rossi Finance' });
    await user.click(within(dialog).getByRole('button', { name: 'Grant' }));
    expect(p.onGrant).not.toHaveBeenCalled();
    await user.type(within(dialog).getByRole('textbox', { name: /Reason/ }), 'Runs payroll');
    await user.click(within(dialog).getByRole('button', { name: 'Grant' }));
    expect(p.onGrant).toHaveBeenCalledWith(MARCO, 'finance', 'Runs payroll');
  });

  it('offers no role to oneself, and never the last administrator', () => {
    render(<RoleSettings {...props()} />);
    expect(screen.getByRole('checkbox', { name: 'Finance for Priya Shah' })).toBeDisabled();
    expect(
      screen.getByRole('checkbox', { name: 'People administrator for Priya Shah' }),
    ).toBeDisabled();
    expect(screen.getByRole('checkbox', { name: 'HR for Priya Shah' })).toBeEnabled();
  });

  it('shows People’s refusal as it was worded', async () => {
    const p = props({
      onRevoke: vi.fn(() => Promise.resolve({ ok: false as const, message: 'Not today' })),
    });
    render(<RoleSettings {...p} />);
    const user = fast();
    await user.click(screen.getByRole('checkbox', { name: 'HR for Priya Shah' }));
    const dialog = screen.getByRole('dialog');
    await user.type(within(dialog).getByRole('textbox', { name: /Reason/ }), 'Moving on');
    await user.click(within(dialog).getByRole('button', { name: 'Remove' }));
    expect(await within(dialog).findByText('Not today')).toBeInTheDocument();
  });

  it('shows HR the table without the controls', async () => {
    const { container } = render(
      <RoleSettings {...props({ load: { status: 'ready', data: state({ canManage: false }) } })} />,
    );
    expect(screen.queryByRole('checkbox')).toBeNull();
    expect(screen.getAllByText('People administrator').length).toBeGreaterThan(0);
    expect(await axeViolations(container)).toEqual([]);
  });
});
