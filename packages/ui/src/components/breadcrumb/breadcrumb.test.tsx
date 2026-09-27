import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import { BreadcrumbMenu } from './breadcrumb';

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
              { href: '/people/directory', label: 'Directory', current: true },
            ],
          },
          {
            label: 'Insights',
            items: [{ href: '/people/analytics', label: 'Workforce analytics' }],
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
    expect(analytics).toHaveAttribute('href', '/people/analytics');
    expect(within(menu).getByRole('menuitem', { name: 'Directory' })).toHaveAttribute(
      'aria-current',
      'page',
    );
  });
});
