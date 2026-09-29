import { TooltipProvider } from '@reach/ui';
import { render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { axeViolations } from '../test/axe';
import { fast } from '../test/user';
import { OrgChartScreen, type OrgPerson } from './org-chart';

const person = (id: string, name: string, managerId: string | null): OrgPerson => ({
  id,
  name,
  title: `${name}'s title`,
  managerId,
  managerName: managerId === null ? null : 'Nora Becker',
  avatarUrl: null,
  status: null,
  team: 'Engineering',
  location: 'Madrid',
});

const people = [
  person('n', 'Nora Becker', null),
  person('m', 'Marco Ruiz', 'n'),
  person('a', 'Adam Novak', 'm'),
];

describe('the org chart', () => {
  it('counts people and managers, and shows who somebody is beside the chart', async () => {
    const user = fast();
    const onOpen = vi.fn();
    const { container } = render(
      <OrgChartScreen
        load={{ status: 'ready', data: { people, truncated: false } }}
        onOpen={onOpen}
      />,
      { wrapper: TooltipProvider },
    );
    expect(screen.getByText('3 people · 2 managers')).toBeInTheDocument();
    await user.click(screen.getByRole('treeitem', { name: /Marco Ruiz/ }));
    const heading = screen.getByRole('heading', { level: 2, name: 'Marco Ruiz' });
    const panel = heading.closest('div.sticky') as HTMLElement;
    await user.click(within(panel).getByRole('button', { name: 'Profile' }));
    expect(onOpen).toHaveBeenCalledWith('m');
    expect(await axeViolations(container)).toEqual([]);
  });

  it('says so when there is nobody to chart', () => {
    render(
      <OrgChartScreen
        load={{ status: 'ready', data: { people: [], truncated: false } }}
        onOpen={vi.fn()}
      />,
      { wrapper: TooltipProvider },
    );
    expect(screen.getByText('Nobody to chart yet')).toBeInTheDocument();
  });
});
