// @vitest-environment jsdom
import { cleanup, render, screen, within } from '@testing-library/react';
import axe from 'axe-core';
import type { ComponentPropsWithoutRef } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

let pathname = '/people/directory';
vi.mock('next/navigation', () => ({
  usePathname: () => pathname,
  useRouter: () => ({ push: vi.fn() }),
}));
vi.mock('next/link', () => ({
  default: (props: ComponentPropsWithoutRef<'a'>) => <a data-next-link="" {...props} />,
}));

const { PeopleNav, currentSection } = await import('./people-nav');
const { placesFor } = await import('../lib/remotes');
const manifest = (await import('../../people/public/routes.json')).default;

afterEach(() => {
  cleanup();
});

const nav = { sections: manifest.sections, actions: manifest.actions };

describe('PeopleNav', () => {
  it('lists HR’s sections as client-side links, marks the current one, and offers adding somebody', async () => {
    const { container } = render(
      <PeopleNav {...placesFor(nav, { hr: true, admin: false, finance: false })} />,
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
    render(<PeopleNav {...placesFor(nav, { hr: false, admin: false, finance: false })} />);
    const links = within(screen.getByRole('navigation', { name: 'People sections' }));
    expect(links.getByRole('link', { name: 'Directory' })).toBeTruthy();
    for (const hidden of ['Import', 'Missing information', 'Analytics', 'Employee fields']) {
      expect(links.queryByRole('link', { name: hidden })).toBeNull();
    }
    expect(screen.queryByRole('link', { name: 'Add employee' })).toBeNull();
  });
});

describe('currentSection', () => {
  it('is the longest section holding the path, and the overview only for itself', () => {
    const at = (path: string) => currentSection(manifest.sections, path)?.label;
    expect(at('/people')).toBe('Overview');
    expect(at('/people/reports/abc')).toBe('Scheduled reports');
    expect(at('/people/settings/integrations/x')).toBe('Integrations');
    expect(at('/people/new')).toBeUndefined();
    pathname = '/people';
  });
});
