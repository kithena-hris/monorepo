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

const { PeopleMenu, PeopleSections, currentPlace } = await import('./people-nav');
const { headerFrame, placesFor } = await import('../lib/remotes');
const manifest = (await import('../../people/public/routes.json')).default;

afterEach(() => {
  cleanup();
});

const nav = { sections: manifest.sections, actions: manifest.actions };

/** The sidebar's People menu, as the shell hangs it off the People item. */
function People(props: Parameters<typeof PeopleSections>[0]) {
  return (
    <main>
      <PeopleSections sections={props.sections} route={props.route} />
    </main>
  );
}

describe('PeopleSections', () => {
  it('lists HR’s sections as client-side links and marks the current one', async () => {
    const { container } = render(
      <People
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
    // No second header row: the breadcrumb and the actions are the screen's.
    expect(screen.queryByRole('navigation', { name: 'Breadcrumb' })).toBeNull();
    expect(screen.queryByRole('link', { name: 'Add employee' })).toBeNull();
    const result = await axe.run(container, {
      rules: { 'color-contrast': { enabled: false }, region: { enabled: false } },
    });
    expect(result.violations.map((v) => v.id)).toEqual([]);
    // The file's first axe run: its cold start alone can pass 5s on a busy runner.
  }, 20_000);

  it('shows an employee only what their roles open', () => {
    render(
      <People
        {...placesFor(nav, { hr: false, admin: false, finance: false })}
        route="/people/me"
      />,
    );
    const links = within(screen.getByRole('navigation', { name: 'People sections' }));
    expect(links.getByRole('link', { name: 'Directory' })).toBeTruthy();
    for (const hidden of [
      'Import',
      'Data completeness',
      'Workforce analytics',
      'Employee fields',
    ]) {
      expect(links.queryByRole('link', { name: hidden })).toBeNull();
    }
  });
});

describe('PeopleMenu', () => {
  it('lists the sections as rows, with a count only where something waits', () => {
    const hr = placesFor(nav, { hr: true, admin: false, finance: false });
    render(
      <main>
        <PeopleMenu {...hr} route={null} counts={{ '/people/approvals': 4 }} />
      </main>,
    );
    const approvals = screen.getByRole('link', { name: /Approvals/ });
    expect(approvals.textContent).toContain('4');
    expect(screen.getByRole('link', { name: 'Directory' })).toBeTruthy();
    expect(screen.getByRole('region', { name: 'Records' })).toBeTruthy();
  });
});

describe('headerFrame', () => {
  const hr = placesFor(nav, { hr: true, admin: false, finance: false });

  it('names the section for the breadcrumb and offers adding somebody', () => {
    const frame = headerFrame(hr, '/people/directory', '/people');
    expect(frame.section).toBe('Directory');
    expect(frame.actions).toEqual([{ href: '/people/new', label: 'Add employee' }]);
    // The last crumb is a menu of the other sections, grouped, this one marked.
    const workspace = frame.siblings.find((g) => g.label === 'Workspace');
    expect(workspace?.items.find((i) => i.current)?.label).toBe('Directory');
    expect(frame.siblings.map((g) => g.label)).toEqual(['Workspace', 'Records', 'Insights']);
    // A profile is the Directory's.
    expect(headerFrame(hr, '/people/:id', '/people').section).toBe('Directory');
  });

  it('has no trail on People’s front page, and no Add employee on its own form', () => {
    expect(headerFrame(hr, '/people', '/people').section).toBeNull();
    const adding = headerFrame(hr, '/people/new', '/people');
    expect(adding.section).toBe('Add employee');
    expect(adding.actions).toEqual([]);
  });

  it('offers adding somebody where it belongs, and not on a profile', () => {
    expect(headerFrame(hr, '/people', '/people').actions).toHaveLength(1);
    expect(headerFrame(hr, '/people/:id', '/people').actions).toEqual([]);
    expect(headerFrame(hr, '/people/me', '/people').actions).toEqual([]);
  });

  it('offers an employee nothing to start', () => {
    const employee = placesFor(nav, { hr: false, admin: false, finance: false });
    expect(headerFrame(employee, '/people/me', '/people').actions).toEqual([]);
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
    expect(at('/people/reports/:id')).toBe('Report schedules');
    // Settings are the Settings page's, not People's sections.
    expect(at('/settings/people/integrations/:id')).toBeUndefined();
    expect(currentPlace(manifest.settings, '/settings/people/integrations/:id')?.label).toBe(
      'Integrations',
    );
    // Adding somebody is an action, not a section.
    expect(at('/people/new')).toBeUndefined();
    expect(currentPlace(manifest.actions, '/people/new')?.label).toBe('Add employee');
  });

  it('marks the section of a profile, and no section on adding somebody', () => {
    const hr = placesFor(nav, { hr: true, admin: false, finance: false });
    const { unmount } = render(<People {...hr} route="/people/:id" />);
    const links = within(screen.getByRole('navigation', { name: 'People sections' }));
    expect(links.getByRole('link', { name: 'Directory' }).getAttribute('aria-current')).toBe(
      'page',
    );
    unmount();

    render(<People {...hr} route="/people/new" />);
    const sections = screen.getByRole('navigation', { name: 'People sections' });
    expect(sections.querySelectorAll('[aria-current="page"]')).toHaveLength(0);
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
