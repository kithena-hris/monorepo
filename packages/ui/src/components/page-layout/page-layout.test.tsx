import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { PageHeader, PageHeaderFrame } from './page-layout';

describe('<PageHeaderFrame>', () => {
  it('adds its breadcrumb above the title and its actions after the page’s own', () => {
    render(
      <PageHeaderFrame breadcrumb={<nav aria-label="Breadcrumb">Home</nav>} actions={<a href="/new">New</a>}>
        <PageHeader title="Items" actions={<button type="button">Export</button>} />
      </PageHeaderFrame>,
    );
    const trail = screen.getByRole('navigation', { name: 'Breadcrumb' });
    const title = screen.getByRole('heading', { level: 1, name: 'Items' });
    expect(trail.compareDocumentPosition(title) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    const exportButton = screen.getByRole('button', { name: 'Export' });
    const add = screen.getByRole('link', { name: 'New' });
    // One row: the same actions container, the frame's last.
    expect(add.parentElement).toBe(exportButton.parentElement);
    expect(exportButton.nextElementSibling).toBe(add);
  });

  it('gives way to a page’s own breadcrumb, and draws actions on a page that has none', () => {
    render(
      <PageHeaderFrame breadcrumb={<span>Frame trail</span>} actions={<a href="/new">New</a>}>
        <PageHeader breadcrumb={<span>Own trail</span>} title="Items" />
      </PageHeaderFrame>,
    );
    expect(screen.queryByText('Frame trail')).toBeNull();
    expect(screen.getByText('Own trail')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'New' })).toBeInTheDocument();
  });

  it('changes nothing outside a frame', () => {
    render(<PageHeader title="Items" />);
    expect(screen.queryByRole('link')).toBeNull();
  });
});
