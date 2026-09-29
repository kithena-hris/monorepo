import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import { BreadcrumbMenu, filterSiblings } from './breadcrumb';

describe('filterSiblings', () => {
  const groups = [
    {
      label: 'Workspace',
      items: [
        { href: '/a', label: 'Directory' },
        { href: '/b', label: 'Approvals' },
      ],
    },
    { label: 'Records', items: [{ href: '/c', label: 'Import' }] },
  ];

  it('keeps the matches and drops the groups left empty', () => {
    expect(filterSiblings(groups, 'app')).toEqual([
      { label: 'Workspace', items: [{ href: '/b', label: 'Approvals' }] },
    ]);
  });

  it('is everything for an empty query', () => {
    expect(filterSiblings(groups, '  ')).toBe(groups);
  });
});

describe('<BreadcrumbMenu>', () => {
  it('is the current page, and opens the other sections, grouped, as links', async () => {
    render(
      <BreadcrumbMenu
        label="Directory"
        menuLabel="People sections"
        groups={[
          {
            label: 'Workspace',
            items: [
              { href: '/people', label: 'Overview' },
              { href: '/people/directory/list', label: 'Directory', current: true },
            ],
          },
          {
            label: 'Insights',
            items: [{ href: '/people/insights/headcount', label: 'Workforce analytics' }],
          },
        ]}
      />,
    );
    const trigger = screen.getByRole('button', { name: 'Directory, People sections' });
    expect(trigger).toHaveAttribute('aria-current', 'page');

    await userEvent.click(trigger);
    const menu = await screen.findByRole('menu');
    expect(within(menu).getByText('Workspace')).toBeInTheDocument();
    expect(within(menu).getByText('Insights')).toBeInTheDocument();
    const analytics = within(menu).getByRole('menuitem', { name: 'Workforce analytics' });
    expect(analytics).toHaveAttribute('href', '/people/insights/headcount');
    expect(within(menu).getByRole('menuitem', { name: 'Directory' })).toHaveAttribute(
      'aria-current',
      'page',
    );
  });

  it('as a switcher earlier in the trail, is not the page; its items carry icons, counts and a tick', async () => {
    render(
      <BreadcrumbMenu
        label="Data health"
        current={false}
        menuLabel="People sections"
        groups={[
          {
            label: 'People',
            items: [
              { href: '/a', label: 'Approvals', icon: <svg data-testid="icon" />, badge: '4' },
              { href: '/h', label: 'Data health', icon: <svg />, current: true },
            ],
          },
          {
            label: 'In Data health',
            items: [
              { href: '/h/c', label: 'Completeness' },
              { href: '/h/d', label: 'Duplicates', current: true },
            ],
          },
        ]}
      />,
    );
    const trigger = screen.getByRole('button', { name: 'Data health, People sections' });
    expect(trigger).not.toHaveAttribute('aria-current');

    await userEvent.click(trigger);
    const menu = await screen.findByRole('menu');
    // One link per item, the icon and the count inside it.
    const approvals = within(menu).getByRole('menuitem', { name: 'Approvals4' });
    expect(approvals).toContainElement(screen.getByTestId('icon'));
    expect(within(menu).getByRole('menuitem', { name: 'Duplicates' })).toHaveAttribute(
      'aria-current',
      'page',
    );
  });

  it('offers a filter for a long group, not for sections and a page’s tabs together', async () => {
    const items = (n: number, prefix: string) =>
      Array.from({ length: n }, (_, i) => ({
        href: `/${prefix}${String(i)}`,
        label: `${prefix} ${String(i)}`,
      }));
    const { unmount } = render(
      <BreadcrumbMenu
        label="Data health"
        menuLabel="People sections"
        groups={[
          { label: 'People', items: items(6, 'Section') },
          { label: 'In Data health', items: items(4, 'Tab') },
        ]}
      />,
    );
    await userEvent.click(screen.getByRole('button', { name: 'Data health, People sections' }));
    await screen.findByRole('menu');
    expect(screen.queryByRole('searchbox')).toBeNull();
    unmount();

    render(
      <BreadcrumbMenu
        label="Roles"
        menuLabel="People settings"
        groups={[{ label: 'Settings', items: items(8, 'Setting') }]}
      />,
    );
    await userEvent.click(screen.getByRole('button', { name: 'Roles, People settings' }));
    expect(await screen.findByRole('searchbox')).toBeInTheDocument();
  });
});
