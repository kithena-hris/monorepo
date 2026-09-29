import { TooltipProvider } from '../tooltip/tooltip';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it } from 'vitest';

import { PageHeader, PageHeaderFrame, PageLayout, railDrag } from './page-layout';

describe('<PageHeaderFrame>', () => {
  it('adds its breadcrumb above the title and its actions after the page’s own', () => {
    render(
      <PageHeaderFrame
        breadcrumb={<nav aria-label="Breadcrumb">Home</nav>}
        actions={<a href="/new">New</a>}
      >
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

  it('draws the frame’s tabs under the header, unless the header has its own', () => {
    const { unmount } = render(
      <PageHeaderFrame tabs={<nav aria-label="Tabs">Frame tabs</nav>}>
        <PageHeader title="Items" />
      </PageHeaderFrame>,
    );
    expect(screen.getByRole('navigation', { name: 'Tabs' })).toBeInTheDocument();
    unmount();
    render(
      <PageHeaderFrame tabs={<span>Frame tabs</span>}>
        <PageHeader title="Items" tabs={<span>Own tabs</span>} />
      </PageHeaderFrame>,
    );
    expect(screen.queryByText('Frame tabs')).toBeNull();
    expect(screen.getByText('Own tabs')).toBeInTheDocument();
  });
});

describe('railDrag', () => {
  it('opens past 160px and snaps shut under it', () => {
    expect(railDrag(76, 100, 248)).toEqual({ width: 176, collapsed: false });
    expect(railDrag(248, -100, 248)).toEqual({ width: 148, collapsed: true });
    expect(railDrag(76, 84, 248)).toEqual({ width: 160, collapsed: true });
  });

  it('holds the edge between the rail and the open sidebar', () => {
    expect(railDrag(76, 900, 248).width).toBe(248);
    expect(railDrag(248, -900, 248).width).toBe(76);
  });
});

describe('<PageLayout> rail', () => {
  const KEY = 'test.sidebar';
  afterEach(() => {
    localStorage.clear();
  });

  const shell = () =>
    render(
      <TooltipProvider>
        <PageLayout
          preset="sidebar"
          sidebarCollapse={{ mode: 'rail', storageKey: KEY }}
          sidebar={<span>Links</span>}
        >
          Content
        </PageLayout>
      </TooltipProvider>,
    );

  it('starts as a rail in a narrow layout when nothing is remembered', () => {
    // jsdom lays nothing out: the layout is 0px wide, well under 1024.
    shell();
    expect(screen.getByRole('navigation', { name: 'Main' })).toHaveAttribute('data-collapsed');
    expect(screen.getByRole('button', { name: 'Expand sidebar' })).toBeInTheDocument();
  });

  it('starts as this device remembers, and remembers each change', async () => {
    localStorage.setItem(KEY, 'expanded');
    shell();
    const nav = screen.getByRole('navigation', { name: 'Main' });
    expect(nav).not.toHaveAttribute('data-collapsed');

    await userEvent.click(screen.getByRole('button', { name: 'Collapse sidebar' }));
    // The labels fade first; the width follows.
    expect(nav).toHaveAttribute('data-fading');
    await waitFor(() => {
      expect(nav).toHaveAttribute('data-collapsed');
    });
    expect(localStorage.getItem(KEY)).toBe('collapsed');

    await userEvent.keyboard('{Control>}\\{/Control}');
    expect(nav).not.toHaveAttribute('data-collapsed');
    expect(localStorage.getItem(KEY)).toBe('expanded');
  });
});
