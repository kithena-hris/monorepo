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
        frame={{ section: 'Directory', actions: [{ href: '/people/new', label: 'Add employee' }] }}
      />,
    );
    const trail = within(screen.getByRole('navigation', { name: 'Breadcrumb' }));
    expect(trail.getByRole('link', { name: 'People' }).getAttribute('href')).toBe('/people');
    expect(trail.getByText('Directory').getAttribute('aria-current')).toBe('page');
    const add = screen.getByRole('link', { name: 'Add employee' });
    expect(add.getAttribute('href')).toBe('/people/new');
    expect(screen.getByRole('button', { name: 'Export' }).nextElementSibling).toBe(add);
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
