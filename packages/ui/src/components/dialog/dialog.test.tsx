import { render, screen } from '@testing-library/react';
import { renderToString } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { Dialog, DialogContent, DialogTitle } from './dialog';

const open = (
  <Dialog open>
    <DialogContent>
      <DialogTitle>Filter people</DialogTitle>
    </DialogContent>
  </Dialog>
);

describe('Dialog', () => {
  it('is in the server’s HTML when it opens with the page', () => {
    expect(renderToString(open)).toContain('Filter people');
  });

  it('is portalled once the page is live', () => {
    const { container } = render(<div data-testid="host">{open}</div>);
    expect(screen.getByRole('dialog', { name: 'Filter people' })).toBeInTheDocument();
    expect(container.querySelector('[role="dialog"]')).toBeNull();
  });
});
