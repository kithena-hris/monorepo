import { setShortcutKeys, screenCommands } from '@reach/ui';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { Approvals, type ApprovalItem } from './approvals/approvals';
import { CompletenessGrid, type CompletenessState } from './completeness/completeness-grid';
import { Duplicates } from './review/duplicates';
import { axeViolations } from './test/axe';

/**
 * The context actions of a focused row, as the shell binds them: A and R on
 * Approvals, M and N on Duplicates, F and R on Completeness. The keys come
 * from the shell's table through Reach's store, as they do in the app.
 */
beforeEach(() => {
  setShortcutKeys({
    keys: {
      'row.approve': ['a'],
      'row.decline': ['r'],
      'row.merge': ['m'],
      'row.not-same': ['n'],
      'row.fill': ['f'],
      'row.remind': ['r'],
    },
    characterKeys: true,
  });
});
afterEach(() => {
  setShortcutKeys({ keys: {}, characterKeys: true });
});

const done = () => Promise.resolve({ ok: true as const });
/** A key on the focused row; focus follows a frame later. */
async function press(key: string): Promise<void> {
  const target = document.activeElement;
  if (target === null) throw new Error('nothing has focus');
  fireEvent.keyDown(target, { key });
  await act(() => new Promise<void>((resolve) => {
      requestAnimationFrame(() => {
        resolve();
      });
    }));
}
const bodyRows = (grid: HTMLElement): HTMLElement[] =>
  within(grid)
    .getAllByRole('row')
    .filter((r) => r.hasAttribute('data-row-id'));

describe('Duplicates from the keyboard', () => {
  it('compares the focused pair with M and keeps it apart with N', async () => {
    const onCompare = vi.fn();
    const onDismiss = vi.fn(done);
    const { container } = render(
      <Duplicates
        load={{
          status: 'ready',
          data: {
            items: [
              { personIds: ['p1', 'p2'], names: ['Ada', 'Augusta'], reasons: ['Same email'] },
              { personIds: ['p3', 'p4'], names: ['Grace', 'Gracie'], reasons: ['Same email'] },
            ],
            comparison: null,
          },
        }}
        onCompare={onCompare}
        onBack={vi.fn()}
        onMerge={vi.fn(done)}
        onDismiss={onDismiss}
        onUnmerge={vi.fn(done)}
      />,
    );
    const [first] = bodyRows(screen.getByRole('grid', { name: 'Possible duplicates' }));
    first?.focus();
    await press('j');
    // With a row focused, the page is still axe-clean.
    expect(await axeViolations(container)).toEqual([]);
    await press('m');
    expect(onCompare).toHaveBeenCalledWith('p3', 'p4');
    await press('n');
    expect(onDismiss).toHaveBeenCalledWith('p3', 'p4');
  });
});

describe('Approvals from the keyboard', () => {
  const item: ApprovalItem = {
    id: 'c1',
    key: 'iban',
    label: 'IBAN',
    kind: 'value',
    value: { last4: '1332' },
    current: { last4: '3000' },
    effectiveFrom: '2026-09-22',
    requestedAt: '2026-09-22T09:00:00.000Z',
    expiresAt: '2026-09-29T09:00:00.000Z',
    requestedBy: 'Lucía Ortega',
    reason: null,
    mine: false,
    canDecide: true,
    personId: 'p1',
    name: 'Lucía Ortega',
    readable: true,
  };

  it('moves with J and approves the focused change with A, through its confirmation', async () => {
    const onDecide = vi.fn(done);
    render(
      <Approvals
        load={{
          status: 'ready',
          data: { isHr: true, items: [item, { ...item, id: 'c2', name: 'Omar Haddad' }] },
        }}
        onDecide={onDecide}
        onWithdraw={vi.fn(done)}
      />,
    );
    const list = screen.getByRole('list', { name: 'Changes waiting for a decision' });
    // The rows themselves, not their action menus.
    const [lucia, omar] = within(list)
      .getAllByRole('button')
      .filter((b) => b.hasAttribute('data-list-row'));
    expect(lucia?.tabIndex).toBe(0);
    expect(omar?.tabIndex).toBe(-1);
    lucia?.focus();
    await press('j');
    expect(document.activeElement).toBe(omar);
    await press('a');
    // Not decided yet: the same confirmation a click opens, with its note.
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText(/Omar Haddad/)).toBeInTheDocument();
    expect(onDecide).not.toHaveBeenCalled();
  });
});

describe('Completeness from the keyboard', () => {
  const state: CompletenessState = {
    since: 'Since version 4',
    waiting: { people: 1, lastReminded: null, due: 1 },
    completedThisWeek: 0,
    toFill: 1,
    blocking: 1,
    complete: null,
    fields: [{ key: 'desk', label: 'Desk', options: [], person: false }],
    rows: [
      {
        personId: 'l',
        name: 'Lena Moreau',
        department: 'Engineering',
        manager: null,
        missing: ['desk'],
        owner: 'hr',
        remindedAt: null,
      },
      {
        personId: 'u',
        name: 'Lucía Fernández',
        department: 'Sales',
        manager: null,
        missing: ['desk'],
        owner: 'employee',
        remindedAt: null,
      },
    ],
  };

  it('reminds the focused person with R, fills in with F, and offers "Remind" to the palette', async () => {
    const onRemind = vi.fn(done);
    render(
      <CompletenessGrid
        load={{ status: 'ready', data: state }}
        onSave={vi.fn()}
        onRemind={onRemind}
        onRemindAll={vi.fn(() => Promise.resolve({ ok: true as const, sent: 1, failed: 0, skipped: 0 }))}
      />,
    );
    expect(screenCommands().map((c) => c.label)).toContain('Remind 1 person waiting');
    const [lena, lucia] = bodyRows(screen.getByRole('grid', { name: 'Missing information' }));
    lucia?.focus();
    await press('r');
    expect(onRemind).toHaveBeenCalledWith('u', ['desk']);
    lena?.focus();
    await press('f');
    expect(await screen.findByRole('textbox', { name: /Desk for Lena Moreau/ })).toBeInTheDocument();
  });
});
