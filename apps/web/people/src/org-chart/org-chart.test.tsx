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

  it('is the Directory with Org chart chosen, its search and direction on the canvas (V3)', async () => {
    const user = fast();
    const onViewChange = vi.fn();
    render(
      <OrgChartScreen
        load={{ status: 'ready', data: { people, truncated: false } }}
        onOpen={vi.fn()}
        onViewChange={onViewChange}
      />,
      { wrapper: TooltipProvider },
    );
    expect(screen.getByRole('heading', { level: 1, name: 'Directory' })).toBeInTheDocument();
    const [views] = screen.getAllByRole('radiogroup', { name: 'Show people as' });
    expect(within(views as HTMLElement).getByRole('radio', { name: 'Org chart' })).toBeChecked();
    expect(screen.getByRole('radiogroup', { name: 'Direction' })).toBeInTheDocument();
    expect(screen.getByText('Find a person or team')).toBeInTheDocument();
    await user.click(within(views as HTMLElement).getByRole('radio', { name: 'Cards' }));
    expect(onViewChange).toHaveBeenCalledWith('cards');
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

describe('the org chart’s direction and search, in the address', () => {
  it('opens as a link left it, and hands each change to the host', async () => {
    const user = fast();
    const onLayoutChange = vi.fn();
    render(
      <OrgChartScreen
        load={{ status: 'ready', data: { people, truncated: false } }}
        onOpen={vi.fn()}
        layout="horizontal"
        onLayoutChange={onLayoutChange}
        focusId="a"
        onFocusChange={vi.fn()}
      />,
      { wrapper: TooltipProvider },
    );
    const direction = screen.getByRole('radiogroup', { name: 'Direction' });
    expect(within(direction).getByRole('radio', { name: 'Left to right' })).toBeChecked();
    expect(screen.getByRole('button', { name: 'Find someone' })).toHaveTextContent('Adam Novak');
    await user.click(within(direction).getByRole('radio', { name: 'Top down' }));
    expect(onLayoutChange).toHaveBeenCalledWith('vertical');
  });

  it('shows everybody for a focus that is not on this viewer’s chart', () => {
    render(
      <OrgChartScreen
        load={{ status: 'ready', data: { people, truncated: false } }}
        onOpen={vi.fn()}
        focusId="somebody-else"
        onFocusChange={vi.fn()}
      />,
      { wrapper: TooltipProvider },
    );
    expect(screen.getByRole('button', { name: 'Find someone' })).not.toHaveTextContent(
      /Adam|Marco|Nora/,
    );
  });
});
