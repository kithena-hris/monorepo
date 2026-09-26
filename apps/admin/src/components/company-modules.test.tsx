import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent, { PointerEventsCheckLevel } from '@testing-library/user-event';
import axe from 'axe-core';
import { describe, expect, it, vi } from 'vitest';

import { CompanyModules, type SaveModulesResult } from './company-modules';

const PRIYA = '00000000-0000-4000-8000-0000000000a1';
const MARCO = '00000000-0000-4000-8000-0000000000a2';
const ALAN = '00000000-0000-4000-8000-0000000000a3';
const BOTH = ['people_admin', 'hr'];
const report = (holders: { accountId: string; roles: string[] }[]) => ({
  [PEOPLE]: { asOf: '2026-09-26T12:00:00.000Z', administratorRoles: BOTH, holders },
});
const PEOPLE = 'module.people';
const TIMEOFF = 'module.timeoff';

type Save = (
  e: string[],
  a: Record<string, string[]>,
  o?: { confirmLast: true },
) => Promise<SaveModulesResult>;

function renderModules(over: Partial<Parameters<typeof CompanyModules>[0]> = {}) {
  const save = vi.fn<Save>(() => Promise.resolve({ ok: true }));
  render(
    <CompanyModules
      recorded={[]}
      effective={[]}
      administrators={{}}
      accounts={[
        { id: PRIYA, email: 'priya@acme.example' },
        { id: MARCO, email: 'marco@acme.example' },
      ]}
      save={save}
      companyName="Acme"
      {...over}
    />,
  );
  return (over.save as ReturnType<typeof vi.fn<Save>> | undefined) ?? save;
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

/** Open a picker by its name and choose somebody in it. */
async function choose(u: ReturnType<typeof user>, picker: string, email: string): Promise<void> {
  await u.click(screen.getByRole('button', { name: picker }));
  await u.click(screen.getByRole('option', { name: email }));
  await u.keyboard('{Escape}');
}

const on = (name: string): HTMLElement => screen.getByRole('switch', { name: `${name} module` });
const saveButton = (): HTMLElement => screen.getByRole('button', { name: 'Save changes' });

describe('the modules tab (PEO-114, PEO-112)', () => {
  it('switches two modules on for the same people in one save', async () => {
    const save = renderModules();
    const u = user();
    expect(
      screen.getByRole('switch', { name: 'Same administrators for every module' }),
    ).toBeChecked();
    await u.click(on('People'));
    await u.click(on('Time off'));
    expect(saveButton()).toBeDisabled();
    expect(screen.getAllByText('Choose who will administer People.')[0]).toBeInTheDocument();

    await choose(u, 'Administrators', 'priya@acme.example');
    await choose(u, 'Administrators', 'marco@acme.example');
    expect(
      screen.getByText('People: switched on; adds priya@acme.example, marco@acme.example'),
    ).toBeInTheDocument();
    expect(save).not.toHaveBeenCalled();

    await u.click(saveButton());
    expect(save).toHaveBeenCalledTimes(1);
    expect(save).toHaveBeenCalledWith([PEOPLE, TIMEOFF], {
      [PEOPLE]: [PRIYA, MARCO],
      [TIMEOFF]: [PRIYA, MARCO],
    });
    expect(await screen.findByText(/Saved\./)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Save changes' })).not.toBeInTheDocument();
  });

  it('gives a module switched on later the shared administrators', async () => {
    const save = renderModules({
      recorded: [PEOPLE],
      effective: [PEOPLE],
      administrators: { [PEOPLE]: [PRIYA] },
    });
    const u = user();
    await u.click(on('Time off'));
    await u.click(saveButton());
    expect(save).toHaveBeenCalledWith([PEOPLE, TIMEOFF], {
      [PEOPLE]: [PRIYA],
      [TIMEOFF]: [PRIYA],
    });
  });

  it('starts per module when the modules differ, and saves each its own list', async () => {
    const save = renderModules({
      recorded: [PEOPLE, TIMEOFF],
      effective: [PEOPLE, TIMEOFF],
      administrators: { [PEOPLE]: [PRIYA, MARCO], [TIMEOFF]: [PRIYA] },
    });
    const u = user();
    expect(
      screen.getByRole('switch', { name: 'Same administrators for every module' }),
    ).not.toBeChecked();
    const people = screen.getByRole('list', { name: 'People administrators, 2 selected' });
    await u.click(within(people).getByRole('button', { name: 'Remove marco@acme.example' }));
    expect(screen.getByText('People: removes marco@acme.example')).toBeInTheDocument();
    await u.click(saveButton());
    expect(save).toHaveBeenCalledWith([PEOPLE, TIMEOFF], {
      [PEOPLE]: [PRIYA],
      [TIMEOFF]: [PRIYA],
    });
  });

  it('turns per-module choices into one, and back, keeping the choice to edit', async () => {
    renderModules({
      recorded: [PEOPLE, TIMEOFF],
      effective: [PEOPLE, TIMEOFF],
      administrators: { [PEOPLE]: [PRIYA], [TIMEOFF]: [MARCO] },
    });
    const u = user();
    const same = screen.getByRole('switch', { name: 'Same administrators for every module' });
    await u.click(same);
    // Everybody from either, so nobody loses a module without seeing it.
    expect(screen.getByRole('list', { name: 'Administrators, 2 selected' })).toBeInTheDocument();
    expect(screen.getByText('People: adds marco@acme.example')).toBeInTheDocument();
    expect(screen.getByText('Time off: adds priya@acme.example')).toBeInTheDocument();
    await u.click(same);
    expect(
      screen.getByRole('list', { name: 'Time off administrators, 2 selected' }),
    ).toBeInTheDocument();
  });

  it('never saves a module without its last administrator', async () => {
    const save = renderModules({
      recorded: [PEOPLE],
      effective: [PEOPLE],
      administrators: { [PEOPLE]: [PRIYA] },
    });
    await user().click(screen.getByRole('button', { name: 'Remove priya@acme.example' }));
    expect(screen.getByText('People keeps at least one administrator.')).toBeInTheDocument();
    expect(saveButton()).toBeDisabled();
    expect(save).not.toHaveBeenCalled();
  });

  it('leaves a module switched on before anybody was named as it is', async () => {
    const save = renderModules({ recorded: [PEOPLE], effective: [PEOPLE], administrators: {} });
    const u = user();
    await u.click(screen.getByRole('switch', { name: 'Same administrators for every module' }));
    await u.click(on('Time off'));
    await choose(u, 'Time off administrators', 'marco@acme.example');
    await u.click(saveButton());
    expect(save).toHaveBeenCalledWith([PEOPLE, TIMEOFF], { [TIMEOFF]: [MARCO] });
  });

  it('confirms before switching a module off, and saves nothing on cancel', async () => {
    const save = renderModules({
      recorded: [PEOPLE, TIMEOFF],
      effective: [PEOPLE, TIMEOFF],
      administrators: { [PEOPLE]: [PRIYA], [TIMEOFF]: [PRIYA] },
    });
    const u = user();
    await u.click(on('Time off'));
    await u.click(saveButton());
    const dialog = screen.getByRole('dialog', { name: 'Switch off Time off' });
    expect(within(dialog).getByText(/Its data is kept/)).toBeInTheDocument();
    await u.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    expect(save).not.toHaveBeenCalled();

    await u.click(saveButton());
    await u.click(screen.getByRole('button', { name: 'Switch off and save' }));
    expect(save).toHaveBeenCalledWith([PEOPLE], { [PEOPLE]: [PRIYA] });
    await waitFor(() => {
      expect(on('Time off')).not.toBeChecked();
    });
  });

  it('keeps the draft and shows why when the save is refused', async () => {
    renderModules({
      recorded: [PEOPLE],
      effective: [PEOPLE],
      administrators: { [PEOPLE]: [PRIYA] },
      save: vi.fn<Save>(() => Promise.resolve({ ok: false, message: 'Identity is down.' })),
    });
    const u = user();
    await u.click(on('Time off'));
    await u.click(saveButton());
    expect(await screen.findByText('Identity is down.')).toBeInTheDocument();
    expect(on('Time off')).toBeChecked();
    // The bar leaves its "Saving…" state a render after the message appears.
    expect(await screen.findByRole('button', { name: 'Save changes' })).toBeEnabled();
  });

  it('discards the draft', async () => {
    renderModules({
      recorded: [PEOPLE],
      effective: [PEOPLE],
      administrators: { [PEOPLE]: [PRIYA] },
    });
    const u = user();
    await u.click(on('Time off'));
    await u.click(screen.getByRole('button', { name: 'Discard' }));
    expect(on('Time off')).not.toBeChecked();
    expect(screen.queryByRole('button', { name: 'Save changes' })).not.toBeInTheDocument();
  });

  it('says a company on the deployment default records its own list on the first save', () => {
    renderModules({ recorded: null, effective: [PEOPLE] });
    expect(screen.getByText(/Saving records its own list/)).toBeInTheDocument();
    expect(on('People')).toBeChecked();
  });

  it('has no axe violations, shared, per module, and confirming', async () => {
    renderModules({
      recorded: [PEOPLE, TIMEOFF],
      effective: [PEOPLE, TIMEOFF],
      administrators: { [PEOPLE]: [PRIYA], [TIMEOFF]: [PRIYA] },
    });
    const u = user();
    expect(await axeViolations()).toEqual([]);
    await u.click(screen.getByRole('switch', { name: 'Same administrators for every module' }));
    expect(await axeViolations()).toEqual([]);
    await u.click(on('Time off'));
    await u.click(saveButton());
    expect(await axeViolations()).toEqual([]);
  });

  it('warns before removing People’s only HR, and tells identity the operator confirmed', async () => {
    const save = renderModules({
      recorded: [PEOPLE],
      effective: [PEOPLE],
      administrators: { [PEOPLE]: [PRIYA, MARCO] },
      moduleRoles: report([
        { accountId: PRIYA, roles: BOTH },
        { accountId: MARCO, roles: ['people_admin'] },
      ]),
    });
    const u = user();
    await u.click(screen.getByRole('button', { name: 'Remove priya@acme.example' }));
    await u.click(saveButton());
    const dialog = screen.getByRole('dialog', { name: 'Acme will be left without HR' });
    expect(within(dialog).getByText(/priya@acme.example is the only HR/)).toBeInTheDocument();
    expect(within(dialog).getByText('Do you want to confirm?')).toBeInTheDocument();
    expect(await axeViolations()).toEqual([]);
    await u.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    expect(save).not.toHaveBeenCalled();

    await u.click(saveButton());
    await u.click(screen.getByRole('button', { name: 'Remove anyway' }));
    expect(save).toHaveBeenCalledWith([PEOPLE], { [PEOPLE]: [MARCO] }, { confirmLast: true });
  });

  it('asks nothing when somebody else still holds each role', async () => {
    const save = renderModules({
      recorded: [PEOPLE],
      effective: [PEOPLE],
      administrators: { [PEOPLE]: [PRIYA, MARCO] },
      moduleRoles: report([
        { accountId: PRIYA, roles: BOTH },
        { accountId: MARCO, roles: BOTH },
      ]),
    });
    const u = user();
    await u.click(screen.getByRole('button', { name: 'Remove priya@acme.example' }));
    await u.click(saveButton());
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(save).toHaveBeenCalledWith([PEOPLE], { [PEOPLE]: [MARCO] });
  });

  it('shows where People differs from what was set here, and grants again on request', async () => {
    const name = vi.fn(() => Promise.resolve({ ok: true as const }));
    renderModules({
      recorded: [PEOPLE],
      effective: [PEOPLE],
      administrators: { [PEOPLE]: [PRIYA, MARCO] },
      accounts: [
        { id: PRIYA, email: 'priya@acme.example' },
        { id: MARCO, email: 'marco@acme.example' },
        { id: ALAN, email: 'alan@acme.example' },
      ],
      moduleRoles: report([
        { accountId: MARCO, roles: ['hr'] },
        { accountId: ALAN, roles: BOTH },
      ]),
      name,
    });
    const differences = screen.getByRole('list', { name: 'Differences in People' });
    expect(within(differences).getByText('Set here, not in People')).toBeInTheDocument();
    expect(within(differences).getByText('Set here, only HR')).toBeInTheDocument();
    expect(
      within(differences).getByText('People administrator and HR in People'),
    ).toBeInTheDocument();
    // Only shown: nothing offers to change who People has that was not set here.
    expect(within(differences).getAllByRole('button', { name: /^Grant again/ })).toHaveLength(2);
    expect(await axeViolations()).toEqual([]);

    await user().click(screen.getByRole('button', { name: 'Grant again to priya@acme.example' }));
    expect(name).toHaveBeenCalledWith(PEOPLE, PRIYA, true);
    expect(
      await within(differences).findByText(
        'Asked People to grant People administrator and HR again.',
      ),
    ).toBeInTheDocument();
  });

  it('says so when People matches what was set here', () => {
    renderModules({
      recorded: [PEOPLE],
      effective: [PEOPLE],
      administrators: { [PEOPLE]: [PRIYA] },
      moduleRoles: report([{ accountId: PRIYA, roles: BOTH }]),
    });
    expect(screen.getByText(/People matches/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^Grant again/ })).not.toBeInTheDocument();
  });

  it('says the company is left without an administrator and the back office must set one up', async () => {
    const save = renderModules({
      recorded: [PEOPLE],
      effective: [PEOPLE],
      administrators: { [PEOPLE]: [PRIYA, MARCO] },
      moduleRoles: report([{ accountId: PRIYA, roles: BOTH }]),
    });
    const u = user();
    await u.click(screen.getByRole('button', { name: 'Remove priya@acme.example' }));
    await u.click(saveButton());
    const dialog = screen.getByRole('dialog', {
      name: 'Acme will be left without a People administrator or HR',
    });
    expect(
      within(dialog).getByText(
        /Nobody at Acme will then be able to manage People or name a new administrator themselves\. The back office has to be contacted to set one up again\./,
      ),
    ).toBeInTheDocument();
    expect(within(dialog).getByText('Do you want to confirm?')).toBeInTheDocument();
    expect(await axeViolations()).toEqual([]);
    await u.click(within(dialog).getByRole('button', { name: 'Remove anyway' }));
    expect(save).toHaveBeenCalledWith([PEOPLE], { [PEOPLE]: [MARCO] }, { confirmLast: true });
  });

  it('adds somebody People already has to the list, granting nothing and asking nothing', async () => {
    const name = vi.fn(() => Promise.resolve({ ok: true as const }));
    renderModules({
      recorded: [PEOPLE],
      effective: [PEOPLE],
      administrators: { [PEOPLE]: [PRIYA] },
      accounts: [
        { id: PRIYA, email: 'priya@acme.example' },
        { id: ALAN, email: 'alan@acme.example' },
      ],
      moduleRoles: report([
        { accountId: PRIYA, roles: BOTH },
        { accountId: ALAN, roles: BOTH },
      ]),
      name,
    });
    // They hold the roles, so there is nothing to grant again: no such offer.
    expect(
      screen.queryByRole('button', { name: 'Grant again to alan@acme.example' }),
    ).not.toBeInTheDocument();
    await user().click(screen.getByRole('button', { name: 'Add to list: alan@acme.example' }));

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(name).toHaveBeenCalledWith(PEOPLE, ALAN, false);
    // On the list now, so no longer a difference, and nothing left to save.
    await waitFor(() => {
      expect(
        screen.queryByRole('button', { name: 'Add to list: alan@acme.example' }),
      ).not.toBeInTheDocument();
    });
    expect(await screen.findByText(/People matches/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Save changes' })).not.toBeInTheDocument();
    expect(await axeViolations()).toEqual([]);
  });
});
