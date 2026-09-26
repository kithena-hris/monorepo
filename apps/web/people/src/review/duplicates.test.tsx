import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { axeViolations } from '../test/axe';
import { fast } from '../test/user';
import { Duplicates, type DuplicatesState } from './duplicates';

const queue: DuplicatesState = {
  items: [
    { personIds: ['p1', 'p2'], names: ['Ada Lovelace', 'Augusta Lovelace'], reasons: ['Same work email'] },
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
      { key: 'given_name', label: 'Legal first name', values: ['Ada', 'Augusta'], same: false, takeable: [false, true] },
      { key: 'es_nif', label: 'NIF / NIE', values: [null, '•••• 678Z'], same: false, takeable: [false, false] },
      { key: 'family_name', label: 'Legal family name', values: ['Lovelace', 'Lovelace'], same: true, takeable: [false, false] },
    ],
  },
};

const done = () => Promise.resolve({ ok: true as const });
const props = {
  onCompare: vi.fn(),
  onBack: vi.fn(),
  onMerge: vi.fn(done),
  onDismiss: vi.fn(done),
};

describe('HR’s duplicate review (PEO-074)', () => {
  it('lists pairs and why, and merges nothing from the list', async () => {
    const onCompare = vi.fn();
    const { container } = render(
      <Duplicates {...props} onCompare={onCompare} load={{ status: 'ready', data: queue }} />,
    );
    expect(await axeViolations(container)).toEqual([]);
    expect(screen.getByText('Same work email')).toBeInTheDocument();
    await fast().click(screen.getByRole('button', { name: /Compare Ada Lovelace and Augusta/ }));
    expect(onCompare).toHaveBeenCalledWith('p1', 'p2');
  });

  it('keeps the record People allows, takes only what is ticked, and asks before merging', async () => {
    const onMerge = vi.fn(done);
    const { container } = render(
      <Duplicates {...props} onMerge={onMerge} load={{ status: 'ready', data: compared }} />,
    );
    expect(await axeViolations(container)).toEqual([]);
    expect(screen.getByRole('radio', { name: /Keep Augusta Lovelace/ })).toBeDisabled();
    expect(screen.getByRole('radio', { name: /Keep Ada Lovelace/ })).toBeChecked();
    expect(screen.getByText('•••• 678Z')).toBeInTheDocument();
    expect(screen.queryByRole('checkbox', { name: /NIF/ })).not.toBeInTheDocument();

    const user = fast();
    await user.click(screen.getByRole('checkbox', { name: "Use Augusta Lovelace's Legal first name" }));
    await user.click(screen.getByRole('button', { name: 'Merge' }));
    expect(screen.getByText(/1 value is copied/)).toBeInTheDocument();
    expect(onMerge).not.toHaveBeenCalled();
    await user.click(screen.getAllByRole('button', { name: 'Merge' }).at(-1) as HTMLElement);
    expect(onMerge).toHaveBeenCalledWith('p1', 'p2', ['given_name']);
  });

  it('says a pair are two people', async () => {
    const onDismiss = vi.fn(done);
    render(<Duplicates {...props} onDismiss={onDismiss} load={{ status: 'ready', data: compared }} />);
    await fast().click(screen.getByRole('button', { name: 'Not the same person' }));
    expect(onDismiss).toHaveBeenCalledWith('p1', 'p2');
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
    render(<Duplicates {...props} load={{ status: 'ready', data: blocked }} />);
    expect(screen.getByText('These two cannot be merged here')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Merge' })).toBeDisabled();
  });
});
