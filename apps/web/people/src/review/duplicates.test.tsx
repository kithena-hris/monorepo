import { screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { axeViolations } from '../test/axe';
import { fast } from '../test/user';
import type { DuplicatesState } from './duplicates';
import { renderReview } from './review.fixture';

const queue: DuplicatesState = {
  items: [
    {
      personIds: ['p1', 'p2'],
      names: ['Ada Lovelace', 'Augusta Lovelace'],
      reasons: ['Same work email'],
      match: 'likely',
    },
  ],
  comparison: null,
};

const compared: DuplicatesState = {
  ...queue,
  comparison: {
    people: [
      { id: 'p1', name: 'Ada Lovelace', status: 'active', refusal: null },
      {
        id: 'p2',
        name: 'Augusta Lovelace',
        status: 'provisional',
        refusal: 'Only a record that was never hired can be absorbed.',
      },
    ],
    rows: [
      {
        key: 'given_name',
        label: 'Legal first name',
        values: ['Ada', 'Augusta'],
        same: false,
        takeable: [false, true],
      },
      {
        key: 'es_nif',
        label: 'NIF / NIE',
        values: [null, '•••• 678Z'],
        same: false,
        takeable: [false, false],
      },
      {
        key: 'family_name',
        label: 'Legal family name',
        values: ['Lovelace', 'Lovelace'],
        same: true,
        takeable: [false, false],
      },
    ],
  },
};

const done = () => Promise.resolve({ ok: true as const });
/** Review on its Duplicates chip, with the pair the address names open. */
const duplicates = (data: DuplicatesState, props: Parameters<typeof renderReview>[1] = {}) =>
  renderReview(
    { duplicates: data },
    { kind: 'duplicates', ...(data.comparison === null ? {} : { item: 'dup-p1~p2' }), ...props },
  );

const withMerges: DuplicatesState = {
  ...queue,
  merges: [
    {
      absorbedId: 'p3',
      survivorId: 'p4',
      absorbedName: 'Gracie Hopper',
      survivorName: 'Grace Hopper',
      mergedAt: '2026-09-27T10:00:00.000Z',
      reversed: ['Legal first name'],
      kept: ['Legal family name'],
      account: 'returned',
      refusal: null,
    },
    {
      absorbedId: 'p5',
      survivorId: 'p6',
      absorbedName: 'Yan',
      survivorName: 'Xan',
      mergedAt: '2026-09-26T10:00:00.000Z',
      reversed: [],
      kept: [],
      account: null,
      refusal:
        'The record it was merged into has itself been merged or discarded since; undo that first',
    },
  ],
};

describe('possible duplicates in Review (PEO-074)', () => {
  it('lists pairs and why, as a band never a percentage, and compares from the row', async () => {
    const onItemChange = vi.fn();
    const { container } = duplicates(queue, { onItemChange });
    expect(await axeViolations(container)).toEqual([]);
    const list = screen.getByRole('list', { name: 'Waiting for a decision' });
    expect(
      within(list).getByText(/Possible duplicate of Augusta Lovelace · Same work email/),
    ).toBeInTheDocument();
    expect(within(list).getByText('Likely')).toBeInTheDocument();
    expect(screen.queryByText(/%/u)).toBeNull();
    // Compared on People's side: nothing merges until the pair is open.
    await fast().click(screen.getByRole('button', { name: 'Compare' }));
    expect(onItemChange).toHaveBeenCalledWith('dup-p1~p2');
  });

  it('draws no band for pairs People gave none', () => {
    const { personIds, names, reasons } = queue.items[0] ?? {
      personIds: [],
      names: [],
      reasons: [],
    };
    duplicates({ ...queue, items: [{ personIds, names, reasons }] });
    expect(screen.queryByText('Likely')).toBeNull();
  });

  it('keeps the record People allows, takes only what is ticked, and asks before merging', async () => {
    const onMerge = vi.fn(done);
    const { container } = duplicates(compared, { onMerge });
    expect(await axeViolations(container)).toEqual([]);
    expect(screen.getByRole('radio', { name: /Keep Augusta Lovelace/ })).toBeDisabled();
    expect(screen.getByRole('radio', { name: /Keep Ada Lovelace/ })).toBeChecked();
    expect(screen.getByText('•••• 678Z')).toBeInTheDocument();
    // A sealed value may not be taken: shown, not offered.
    expect(screen.getByRole('radio', { name: /^NIF.*keep Augusta/ })).toBeDisabled();

    const user = fast();
    await user.click(
      screen.getByRole('radio', { name: 'Legal first name: keep Augusta Lovelace' }),
    );
    await user.click(screen.getByRole('button', { name: 'Merge' }));
    expect(screen.getByText(/1 value is copied/)).toBeInTheDocument();
    expect(onMerge).not.toHaveBeenCalled();
    await user.click(screen.getAllByRole('button', { name: 'Merge' }).at(-1) as HTMLElement);
    expect(onMerge).toHaveBeenCalledWith('p1', 'p2', ['given_name']);
  });

  it('says a pair are two people, and says why when People refuses', async () => {
    const onDismiss = vi.fn(() => Promise.resolve({ ok: false as const, message: 'Gone' }));
    duplicates(compared, { onDismiss });
    await fast().click(screen.getByRole('button', { name: 'Not the same person' }));
    expect(onDismiss).toHaveBeenCalledWith('p1', 'p2');
    expect(await screen.findByText('Gone')).toBeInTheDocument();
  });

  it('undoes a merge under Decided, only with a reason, saying first what goes back and what is kept', async () => {
    const onUnmerge = vi.fn(done);
    const { baseElement } = renderReview({ duplicates: withMerges }, { tab: 'decided', onUnmerge });
    expect(screen.getByText(/undo that first/)).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: /Undo merge of/ })).toHaveLength(1);

    const user = fast();
    await user.click(
      screen.getByRole('button', { name: 'Undo merge of Gracie Hopper into Grace Hopper' }),
    );
    const dialog = screen.getByRole('dialog');
    expect(await axeViolations(baseElement)).toEqual([]);
    expect(dialog).toHaveTextContent('Legal first name');
    expect(dialog).toHaveTextContent('Legal family name, changed since the merge');
    expect(dialog).toHaveTextContent('with its sign-in');

    await user.click(screen.getByRole('button', { name: 'Undo merge' }));
    expect(onUnmerge).not.toHaveBeenCalled();
    expect(screen.getByText('Say why.')).toBeInTheDocument();
    await user.type(screen.getByRole('textbox', { name: /Why was the merge wrong/ }), 'Two people');
    await user.click(screen.getByRole('button', { name: 'Undo merge' }));
    expect(onUnmerge).toHaveBeenCalledWith('p3', 'Two people');
  });

  it('loads older merged records as the list nears its end', async () => {
    const [shown] = withMerges.merges ?? [];
    if (shown === undefined) throw new Error('fixture');
    const older = { ...shown, absorbedId: 'p9', absorbedName: 'Ada King', refusal: null };
    const onMoreMerges = vi.fn(() =>
      Promise.resolve({ items: [], merges: [older], mergesNext: null, comparison: null }),
    );
    renderReview(
      { duplicates: { ...withMerges, mergesNext: 'place-1' } },
      { tab: 'decided', onMoreMerges },
    );
    expect(await screen.findByText('Ada King')).toBeInTheDocument();
    expect(onMoreMerges).toHaveBeenCalledWith('place-1');
  });

  it('shows why a pair cannot be merged here, and offers no merge', () => {
    const blocked: DuplicatesState = {
      ...compared,
      comparison: {
        rows: [],
        people: (compared.comparison?.people ?? []).map((p) => ({
          ...p,
          refusal: 'Only a record that was never hired can be absorbed.',
        })),
      },
    };
    duplicates(blocked);
    expect(screen.getByText('These two cannot be merged here')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Merge' })).toBeDisabled();
  });

  it('says so when nothing looks duplicated', () => {
    duplicates({ items: [], comparison: null });
    expect(screen.getByText('Nothing looks duplicated')).toBeInTheDocument();
  });
});
