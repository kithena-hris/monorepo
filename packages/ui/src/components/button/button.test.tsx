import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { Button } from './button';

describe('<Button>', () => {
  it('defaults to type="button" so it cannot submit a form by accident', () => {
    render(<Button>Cancel</Button>);
    expect(screen.getByRole('button', { name: 'Cancel' })).toHaveAttribute('type', 'button');
  });

  it('honours an explicit type', () => {
    render(<Button type="submit">Save</Button>);
    expect(screen.getByRole('button', { name: 'Save' })).toHaveAttribute('type', 'submit');
  });

  it('blocks interaction while loading', async () => {
    const onClick = vi.fn();
    render(
      <Button loading onClick={onClick}>
        Submit
      </Button>,
    );

    const button = screen.getByRole('button', { name: /submit/i });
    expect(button).toBeDisabled();
    expect(button).toHaveAttribute('aria-busy', 'true');

    await userEvent.click(button, { pointerEventsCheck: 0 });
    expect(onClick).not.toHaveBeenCalled();
  });

  it('keeps the label mounted while loading so the button does not resize', () => {
    render(<Button loading>Approve request</Button>);
    expect(screen.getByRole('button')).toHaveTextContent('Approve request');
  });

  it('renders as the child element when asChild is set', () => {
    render(
      <Button asChild variant="link">
        <a href="/people">Directory</a>
      </Button>,
    );
    const link = screen.getByRole('link', { name: 'Directory' });
    expect(link).toHaveAttribute('href', '/people');
    expect(link).not.toHaveAttribute('type');
  });

  it('lets a caller override a variant class instead of fighting it', () => {
    render(<Button className="rounded-full">Filter</Button>);
    const button = screen.getByRole('button', { name: 'Filter' });
    expect(button.className).toContain('rounded-full');
    expect(button.className).not.toContain('rounded-md');
  });
});
