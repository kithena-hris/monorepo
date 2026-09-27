import {
  act,
  createEvent,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ComponentPropsWithoutRef, JSX } from 'react';
import { describe, expect, it } from 'vitest';

import { Nav, NavItem, NavList } from './nav';

/** What a framework's client-side link looks like to Reach: an anchor of its own. */
function FrameworkLink(props: ComponentPropsWithoutRef<'a'>): JSX.Element {
  return <a data-framework="" {...props} />;
}

describe('<NavItem asChild>', () => {
  it('renders the framework link as the item, with the icon, label and badge inside it', () => {
    render(
      <Nav label="People">
        <NavList>
          <NavItem asChild current icon={<svg data-testid="icon" />} badge="3">
            <FrameworkLink href="/people/directory">Directory</FrameworkLink>
          </NavItem>
        </NavList>
      </Nav>,
    );
    const link = screen.getByRole('link', { name: 'Directory3' });
    expect(link).toHaveAttribute('data-framework');
    expect(link).toHaveAttribute('href', '/people/directory');
    expect(link).toHaveAttribute('aria-current', 'page');
    expect(link).toContainElement(screen.getByTestId('icon'));
    // One link, not a link inside a link.
    expect(screen.getAllByRole('link')).toHaveLength(1);
  });
});

describe('<NavItem flyout>', () => {
  function Areas(): JSX.Element {
    return (
      <Nav label="Areas">
        <NavList>
          <NavItem
            asChild
            flyout={
              <Nav label="People sections">
                <NavList>
                  <NavItem asChild level={2}>
                    <FrameworkLink href="/people">Overview</FrameworkLink>
                  </NavItem>
                  <NavItem asChild level={2} current>
                    <FrameworkLink href="/people/directory">Directory</FrameworkLink>
                  </NavItem>
                </NavList>
              </Nav>
            }
          >
            <FrameworkLink href="/people">People</FrameworkLink>
          </NavItem>
          <NavItem href="/documents">Documents</NavItem>
        </NavList>
      </Nav>
    );
  }

  it('is closed until asked, opens on focus, and says so', async () => {
    render(<Areas />);
    const people = screen.getByRole('link', { name: 'People' });
    expect(people).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByRole('navigation', { name: 'People sections' })).toBeNull();

    act(() => {
      people.focus();
    });
    const sections = await screen.findByRole('navigation', { name: 'People sections' });
    expect(people).toHaveAttribute('aria-expanded', 'true');
    expect(people.getAttribute('aria-controls')).toBe(sections.parentElement?.id);
    expect(within(sections).getByRole('link', { name: 'Directory' })).toHaveAttribute(
      'aria-current',
      'page',
    );
    // In place, not in a portal: Tab from People reaches its sections next.
    expect(people.closest('li')).toContainElement(sections);
  });

  it('moves into the sections on ArrowRight, and Escape brings focus back closed', async () => {
    const user = userEvent.setup();
    render(<Areas />);
    const people = screen.getByRole('link', { name: 'People' });
    act(() => {
      people.focus();
    });
    await user.keyboard('{ArrowRight}');
    await waitFor(() => {
      expect(screen.getByRole('link', { name: 'Overview' })).toHaveFocus();
    });
    await user.keyboard('{Escape}');
    expect(people).toHaveFocus();
    await waitFor(() => {
      expect(screen.queryByRole('navigation', { name: 'People sections' })).toBeNull();
    });
  });

  it('opens on a first tap instead of following the link, and follows it on the second', async () => {
    render(<Areas />);
    const people = screen.getByRole('link', { name: 'People' });
    fireEvent.pointerDown(people, { pointerType: 'touch' });
    const first = createEvent.click(people);
    fireEvent(people, first);
    expect(first.defaultPrevented).toBe(true);
    await screen.findByRole('navigation', { name: 'People sections' });

    fireEvent.pointerDown(people, { pointerType: 'touch' });
    const second = createEvent.click(people);
    fireEvent(people, second);
    expect(second.defaultPrevented).toBe(false);
  });
});
