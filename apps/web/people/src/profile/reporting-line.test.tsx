import { TooltipProvider } from '@reach/ui';
import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { axeViolations } from '../test/axe';
import { ReportingLine } from './reporting-line';

const p = (id: string, name: string, title: string | null = null) => ({ id, name, title, avatarUrl: null });

describe('ReportingLine', () => {
  it('reads from the top down to the person, then names their peers', async () => {
    const { container } = render(
      <ReportingLine
        line={{
          chain: [p('ceo', 'Grace Hopper', 'CEO'), p('vp', 'Ada Lovelace', 'VP')],
          peers: [p('a', 'Alan Kay'), p('b', 'Barbara Liskov', 'Engineer')],
          morePeers: false,
        }}
        person={{ name: 'Alan Turing', title: 'Engineer', avatarUrl: null }}
      />,
      { wrapper: TooltipProvider },
    );
    const line = screen.getByRole('list', { name: 'Alan Turing’s reporting line' });
    const names = within(line).getAllByRole('listitem').map((li) => li.textContent);
    expect(names[0]).toContain('Grace Hopper');
    expect(names[1]).toContain('Ada Lovelace');
    expect(names[2]).toContain('Alan Turing');
    expect(screen.getByRole('link', { name: 'Grace Hopper' })).toHaveAttribute('href', '/people/ceo');
    expect(screen.getByRole('group', { name: 'Peers: Alan Kay, Barbara Liskov' })).toBeInTheDocument();
    expect(screen.getByText(/2 peers with the same manager as Alan/)).toBeInTheDocument();
    expect(await axeViolations(container)).toEqual([]);
  });

  it('draws nothing for somebody with no manager and no peers', () => {
    const { container } = render(
      <ReportingLine
        line={{ chain: [], peers: [], morePeers: false }}
        person={{ name: 'Grace Hopper', title: 'CEO', avatarUrl: null }}
      />,
    );
    expect(container).toBeEmptyDOMElement();
  });
});
