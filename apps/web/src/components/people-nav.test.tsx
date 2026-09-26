// @vitest-environment jsdom
import { cleanup, render, screen, within } from '@testing-library/react';
import axe from 'axe-core';
import type { ComponentPropsWithoutRef } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn() }),
}));
vi.mock('next/link', () => ({
  default: (props: ComponentPropsWithoutRef<'a'>) => <a data-next-link="" {...props} />,
}));

const { PeopleNav, currentPlace } = await import('./people-nav');
const { placesFor } = await import('../lib/remotes');
const manifest = (await import('../../people/public/routes.json')).default;

afterEach(() => {
  cleanup();
});

const nav = { sections: manifest.sections, actions: manifest.actions };

describe('PeopleNav', () => {
  it('lists HR’s sections as client-side links, marks the current one, and offers adding somebody', async () => {
    const { container } = render(
      <PeopleNav
        {...placesFor(nav, { hr: true, admin: false, finance: false })}
        route="/people/directory"
      />,
    );
    const links = within(screen.getByRole('navigation', { name: 'People sections' }));
    const directory = links.getByRole('link', { name: 'Directory' });
    expect(directory.getAttribute('aria-current')).toBe('page');
    expect(directory.hasAttribute('data-next-link')).toBe(true);
    expect(links.getByRole('link', { name: 'Import' })).toBeTruthy();
    expect(links.getByRole('link', { name: 'Approvals' })).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Add employee' }).getAttribute('href')).toBe(
      '/people/new',
    );
    const result = await axe.run(container, {
      rules: { 'color-contrast': { enabled: false }, region: { enabled: false } },
    });
    expect(result.violations.map((v) => v.id)).toEqual([]);
  });

  it('shows an employee only what their roles open, and no way to add anybody', () => {
    render(
      <PeopleNav
        {...placesFor(nav, { hr: false, admin: false, finance: false })}
        route="/people/me"
      />,
    );
    const links = within(screen.getByRole('navigation', { name: 'People sections' }));
    expect(links.getByRole('link', { name: 'Directory' })).toBeTruthy();
    for (const hidden of ['Import', 'Missing information', 'Analytics', 'Employee fields']) {
      expect(links.queryByRole('link', { name: hidden })).toBeNull();
    }
    expect(screen.queryByRole('link', { name: 'Add employee' })).toBeNull();
  });
});

describe('currentPlace', () => {
  it('is the section at the route or the one the manifest says owns it', () => {
    const at = (route: string) => currentPlace(manifest.sections, route)?.label;
    expect(at('/people')).toBe('Overview');
    expect(at('/people/directory')).toBe('Directory');
    // A profile, its history and bulk editing are the directory's.
    expect(at('/people/:id')).toBe('Directory');
    expect(at('/people/:id/history')).toBe('Directory');
    expect(at('/people/bulk-edit')).toBe('Directory');
    expect(at('/people/me/history')).toBe('My profile');
    expect(at('/people/reports/:id')).toBe('Scheduled reports');
    expect(at('/people/settings/integrations/:id')).toBe('Integrations');
    // Adding somebody is an action, not a section.
    expect(at('/people/new')).toBeUndefined();
    expect(currentPlace(manifest.actions, '/people/new')?.label).toBe('Add employee');
  });

  it('marks the section of a profile, and leaves Add employee off its own screen', () => {
    const hr = placesFor(nav, { hr: true, admin: false, finance: false });
    const { unmount } = render(<PeopleNav {...hr} route="/people/:id" />);
    const links = within(screen.getByRole('navigation', { name: 'People sections' }));
    expect(links.getByRole('link', { name: 'Directory' }).getAttribute('aria-current')).toBe('page');
    expect(screen.getByRole('link', { name: 'Add employee' })).toBeTruthy();
    unmount();

    // Its form's own Add employee is the only one there; no section is current.
    render(<PeopleNav {...hr} route="/people/new" />);
    expect(screen.queryByRole('link', { name: 'Add employee' })).toBeNull();
    expect(document.querySelectorAll('[aria-current="page"]')).toHaveLength(0);
  });

  it('is nothing for a route no place claims', () => {
    expect(currentPlace(manifest.sections, null)).toBeUndefined();
    expect(currentPlace(manifest.sections, '/people/import/:id')).toBeUndefined();
  });

  it('lets every route of the manifest be claimed by at most one section', () => {
    for (const { path } of manifest.routes) {
      const owners = manifest.sections.filter(
        (s) => s.path === path || ('owns' in s && s.owns.includes(path)),
      );
      expect(owners.length, path).toBeLessThanOrEqual(1);
    }
  });
});
