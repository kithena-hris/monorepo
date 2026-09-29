import { TooltipProvider } from '@reach/ui';
import { render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { axeViolations } from '../test/axe';
import { fast } from '../test/user';
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
    expect(screen.getByRole('heading', { level: 1, name: 'Overview' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 2, name: 'Ada Lovelace' })).toBeInTheDocument();
    expect(screen.getByText('Engineer · Research · Madrid office')).toBeInTheDocument();
    const details = screen.getByRole('list', { name: 'Your details' });
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
    const missing = part('Your profile is 71% complete');
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
    const team = part('Your direct reports 8');
    expect(within(team).getByRole('link', { name: 'Show all 8' })).toHaveAttribute(
      'href',
      `/people/directory?filter=${encodeURIComponent(`manager_id:${ADA}`)}`,
    );
    expect(within(team).getByRole('link', { name: /Tim Berners-Lee/ })).toHaveAttribute(
      'href',
      '/people/00000000-0000-4000-8000-0000000000a5',
    );
  });

  it('gives HR the records’ figures and queues, and never an employee', async () => {
    const figures = {
      headcount: {
        value: 412,
        change: 14,
        trend: [
          { label: 'Aug', value: 398 },
          { label: 'Sep', value: 412 },
        ],
      },
      complete: { percent: 79, incomplete: 88 },
      expiring: 6,
      identifiers: 3,
      duplicates: 2,
      accessRequests: 1,
      joiners: [{ label: 'Sep', value: 14 }],
      starting: [
        { id: 'm', name: 'Mei Tanaka', avatarUrl: null, detail: 'Data analyst', missing: 3 },
      ],
    };
    const hr = render(<PeopleHome load={ready({ ...overview(), hr: figures })} />, {
      wrapper: TooltipProvider,
    });
    const attention = part('Needs attention');
    expect(attention).toHaveTextContent('11 details wait for HR');
    expect(
      within(attention).getByRole('link', { name: /Review: 3 identifiers need review/ }),
    ).toHaveAttribute('href', '/people/identifier-reviews');
    expect(screen.getByText('Headcount')).toBeInTheDocument();
    expect(part('Starting soon')).toHaveTextContent('Mei Tanaka');
    expect(await axeViolations(hr.container)).toEqual([]);
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
    expect(maybe('Needs attention')).toBeNull();
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
    expect(screen.getByRole('heading', { level: 1, name: 'Overview' })).toBeInTheDocument();
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

describe('finishing sign-up on the overview', () => {
  it('asks for the photo and each sign-up file first, and lets what is optional wait', async () => {
    const onSetupFile = vi.fn(() =>
      Promise.resolve({
        ok: true as const,
        file: { id: 'f', name: 'id.pdf', mediaType: 'application/pdf', size: 1000 },
      }),
    );
    const data = {
      ...overview(),
      setup: {
        photo: 'optional' as const,
        fields: [
          {
            key: 'id_scan',
            sectionKey: 'personal',
            label: 'Proof of identity',
            description: null,
            dataType: 'document_ref',
            required: false,
          },
        ],
      },
    };
    const user = fast();
    const { container } = render(
      <PeopleHome load={{ status: 'ready', data }} onPhoto={vi.fn()} onSetupFile={onSetupFile} />,
    );
    expect(screen.getByText('Finish setting up your account')).toBeInTheDocument();
    expect(screen.getByLabelText('Your photo')).toHaveAttribute('type', 'file');
    const file = new File(['%PDF-1.7'], 'id.pdf', { type: 'application/pdf' });
    await user.upload(screen.getByLabelText(/Proof of identity/), file);
    expect(onSetupFile).toHaveBeenCalledWith(data.setup.fields[0], file);
    expect(await axeViolations(container)).toEqual([]);
    await user.click(screen.getByRole('button', { name: 'Later' }));
    expect(screen.queryByText('Finish setting up your account')).toBeNull();
  });
});
