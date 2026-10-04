import { setShortcutKeys, screenCommands } from '@reach/ui';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { ApprovalItem } from './approvals/approvals';
import { MissingDetails, type CompletenessState } from './completeness/completeness-grid';
import { renderReview } from './review/review.fixture';
import { axeViolations } from './test/axe';

/**
 * The context actions of a focused row in Review, as the shell binds them: A
 * and R on a change, M and N on a possible duplicate, F and R on Missing
 * details. The keys come
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
  await act(
    () =>
      new Promise<void>((resolve) => {
        requestAnimationFrame(() => {
          resolve();
        });
      }),
  );
}
const bodyRows = (grid: HTMLElement): HTMLElement[] =>
  within(grid)
    .getAllByRole('row')
    .filter((r) => r.hasAttribute('data-row-id'));

describe('Duplicates from the keyboard', () => {
  it('compares the focused pair with M and keeps it apart with N', async () => {
    const onItemChange = vi.fn();
    const onDismiss = vi.fn(done);
    const { container } = renderReview(
      {
        duplicates: {
          items: [
            { personIds: ['p1', 'p2'], names: ['Ada', 'Augusta'], reasons: ['Same email'] },
            { personIds: ['p3', 'p4'], names: ['Grace', 'Gracie'], reasons: ['Same email'] },
          ],
          comparison: null,
        },
      },
      { kind: 'duplicates', onItemChange, onDismiss },
    );
    const list = screen.getByRole('list', { name: 'Waiting for a decision' });
    const [first] = within(list)
      .getAllByRole('button')
      .filter((b) => b.hasAttribute('data-list-row'));
    first?.focus();
    await press('j');
    // With a row focused, the page is still axe-clean.
    expect(await axeViolations(container)).toEqual([]);
    await press('m');
    expect(onItemChange).toHaveBeenCalledWith('dup-p3~p4');
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

  it('moves with J, and A opens the focused change at its note, deciding nothing yet', async () => {
    const onDecide = vi.fn(done);
    renderReview(
      {
        approvals: {
          isHr: true,
          items: [
            { ...item, requestedAt: '2026-09-23T09:00:00.000Z' },
            { ...item, id: 'c2', name: 'Omar Haddad' },
          ],
        },
      },
      { onDecide },
    );
    const list = screen.getByRole('list', { name: 'Waiting for a decision' });
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
    // Not decided yet: Omar's change, open, with the note the decision keeps.
    // (Narrow here, so the pane takes focus as a push does; at a desk the note does.)
    const detail = await screen.findByRole('region', { name: /Omar Haddad/ });
    expect(detail.contains(document.activeElement)).toBe(true);
    expect(within(detail).getByLabelText('Note')).toBeInTheDocument();
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

  it('reminds the focused person with R, fills in with F, and offers both to the palette', async () => {
    const onRemind = vi.fn(done);
    render(
      <MissingDetails
        state={state}
        onSave={vi.fn()}
        onRemind={onRemind}
        onRemindAll={vi.fn(() =>
          Promise.resolve({ ok: true as const, sent: 1, failed: 0, skipped: 0 }),
        )}
      />,
    );
    expect(screenCommands().map((c) => c.label)).toEqual(
      expect.arrayContaining(['Remind 1 person waiting', 'Fill in for all']),
    );
    const [lena, lucia] = bodyRows(screen.getByRole('grid', { name: 'Missing information' }));
    lucia?.focus();
    await press('r');
    expect(onRemind).toHaveBeenCalledWith('u', ['desk']);
    lena?.focus();
    await press('f');
    // That person's own dialog, at once.
    const dialog = screen.getByRole('dialog', { name: 'Fill in for Lena Moreau' });
    expect(within(dialog).getByRole('textbox', { name: 'Desk' })).toBeInTheDocument();
  });
});
