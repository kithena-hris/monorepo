import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { Chip } from './chip';

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
