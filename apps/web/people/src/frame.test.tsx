import { Button, PageHeader } from '@reach/ui';
import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { framed } from './frame';

const Screen = framed(({ title }: { title: string }) => (
  <PageHeader title={title} actions={<Button>Export</Button>} />
));

describe('framed', () => {
  it('puts the host’s trail above the title and its action last in the same row', () => {
    render(
      <Screen
        title="People"
        frame={{
          section: 'Directory',
          actions: [{ href: '/people/new', label: 'Add employee', icon: 'hire' }],
        }}
      />,
    );
    const trail = within(screen.getByRole('navigation', { name: 'Breadcrumb' }));
    expect(trail.getByRole('link', { name: 'People' }).getAttribute('href')).toBe('/people');
    expect(trail.getByText('Directory').getAttribute('aria-current')).toBe('page');
    // Two copies of the action, one displayed at a time: labelled at a desk,
    // an icon named by its label in the phone's bar under a finger.
    const [add, icon] = screen.getAllByRole('link', { name: 'Add employee' });
    expect(add?.getAttribute('href')).toBe('/people/new');
    expect(add?.textContent).toBe('Add employee');
    expect(icon?.textContent).toBe('');
    expect(icon?.className).toContain('touch:inline-flex');
    // Last in the row at a desk, after the screen's own.
    expect(
      screen.getByRole('button', { name: 'Export' }).nextElementSibling?.firstElementChild,
    ).toBe(add);
  });

  it('on an umbrella page, switches section and tab from the trail, and draws the tabs', () => {
    render(
      <Screen
        title="Data health"
        frame={{
          section: 'Data health',
          siblingsLabel: 'People sections',
          siblings: [
            {
              label: 'People',
              items: [
                { href: '/people', label: 'Overview', icon: 'overview' },
                {
                  href: '/people/data-health/completeness',
                  label: 'Data health',
                  icon: 'health',
                  current: true,
                  count: 6,
                },
              ],
            },
          ],
          tabs: [
            {
              href: '/people/data-health/completeness',
              label: 'Completeness',
              current: false,
              count: 88,
            },
            { href: '/people/data-health/duplicates', label: 'Duplicates', current: true },
          ],
        }}
      />,
    );
    const trail = within(screen.getByRole('navigation', { name: 'Breadcrumb' }));
    // The section is a switcher and no longer the page; the tab is.
    expect(trail.getByRole('button', { name: 'Data health, People sections' })).not.toHaveAttribute(
      'aria-current',
    );
    expect(trail.getByRole('button', { name: 'Duplicates, Data health tabs' })).toHaveAttribute(
      'aria-current',
      'page',
    );
    const tabs = within(screen.getByRole('navigation', { name: 'Data health tabs' }));
    expect(tabs.getByRole('link', { name: 'Duplicates' })).toHaveAttribute('aria-current', 'page');
    expect(tabs.getByRole('link', { name: /Completeness/ })).toHaveAttribute(
      'href',
      '/people/data-health/completeness',
    );
    expect(tabs.getByRole('link', { name: /Completeness/ }).textContent).toContain('88');
  });

  it('draws the screen as it was with no frame, or no trail on the front page', () => {
    const { unmount } = render(<Screen title="People" />);
    expect(screen.queryByRole('navigation')).toBeNull();
    unmount();
    render(<Screen title="People" frame={{ section: null, actions: [] }} />);
    expect(screen.queryByRole('navigation')).toBeNull();
    expect(screen.queryByRole('link')).toBeNull();
  });
});
