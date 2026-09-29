import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import { MegaMenu } from './mega-menu';
import { Nav, NavGroup, NavItem, NavList } from './nav';

describe('<MegaMenu>', () => {
  it('moves down a column and across to the next', async () => {
    render(
      <MegaMenu>
        <Nav label="People">
          <NavList columns={2}>
            <NavGroup label="Workspace">
              <NavItem href="#a" description="A">
                Overview
              </NavItem>
              <NavItem href="#b" description="B">
                Directory
              </NavItem>
            </NavGroup>
            <NavGroup label="Records">
              <NavItem href="#c" description="C">
                Import
              </NavItem>
              <NavItem href="#d" description="D">
                Export
              </NavItem>
            </NavGroup>
          </NavList>
        </Nav>
      </MegaMenu>,
    );
    screen.getByRole('link', { name: 'Overview' }).focus();
    await userEvent.keyboard('{ArrowDown}');
    expect(screen.getByRole('link', { name: 'Directory' })).toHaveFocus();
    await userEvent.keyboard('{ArrowRight}');
    expect(screen.getByRole('link', { name: 'Export' })).toHaveFocus();
    await userEvent.keyboard('{ArrowDown}');
    expect(screen.getByRole('link', { name: 'Import' })).toHaveFocus();
  });
});
