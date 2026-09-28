import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { Chip, ChipRow } from './chip';

describe('<Chip>', () => {
  it('is a toggle button when it has a selected state', () => {
    render(<Chip selected>Engineering</Chip>);
    expect(screen.getByRole('button', { name: 'Engineering' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
  });

  it('is a plain button as a suggestion', () => {
    render(<Chip variant="dashed">Request time off</Chip>);
    expect(screen.getByRole('button', { name: 'Request time off' })).not.toHaveAttribute(
      'aria-pressed',
    );
  });

  it('names its remove button after the value, and is not itself a button', async () => {
    const onRemove = vi.fn();
    render(
      <Chip field="Team" onRemove={onRemove}>
        Engineering
      </Chip>,
    );
    expect(screen.getAllByRole('button')).toHaveLength(1);
    await userEvent.click(screen.getByRole('button', { name: 'Remove Team Engineering' }));
    expect(onRemove).toHaveBeenCalledOnce();
  });
});

describe('<ChipRow max>', () => {
  const teams = ['Engineering', 'Design', 'Sales', 'Support', 'Finance', 'People', 'Legal'];

  it('folds past `max` into "+N more", which unfolds them', async () => {
    render(
      <ChipRow max={3}>
        {teams.map((team) => (
          <Chip key={team}>{team}</Chip>
        ))}
      </ChipRow>,
    );
    const more = screen.getByRole('button', { name: '+4 more' });
    expect(more).toHaveAttribute('aria-expanded', 'false');
    expect(screen.getByText('Support').parentElement).toHaveClass('hidden');

    await userEvent.click(more);
    expect(screen.getByRole('button', { name: 'Show fewer' })).toHaveAttribute(
      'aria-expanded',
      'true',
    );
    expect(screen.getByText('Support').parentElement).not.toHaveClass('hidden');
  });

  it('draws no fold when everything fits', () => {
    render(
      <ChipRow max={3}>
        <Chip>Engineering</Chip>
      </ChipRow>,
    );
    expect(screen.queryByRole('button', { name: /more/ })).toBeNull();
  });
});
