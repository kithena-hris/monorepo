// @vitest-environment jsdom
import { cleanup, render, screen, within } from '@testing-library/react';
import axe from 'axe-core';
import type { ComponentPropsWithoutRef } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const push = vi.fn();
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push }),
}));
vi.mock('next/link', () => ({
  default: (props: ComponentPropsWithoutRef<'a'>) => <a data-next-link="" {...props} />,
}));

const { PeopleMenu, PeopleSections, PeopleSubnav } = await import('./people-nav');
const { placesFor } = await import('../lib/remotes');
const { EMPLOYEE, HR, PEOPLE_NAV } = await import('../lib/people-nav.fixture');
const manifest = (await import('../../people/public/routes.json')).default;

afterEach(() => {
  cleanup();
});

const hr = placesFor(PEOPLE_NAV, HR);

describe('PeopleSubnav', () => {
  it('lists the sections under People as client-side links, marking the one a tab is in', () => {
    render(
      <ul>
        <li>
          <PeopleSubnav
            {...hr}
            route="/people/review/flagged"
            counts={{ '/people/review/waiting': 4 }}
          />
        </li>
      </ul>,
    );
    const list = within(screen.getByRole('list', { name: 'People sections' }));
    const review = list.getByRole('link', { name: /Review/ });
    expect(review.getAttribute('aria-current')).toBe('page');
    expect(review.getAttribute('href')).toBe('/people/review/waiting');
    expect(review.hasAttribute('data-next-link')).toBe(true);
    expect(review.textContent).toContain('4');
    expect(list.getAllByRole('link')).toHaveLength(4);
  });
});

describe('PeopleSections', () => {
  it('is the rail’s compact flyout: four described places, the current one marked', async () => {
    const { container } = render(
      <main>
        <PeopleSections {...hr} route="/people/:id" counts={{ '/people/review/waiting': 9 }} />
      </main>,
    );
    const links = within(screen.getByRole('navigation', { name: 'People sections' }));
    const directory = links.getByRole('link', { name: 'Directory' });
    expect(directory.getAttribute('aria-current')).toBe('page');
    expect(links.getAllByRole('link')).toHaveLength(4);
    expect(links.getByRole('link', { name: /Review/ }).textContent).toContain('9');
    expect(screen.getByRole('link', { name: 'Settings › People' })).toBeTruthy();
    // No second header row: the breadcrumb and the actions are the screen's.
    expect(screen.queryByRole('navigation', { name: 'Breadcrumb' })).toBeNull();
    expect(screen.queryByRole('link', { name: 'Add person' })).toBeNull();
    const result = await axe.run(container, {
      rules: { 'color-contrast': { enabled: false }, region: { enabled: false } },
    });
    expect(result.violations.map((v) => v.id)).toEqual([]);
    // The file's first axe run: its cold start alone can pass 5s on a busy runner.
  }, 20_000);

  it('shows an employee only what their roles open, and marks nothing on adding somebody', () => {
    render(<PeopleSections {...placesFor(PEOPLE_NAV, EMPLOYEE)} route="/people/new" />);
    const links = within(screen.getByRole('navigation', { name: 'People sections' }));
    expect(links.getAllByRole('link').map((l) => l.textContent)).toEqual([
      expect.stringContaining('Directory'),
      expect.stringContaining('Review'),
      expect.stringContaining('Import & export'),
    ]);
    expect(
      screen
        .getByRole('navigation', { name: 'People sections' })
        .querySelectorAll('[aria-current]'),
    ).toHaveLength(0);
  });
});

describe('PeopleMenu', () => {
  it('lists the four sections as rows with what each holds, and what waits for you (MA A1)', () => {
    render(
      <main>
        <PeopleMenu {...hr} route={null} counts={{ '/people/review/waiting': 11 }} />
      </main>,
    );
    const rows = within(screen.getByRole('list', { name: 'People sections' }));
    expect(rows.getByRole('link', { name: /Review/ }).textContent).toContain('11 waiting for you');
    expect(rows.getByRole('link', { name: /Directory/ }).textContent).toContain(
      'Everyone, as a list, cards or an org chart',
    );
    expect(rows.getAllByRole('link')).toHaveLength(4);
    expect(screen.getByText('Your own profile is in the Me tab.')).toBeTruthy();
  });

  it('says how many people the search covers, and nothing when People did not say', () => {
    const { rerender } = render(<PeopleMenu {...hr} route={null} total={412} />);
    expect(screen.getByPlaceholderText('Search 412 people')).toBeTruthy();
    rerender(<PeopleMenu {...hr} route={null} total={null} />);
    expect(screen.getByPlaceholderText('Search people')).toBeTruthy();
  });
});

describe('the manifest', () => {
  it('lets every route be claimed by at most one section', () => {
    const sections: {
      path: string;
      owns?: string[];
      tabs?: { path: string; owns?: string[] }[];
    }[] = manifest.sections;
    const claims = (p: { path: string; owns?: string[] }, route: string) =>
      p.path === route || (p.owns ?? []).includes(route);
    for (const { path } of manifest.routes) {
      const owners = sections.filter(
        (s) => claims(s, path) || (s.tabs ?? []).some((t) => claims(t, path)),
      );
      expect(owners.length, path).toBeLessThanOrEqual(1);
    }
  });
});
