import { render, screen } from '@testing-library/react';
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
