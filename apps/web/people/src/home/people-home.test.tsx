import { TooltipProvider } from '@reach/ui';
import { render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { axeViolations } from '../test/axe';
import { fast } from '../test/user';
import { PeopleHome, tenure, waited } from './people-home';
import { ADA, nobody, overview } from './people-home.fixture';

/**
 * Home (B1, B2): "Hi" and what needs them; for an employee one To do list,
 * who they are and their line; for HR the figures and "Needs HR", each row
 * opening Review with its chip chosen. Only what People handed over is drawn.
 */

const ready = (data: ReturnType<typeof overview>) => ({ status: 'ready' as const, data });

/** A part of the page, by its heading. */
const maybe = (name: string | RegExp): HTMLElement | null =>
  screen.queryByRole('heading', { level: 2, name })?.closest('section') ?? null;
const part = (name: string | RegExp): HTMLElement => {
  const found = maybe(name);
  if (found === null) throw new Error(`no part headed “${String(name)}”`);
  return found;
};

/** Ada as an employee: her own change waits on HR. */
const employee = (over: Partial<ReturnType<typeof overview>> = {}) =>
  overview({
    roles: { hr: false, admin: false, finance: false },
    team: null,
    approvals: {
      isHr: false,
      total: 1,
      items: [
        {
          id: 'c9',
          personId: ADA,
          name: 'Ada Lovelace',
          avatarUrl: null,
          label: 'Home address',
          requestedAt: '2026-09-25T08:00:00.000Z',
          requestedBy: 'Ada Lovelace',
        },
      ],
    },
    ...over,
  });

describe('Home, as an employee (B1)', () => {
  it('greets them, with today where they work, and says who they are', async () => {
    const { container } = render(<PeopleHome load={ready(employee())} />);
    expect(screen.getByRole('heading', { level: 1, name: 'Hi Ada' })).toBeInTheDocument();
    expect(screen.getByText(/^Sunday 27 September · 11:30 in Madrid office$/)).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 2, name: 'Ada Lovelace' })).toBeInTheDocument();
    expect(screen.getByText('Engineer · Research · Madrid office')).toBeInTheDocument();
    expect(screen.getByText(/4 Mar 2024 · 2 years, 6 months/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'View your profile' })).toHaveAttribute(
      'href',
      '/people/me',
    );
    expect(screen.getByText('2 missing')).toBeInTheDocument();
    expect(await axeViolations(container)).toEqual([]);
  });

  it('draws the host’s To do in its place when given one, as plain data', () => {
    render(
      <PeopleHome
        load={ready(employee())}
        toDo={{
          href: '/inbox/todo',
          tasks: [
            {
              id: 'people:onboarding:1',
              title: 'Finish your profile',
              description: 'People › Onboarding',
              href: '/inbox/todo?item=people%3Aonboarding%3A1',
              icon: 'list',
            },
          ],
          waiting: [],
        }}
      />,
    );
    const todo = part('To do');
    expect(
      within(todo).getAllByRole('link', { name: 'Open: Finish your profile' })[0],
    ).toHaveAttribute('href', '/inbox/todo?item=people%3Aonboarding%3A1');
    expect(within(todo).getByRole('link', { name: 'Open Inbox' })).toHaveAttribute(
      'href',
      '/inbox/todo',
    );
    // People's own list is not drawn beside it.
    expect(within(todo).queryByText('71%')).toBeNull();
    expect(maybe('Waiting on others')).toBeNull();
  });

  it('keeps one To do list: their missing details and their changes with HR, one button each', () => {
    render(<PeopleHome load={ready(employee())} />);
    const todo = part('To do');
    expect(within(todo).getByText('71%')).toBeInTheDocument();
    expect(
      within(todo).getByRole('progressbar', { name: '2 of 7 required details missing' }),
    ).toBeInTheDocument();
    const [add] = within(todo).getAllByRole('link', { name: 'Add: Add your emergency contact' });
    expect(add).toHaveAttribute('href', '/people/me?field=emergency_contact');
    expect(within(todo).getByText('Your new home address is with HR')).toBeInTheDocument();
    const [open] = within(todo).getAllByRole('link', {
      name: 'Open: Your new home address is with HR',
    });
    expect(open).toHaveAttribute('href', '/people/review/waiting?kind=changes&item=change-c9');
    // HR's to fill: named, and not a link to a form they cannot use.
    expect(within(todo).queryByRole('link', { name: /Cost centre/ })).toBeNull();
    expect(within(todo).getByText(/Waiting on HR, nothing for you to do/)).toBeInTheDocument();
  });

  it('puts what HR sent back first on To do, to correct, with HR’s reason (B1)', () => {
    render(
      <PeopleHome
        load={ready(
          employee({
            corrections: [
              {
                key: 'es_nif',
                label: 'National ID',
                sectionKey: 'personal',
                reason: 'The check digit doesn’t match.',
              },
            ],
          }),
        )}
      />,
    );
    const todo = screen.getByRole('list', { name: 'To do' });
    expect(within(todo).getAllByRole('listitem')[0]).toHaveTextContent('Correct your National ID');
    expect(
      within(todo).getByText('HR could not accept it: the check digit doesn’t match.'),
    ).toBeInTheDocument();
    expect(
      within(todo).getAllByRole('link', { name: 'Correct it: Correct your National ID' })[0],
    ).toHaveAttribute('href', '/people/me?field=es_nif');
  });

  it('draws the reporting line from the top down to them, and their reports with “show all”', () => {
    render(<PeopleHome load={ready(employee())} />);
    const line = part('Your reporting line');
    const people = within(within(line).getByRole('list', { name: 'Your managers, from the top' }))
      .getAllByRole('link')
      .map((a) => a.textContent);
    expect(people.slice(0, 2)).toEqual([
      expect.stringContaining('Grace Hopper'),
      expect.stringContaining('Alan Turing'),
    ]);
    expect(within(line).getByRole('link', { name: 'Org chart' })).toHaveAttribute(
      'href',
      '/people/directory/org-chart',
    );
    expect(within(line).getByText(/3 others report to Alan/)).toBeInTheDocument();
    const team = part('Your direct reports 8');
    expect(within(team).getByRole('link', { name: 'Show all 8' })).toHaveAttribute(
      'href',
      `/people/directory/list?filter=${encodeURIComponent(`manager_id:${ADA}`)}`,
    );
    expect(within(team).getByRole('link', { name: /Tim Berners-Lee/ })).toHaveAttribute(
      'href',
      '/people/00000000-0000-4000-8000-0000000000a5',
    );
  });

  it('says what done looks like when nothing is left', async () => {
    const full = employee();
    const done = employee({
      approvals: { isHr: false, total: 0, items: [] },
      missing: [],
      me: full.me === null ? null : { ...full.me, missing: 0 },
    });
    const { container } = render(<PeopleHome load={ready(done)} />);
    expect(screen.getByText('Your record is complete.')).toBeInTheDocument();
    expect(maybe('Needs HR')).toBeNull();
    expect(await axeViolations(container)).toEqual([]);
  });

  it('still opens for an account with no record, and lists no places of its own', async () => {
    const { container } = render(<PeopleHome load={ready(nobody({ hr: false }))} />);
    expect(screen.getByRole('heading', { level: 1, name: 'Home' })).toBeInTheDocument();
    expect(maybe('Your reporting line')).toBeNull();
    // The sections are the sidebar's and the breadcrumb's; Home stays clean.
    expect(screen.queryByRole('navigation')).toBeNull();
    expect(await axeViolations(container)).toEqual([]);
  });
});

describe('Home, as HR (B2)', () => {
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
    identifiersBy: ['Adam Novak', 'Yuki Sato', 'Omar Haddad'],
    duplicatesBy: ['Kithena’s duplicate check', 'SCIM provisioning'],
    accessRequestsBy: ['Sofia Lindqvist'],
    joiners: [{ label: 'Sep', value: 14 }],
    starting: [
      { id: 'm', name: 'Mei Tanaka', avatarUrl: null, detail: 'Data analyst', missing: 3 },
    ],
  };

  it('gives HR the four figures and one Needs HR list, each row opening Review pre-filtered', async () => {
    const hr = render(<PeopleHome load={ready({ ...overview(), hr: figures })} />, {
      wrapper: TooltipProvider,
    });
    expect(screen.getByText(/Here’s what needs HR today\.$/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Add person' })).toHaveAttribute(
      'href',
      '/people/directory/list?add=person',
    );
    for (const label of [
      'Headcount',
      'Complete records',
      'Waiting for a decision',
      'Expiring in 90 days',
    ])
      expect(screen.getByText(label)).toBeInTheDocument();
    const needs = part('Needs HR');
    const href = (name: string) =>
      within(needs).getAllByRole('link', { name })[0]?.getAttribute('href');
    expect(href('Review: 7 changes to approve')).toBe('/people/review/waiting?kind=changes');
    expect(href('Review: 3 identifiers to check')).toBe('/people/review/waiting?kind=ids');
    expect(href('Compare: 2 possible duplicates')).toBe('/people/review/waiting?kind=duplicates');
    // What flagged the pairs, as they were found: both, here.
    expect(
      within(needs).getByText(
        'Same work email, or name and birth date · flagged by Kithena’s duplicate check and SCIM provisioning',
      ),
    ).toBeInTheDocument();
    expect(href('Decide: 1 request for full values')).toBe('/people/review/waiting?kind=access');
    expect(href('Fill in: 11 details for HR to fill in')).toBe(
      '/people/review/waiting?kind=missing',
    );
    expect(href('Remind: 4 people have details of their own to add')).toBe(
      '/people/review/waiting?kind=missing',
    );
    expect(within(needs).getByRole('link', { name: 'Open Review' })).toHaveAttribute(
      'href',
      '/people/review/waiting',
    );
    expect(part('Starting soon')).toHaveTextContent('Mei Tanaka');
    expect(part('Joiners by month')).toBeInTheDocument();
    // HR's own record, which the old overview left out.
    expect(screen.getByText(/Your own record is/)).toHaveTextContent('missing 2 details');
    expect(await axeViolations(hr.container)).toEqual([]);
    hr.unmount();
    render(<PeopleHome load={ready(employee())} />);
    expect(maybe('Needs HR')).toBeNull();
  });

  it('says how many changes look unusual, and why the newest does (B2)', () => {
    const base = overview();
    render(
      <PeopleHome
        load={ready({
          ...base,
          approvals: base.approvals && { ...base.approvals, flagged: 1, flagReason: 'A 38% raise' },
          hr: figures,
        })}
      />,
      { wrapper: TooltipProvider },
    );
    expect(
      within(part('Needs HR')).getByText(
        '1 looks unusual: a 38% raise · asked by Tim Berners-Lee and others',
      ),
    ).toBeInTheDocument();
  });

  it('names who asked on every row of Needs HR (B2)', () => {
    render(<PeopleHome load={ready({ ...overview(), hr: figures })} />, {
      wrapper: TooltipProvider,
    });
    const needs = within(part('Needs HR'));
    expect(
      needs.getByText(
        'Failed a check, or couldn’t be verified · entered by Adam Novak and 2 others',
      ),
    ).toBeInTheDocument();
    expect(needs.getByText('Sofia Lindqvist asked to see unmasked values')).toBeInTheDocument();
  });

  it('says nothing needs HR when every queue is empty', () => {
    render(
      <PeopleHome
        load={ready({
          ...overview({
            approvals: { isHr: true, total: 0, items: [] },
            team: { waiting: 0, toFill: 0 },
          }),
          hr: { ...figures, identifiers: 0, duplicates: 0, accessRequests: 0 },
        })}
      />,
      { wrapper: TooltipProvider },
    );
    expect(screen.getByText('Nothing needs HR.')).toBeInTheDocument();
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

describe('finishing sign-up on Home', () => {
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
