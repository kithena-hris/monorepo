import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { axeViolations } from '../test/axe';
import { PeopleHome, tenure, waited } from './people-home';
import { ADA, nobody, overview } from './people-home.fixture';

/**
 * The overview: the person first, then what needs them, then their line — and
 * only the parts People handed over, each linking to where it is done.
 */

const ready = (data: ReturnType<typeof overview>) => ({ status: 'ready' as const, data });

/** A part of the page, by its heading. */
const maybe = (name: string): HTMLElement | null =>
  screen.queryByRole('heading', { level: 2, name })?.closest('section') ?? null;
const part = (name: string): HTMLElement => {
  const found = maybe(name);
  if (found === null) throw new Error(`no part headed “${name}”`);
  return found;
};

describe('the overview', () => {
  it('opens on the person: photo, name, what they do, where, since when, and their profile', async () => {
    const { container } = render(<PeopleHome load={ready(overview())} />);
    expect(screen.getByRole('heading', { level: 1, name: 'Ada Lovelace' })).toBeInTheDocument();
    expect(screen.getByText('Engineer · Research')).toBeInTheDocument();
    const details = screen.getByRole('list', { name: 'Your details' });
    expect(within(details).getByText(/Madrid office/)).toBeInTheDocument();
    expect(within(details).getByText(/11:30 local time/)).toBeInTheDocument();
    expect(within(details).getByText(/Joined 4 Mar 2024 · 2 years, 6 months/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'View your profile' })).toHaveAttribute(
      'href',
      '/people/me',
    );
    expect(screen.getByText('2 missing')).toBeInTheDocument();
    expect(await axeViolations(container)).toEqual([]);
  });

  it('lists the first approvals with who and how long, and a way to all of them', () => {
    render(<PeopleHome load={ready(overview())} />);
    const waiting = part('Waiting for your approval');
    expect(
      within(waiting).getByRole('link', { name: /Tim Berners-Lee · Bank account/ }),
    ).toHaveAttribute('href', '/people/approvals');
    expect(within(waiting).getByText('3 days ago')).toBeInTheDocument();
    expect(within(waiting).getByRole('link', { name: 'Show all 7' })).toHaveAttribute(
      'href',
      '/people/approvals',
    );
  });

  it('links each missing detail of theirs to the field itself, and names who fills the rest', () => {
    render(<PeopleHome load={ready(overview())} />);
    const missing = part('Your missing information');
    expect(within(missing).getByText('2 of 7 required details missing')).toBeInTheDocument();
    expect(within(missing).getByRole('link', { name: /Emergency contact/ })).toHaveAttribute(
      'href',
      '/people/me?field=emergency_contact',
    );
    // HR's to fill: shown, and not a link to a form they cannot use.
    expect(within(missing).queryByRole('link', { name: /Cost centre/ })).toBeNull();
    expect(within(missing).getByText(/Waiting on HR/)).toBeInTheDocument();
  });

  it('draws the reporting line from the top down to them, and their reports with “show all”', () => {
    render(<PeopleHome load={ready(overview())} />);
    const line = part('Your reporting line');
    const managers = within(line)
      .getAllByRole('link')
      .map((a) => a.textContent);
    expect(managers.slice(0, 2)).toEqual([
      expect.stringContaining('Grace Hopper'),
      expect.stringContaining('Alan Turing'),
    ]);
    expect(within(line).getByText(/3 others report to Alan Turing/)).toBeInTheDocument();
    expect(within(line).getByRole('link', { name: 'Show all 8' })).toHaveAttribute(
      'href',
      `/people/directory?filter=${encodeURIComponent(`manager_id:${ADA}`)}`,
    );
    expect(within(line).getByRole('link', { name: /Tim Berners-Lee/ })).toHaveAttribute(
      'href',
      '/people/00000000-0000-4000-8000-0000000000a5',
    );
  });

  it('gives HR the team’s gaps, and never an employee', () => {
    const hr = render(<PeopleHome load={ready(overview())} />);
    expect(part('Everybody’s records')).toHaveTextContent('11 details wait for HR');
    hr.unmount();
    render(
      <PeopleHome
        load={ready(
          overview({
            roles: { hr: false, admin: false, finance: false },
            team: null,
            approvals: null,
          }),
        )}
      />,
    );
    expect(maybe('Everybody’s records')).toBeNull();
    expect(maybe('Waiting for your approval')).toBeNull();
  });

  it('says what done looks like when nothing waits and nothing is missing', async () => {
    const full = overview();
    const done = overview({
      approvals: { isHr: true, total: 0, items: [] },
      missing: [],
      me: full.me === null ? null : { ...full.me, missing: 0 },
    });
    const { container } = render(<PeopleHome load={ready(done)} />);
    expect(screen.getByText('Nothing waiting.')).toBeInTheDocument();
    expect(screen.getByText('Your record is complete.')).toBeInTheDocument();
    expect(await axeViolations(container)).toEqual([]);
  });

  it('still opens for an account with no record, and lists no places of its own', async () => {
    const { container } = render(<PeopleHome load={ready(nobody({ hr: true }))} />);
    expect(screen.getByRole('heading', { level: 1, name: 'People' })).toBeInTheDocument();
    expect(maybe('Your reporting line')).toBeNull();
    // The sections are the sidebar's and the breadcrumb's; the overview stays clean.
    expect(screen.queryByRole('navigation')).toBeNull();
    expect(await axeViolations(container)).toEqual([]);
  });
});

describe('the words', () => {
  it('counts tenure in whole months between two calendar dates', () => {
    expect(tenure('2024-03-04', '2026-09-27')).toBe('2 years, 6 months');
    expect(tenure('2026-09-01', '2026-09-27')).toBe('less than a month');
    expect(tenure('2025-09-27', '2026-09-27')).toBe('1 year');
    expect(tenure('2026-10-01', '2026-09-27')).toBeNull();
  });

  it('says how long something waited in days', () => {
    const now = '2026-09-27T09:30:00.000Z';
    expect(waited('2026-09-27T08:00:00.000Z', now)).toBe('today');
    expect(waited('2026-09-26T08:00:00.000Z', now)).toBe('yesterday');
    expect(waited('2026-06-01T08:00:00.000Z', now)).toBe('3 months ago');
  });
});
