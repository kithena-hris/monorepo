import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent, { PointerEventsCheckLevel } from '@testing-library/user-event';
import axe from 'axe-core';
import { describe, expect, it, vi } from 'vitest';

import { CompanyModules, type SaveModulesResult } from './company-modules';

const ACCOUNT = '00000000-0000-4000-8000-0000000000a1';

function renderModules(
  over: Partial<Parameters<typeof CompanyModules>[0]> = {},
): ReturnType<typeof vi.fn> {
  const save = vi.fn((_e: string[], _a: Record<string, string>): Promise<SaveModulesResult> =>
    Promise.resolve({ ok: true }),
  );
  render(
    <CompanyModules
      recorded={[]}
      effective={[]}
      accounts={[{ id: ACCOUNT, email: 'priya@acme.example' }]}
      save={save}
      nameAdministrator={() => Promise.resolve({ ok: true })}
      {...over}
    />,
  );
  return (over.save as ReturnType<typeof vi.fn> | undefined) ?? save;
}

// jsdom computes no styles, so contrast is Reach's to prove, not this test's.
async function axeViolations(): Promise<string[]> {
  const result = await axe.run(document.body, {
    rules: { 'color-contrast': { enabled: false }, region: { enabled: false } },
  });
  return result.violations.map(
    (v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`,
  );
}

const user = (): ReturnType<typeof userEvent.setup> =>
  userEvent.setup({ delay: null, pointerEventsCheck: PointerEventsCheckLevel.Never });

describe('the modules tab (PEO-114)', () => {
  it('saves the whole list the moment a switch turns on', async () => {
    const save = renderModules({ recorded: ['module.people'], effective: ['module.people'] });
    const timeoff = screen.getByRole('switch', { name: 'Time off module' });
    expect(timeoff).not.toBeChecked();
    await user().click(timeoff);
    expect(save).toHaveBeenCalledWith(['module.people', 'module.timeoff'], {});
    await waitFor(() => {
      expect(timeoff).toBeChecked();
    });
    expect(screen.getByText(/Time off is on/)).toBeInTheDocument();
  });

  it('asks who administers People before switching it on, and saves with them', async () => {
    const save = renderModules();
    const u = user();
    await u.click(screen.getByRole('switch', { name: 'People module' }));
    expect(save).not.toHaveBeenCalled();
    const dialog = screen.getByRole('dialog', { name: 'Switch on People' });
    expect(within(dialog).getByRole('button', { name: 'Switch on' })).toBeDisabled();
    await u.click(within(dialog).getByRole('combobox'));
    await u.click(screen.getByRole('option', { name: 'priya@acme.example' }));
    await u.click(within(dialog).getByRole('button', { name: 'Switch on' }));
    expect(save).toHaveBeenCalledWith(['module.people'], { 'module.people': ACCOUNT });
    await waitFor(() => {
      expect(screen.getByRole('switch', { name: 'People module' })).toBeChecked();
    });
  });

  it('leaves People off when the dialog is cancelled', async () => {
    const save = renderModules();
    const u = user();
    await u.click(screen.getByRole('switch', { name: 'People module' }));
    await u.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.getByRole('switch', { name: 'People module' })).not.toBeChecked();
    expect(save).not.toHaveBeenCalled();
  });

  it('says to invite somebody first when the company has no accounts', async () => {
    renderModules({ accounts: [] });
    await user().click(screen.getByRole('switch', { name: 'People module' }));
    const dialog = screen.getByRole('dialog', { name: 'Switch on People' });
    expect(within(dialog).getByText(/Invite somebody first/)).toBeInTheDocument();
    expect(within(dialog).queryByRole('button', { name: 'Switch on' })).not.toBeInTheDocument();
  });

  it('confirms before switching a module off', async () => {
    const save = renderModules({
      recorded: ['module.people', 'module.timeoff'],
      effective: ['module.people', 'module.timeoff'],
    });
    const u = user();
    await u.click(screen.getByRole('switch', { name: 'Time off module' }));
    expect(save).not.toHaveBeenCalled();
    const dialog = screen.getByRole('dialog', { name: 'Switch off Time off' });
    expect(within(dialog).getByText(/Its data is kept/)).toBeInTheDocument();
    await u.click(within(dialog).getByRole('button', { name: 'Switch off' }));
    expect(save).toHaveBeenCalledWith(['module.people'], {});
    await waitFor(() => {
      expect(screen.getByRole('switch', { name: 'Time off module' })).not.toBeChecked();
    });
  });

  it('puts the switch back and shows why when the save is refused', async () => {
    renderModules({
      save: vi.fn(() => Promise.resolve({ ok: false, message: 'Identity is down.' } as const)),
    });
    const timeoff = screen.getByRole('switch', { name: 'Time off module' });
    await user().click(timeoff);
    expect(await screen.findByText('Identity is down.')).toBeInTheDocument();
    expect(timeoff).not.toBeChecked();
    expect(timeoff).toBeEnabled();
  });

  it('says a company on the deployment default records its own list on the first flip', () => {
    renderModules({ recorded: null, effective: ['module.people'] });
    expect(screen.getByText(/Flipping any switch records its own list/)).toBeInTheDocument();
    expect(screen.getByRole('switch', { name: 'People module' })).toBeChecked();
  });

  it('has no axe violations, with and without the dialog open', async () => {
    renderModules({ recorded: null, effective: ['module.people'] });
    expect(await axeViolations()).toEqual([]);
    await user().click(screen.getByRole('switch', { name: 'People module' }));
    expect(await axeViolations()).toEqual([]);
  });
});
