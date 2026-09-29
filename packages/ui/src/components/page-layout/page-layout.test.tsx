import { TooltipProvider } from '../tooltip/tooltip';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

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

  it('starts as this device remembers, and remembers each change', () => {
    // The clock is the test's: the phases are timed, and a busy runner is not.
    vi.useFakeTimers();
    try {
      localStorage.setItem(KEY, 'expanded');
      shell();
      const nav = screen.getByRole('navigation', { name: 'Main' });
      expect(nav).not.toHaveAttribute('data-collapsed');

      fireEvent.click(screen.getByRole('button', { name: 'Collapse sidebar' }));
      // The labels fade first; the width follows 120ms later.
      expect(nav).toHaveAttribute('data-fading');
      expect(nav).not.toHaveAttribute('data-collapsed');
      act(() => {
        vi.advanceTimersByTime(120);
      });
      expect(nav).toHaveAttribute('data-collapsed');
      expect(nav).not.toHaveAttribute('data-fading');
      expect(localStorage.getItem(KEY)).toBe('collapsed');

      // Expanding moves the width at once, and the labels come back after it.
      fireEvent.keyDown(window, { key: '\\', ctrlKey: true });
      expect(nav).not.toHaveAttribute('data-collapsed');
      expect(localStorage.getItem(KEY)).toBe('expanded');
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('<PageHeader touchBarActions>', () => {
  it('lifts actions into the phone bar without changing their order at a desk', () => {
    render(
      <PageHeaderFrame touchBarActions actions={<a href="/new">New</a>}>
        <PageHeader title="Items" actions={<button type="button">Export</button>} />
      </PageHeaderFrame>,
    );
    const add = screen.getByRole('link', { name: 'New' });
    const exportButton = screen.getByRole('button', { name: 'Export' });
    // The frame's action is in the bar, which is `contents` at a desk: after the page's own.
    expect(add.parentElement?.className).toContain('touch:absolute!');
    expect(
      exportButton.compareDocumentPosition(add) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(exportButton.parentElement?.className).not.toContain('touch:absolute!');
  });

  it('opens with a bar of its own for actions a header lifts with no breadcrumb', () => {
    render(<PageHeader title="People" touchBarActions actions={<a href="/me">Me</a>} />);
    const heading = screen.getByRole('heading', { level: 1, name: 'People' });
    expect(heading.closest('.\\@container')?.className).toContain('touch:pt-12');
    expect(screen.getByRole('link', { name: 'Me' }).parentElement?.className).toContain(
      'touch:absolute!',
    );
  });
});
