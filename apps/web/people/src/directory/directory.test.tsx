import { render, screen, within } from '@testing-library/react';
import { setShortcutKeys } from '@reach/ui';
import { describe, expect, it, vi } from 'vitest';

import { fast } from '../test/user';
import { axeViolations } from '../test/axe';
import { RUN_GOING } from '../import/import.fixture';
import { Directory, summaryOf, type DirectoryProps, type DirectoryState } from './directory';

const state: DirectoryState = {
  total: 420,
  active: 412,
  notStarted: 5,
  incomplete: 88,
  columns: [
    { key: 'job_title', label: 'Job title' },
    { key: 'cost_centre', label: 'Cost centre' },
  ],
  filterable: [
    {
      key: 'cost_centre',
      label: 'Cost centre',
      options: [
        { value: 'ENG-204', label: 'ENG-204' },
        { value: 'ENG-201', label: 'ENG-201' },
      ],
    },
  ],
  people: [
    {
      id: 'a',
      name: 'Adam Reyes',
      email: 'adam@acme.example',
      avatarUrl: null,
      values: { job_title: 'Support Engineer', cost_centre: 'ENG-204' },
      missing: 0,
    },
    {
      id: 'l',
      name: 'Lena Moreau',
      email: 'lena@acme.example',
      avatarUrl: null,
      values: { job_title: 'Staff Engineer', cost_centre: 'ENG-204' },
      missing: 2,
    },
  ],
};

function props(over: Partial<DirectoryProps> = {}): DirectoryProps {
  return {
    load: { status: 'ready', data: state },
    search: '',
    onSearchChange: vi.fn(),
    filters: {},
    onFiltersChange: vi.fn(),
    onOpen: vi.fn(),
    ...over,
  };
}

/** A question's results: Sales, as the host put it in the address. */
const asked: DirectoryState = {
  ...state,
  fields: [
    {
      key: 'department',
      label: 'Department',
      kind: 'select',
      options: [{ value: 'sales', label: 'Sales' }],
    },
  ],
  query: {
    conditions: [{ key: 'department', op: 'in', values: ['sales'] }],
    match: 'all',
    sort: null,
  },
};

describe('summaryOf', () => {
  it('counts everybody, then the statuses HR is shown, never a misleading zero active', () => {
    // Two added by hand and not hired: people, none active, both not started.
    expect(summaryOf({ ...state, total: 2, active: 0, notStarted: 2, incomplete: null })).toBe(
      '2 people · 0 active · 2 not started',
    );
    expect(summaryOf({ ...state, total: 1, active: 1, notStarted: 0, incomplete: null })).toBe(
      '1 person · 1 active',
    );
    // Outside HR: how many, and nothing about anybody's status.
    expect(summaryOf({ ...state, total: 7, active: 7, notStarted: null, incomplete: null })).toBe(
      '7 people',
    );
  });
});

describe('Directory', () => {
  it('draws columns from the schema and completeness as a count', async () => {
    const { container } = render(<Directory {...props()} />);
    expect(
      screen.getByText('420 people · 412 active · 5 not started · 88 incomplete'),
    ).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: /Cost centre/ })).toBeInTheDocument();
    expect(screen.getByText('2 missing')).toBeInTheDocument();
    expect(screen.getByText('Complete')).toBeInTheDocument();
    expect(screen.queryByText(/%/)).toBeNull();
    expect(await axeViolations(container)).toEqual([]);
  });

  it('shows the conditions in force as chips, each removable, and applies new ones from the panel', async () => {
    const user = fast();
    const onConditionsChange = vi.fn();
    const onFiltersChange = vi.fn();
    const filtered: DirectoryState = {
      ...state,
      fields: [
        {
          key: 'cost_centre',
          label: 'Cost centre',
          kind: 'select',
          options: [{ value: 'ENG-201', label: 'Engineering 201' }],
        },
        { key: 'hire_date', label: 'Start date', kind: 'date', options: [] },
      ],
      query: {
        conditions: [
          { key: 'cost_centre', op: 'in', values: ['ENG-201'] },
          { key: 'hire_date', op: 'between', values: ['2026-01-01', ''] },
        ],
        match: 'all',
        sort: null,
      },
    };
    const { container } = render(
      <Directory
        {...props({
          load: { status: 'ready', data: filtered },
          filters: { reports_to: 'x' },
          onConditionsChange,
          onFiltersChange,
        })}
      />,
    );
    expect(screen.getByText('Cost centre is any of Engineering 201')).toBeInTheDocument();
    expect(screen.getByText('Start date is on or after January 1, 2026')).toBeInTheDocument();
    await user.click(
      screen.getByRole('button', { name: 'Remove Cost centre is any of Engineering 201' }),
    );
    expect(onConditionsChange).toHaveBeenCalledWith(
      [{ key: 'hire_date', op: 'between', values: ['2026-01-01', ''] }],
      'all',
    );
    await user.click(screen.getByRole('button', { name: 'Clear all' }));
    expect(onConditionsChange).toHaveBeenLastCalledWith([], 'all');
    expect(onFiltersChange).toHaveBeenCalledWith({});

    // The panel opens with what is in force, and applies it back.
    await user.click(screen.getByRole('button', { name: 'Filters (2)' }));
    const panel = screen.getByRole('dialog', { name: 'Filter people' });
    await user.click(within(panel).getByRole('button', { name: 'Apply 2 conditions' }));
    expect(onConditionsChange).toHaveBeenLastCalledWith(filtered.query?.conditions, 'all');
    expect(await axeViolations(container)).toEqual([]);
  });

  it('orders by a column on the server, not in the browser', async () => {
    const user = fast();
    const onSortChange = vi.fn();
    render(<Directory {...props({ onSortChange })} />);
    await user.click(screen.getByRole('button', { name: /Cost centre/ }));
    expect(onSortChange).toHaveBeenCalledWith({ key: 'cost_centre', direction: 'asc' });
  });

  it('lets HR narrow to people with something missing, through the shell', async () => {
    const user = fast();
    const onView = vi.fn();
    const { rerender } = render(<Directory {...props({ onView })} />);
    await user.click(screen.getByRole('radio', { name: /Incomplete/ }));
    expect(onView).toHaveBeenCalledWith({ conditions: [], incomplete: true, segmentId: null });
    // Nobody but HR is counted, so nobody else is offered it.
    rerender(
      <Directory
        {...props({ onView, load: { status: 'ready', data: { ...state, incomplete: null } } })}
      />,
    );
    expect(screen.queryByRole('radio', { name: /Incomplete/ })).toBeNull();
  });

  it('opens on the first person: their quick look, their row current, and nothing opened', async () => {
    const user = fast();
    const onOpen = vi.fn();
    const { container } = render(<Directory {...props({ onOpen })} />);
    const look = screen.getByRole('complementary', { name: 'Quick look' });
    expect(within(look).getByRole('heading', { name: 'Adam Reyes' })).toBeInTheDocument();
    expect(container.querySelector('tr[data-row-id="a"]')).toHaveAttribute('aria-current', 'true');
    // The keyboard starts on them too: theirs is the row in the tab order.
    expect(container.querySelector('tr[data-row-id="a"]')).toHaveAttribute('tabindex', '0');
    expect(onOpen).not.toHaveBeenCalled();
    // Closed, it stays closed.
    await user.click(within(look).getByRole('button', { name: 'Close' }));
    expect(screen.queryByRole('complementary', { name: 'Quick look' })).toBeNull();
  });

  it('moves the quick look with ↑ and ↓ from inside it, keeping focus there, and shows their row', async () => {
    const user = fast();
    const into = vi.spyOn(Element.prototype, 'scrollIntoView');
    render(<Directory {...props()} />);
    const look = screen.getByRole('complementary', { name: 'Quick look' });
    within(look).getByRole('button', { name: 'Close' }).focus();
    await user.keyboard('{ArrowDown}');
    expect(within(look).getByRole('heading', { name: 'Lena Moreau' })).toBeInTheDocument();
    expect(look).toContainElement(document.activeElement as HTMLElement);
    // The same move the list makes: their row is the current one.
    expect(document.querySelector('tr[data-row-id="l"]')).toHaveAttribute('aria-current', 'true');
    await user.keyboard('{ArrowUp}');
    expect(within(look).getByRole('heading', { name: 'Adam Reyes' })).toBeInTheDocument();
    // "Show in list": the keyboard lands on their row.
    await user.click(within(look).getByRole('button', { name: 'Show in list' }));
    expect(document.querySelector('tr[data-row-id="a"]')).toHaveFocus();
    into.mockRestore();
  });

  it('asks for the second page as soon as the first is drawn, and for each cursor once', async () => {
    // Nothing nears the end: only the first page being drawn asks.
    vi.stubGlobal(
      'IntersectionObserver',
      class {
        observe(): void {}
        disconnect(): void {}
      },
    );
    const onLoadMore = vi.fn((after: string) =>
      Promise.resolve({
        people: [
          {
            id: `k${after}`,
            name: 'Katherine Johnson',
            email: null,
            avatarUrl: null,
            values: {},
            missing: 0,
          },
        ],
        next: 'cursor-2',
      }),
    );
    render(<Directory {...props({ view: 'cards', onLoadMore, next: 'cursor-1' })} />);
    expect(onLoadMore).toHaveBeenCalledWith('cursor-1');
    expect(await screen.findByText('Katherine Johnson')).toBeInTheDocument();
    // A page ahead: the third waits for the reader to be halfway down.
    expect(onLoadMore).toHaveBeenCalledOnce();
    vi.unstubAllGlobals();
  });

  it('opens a quick look beside the list, then the person (W3b)', async () => {
    const user = fast();
    const onOpen = vi.fn();
    const { container } = render(<Directory {...props({ onOpen })} />);
    await user.click(screen.getByRole('button', { name: 'Lena Moreau' }));
    const look = screen.getByRole('complementary', { name: 'Quick look' });
    expect(within(look).getByRole('heading', { name: 'Lena Moreau' })).toBeInTheDocument();
    expect(await axeViolations(container)).toEqual([]);
    // ↑ moves the look to the person above; ↵ keeps them on the card, and
    // the profile is the card's own button.
    screen.getByRole('button', { name: 'Lena Moreau' }).focus();
    await user.keyboard('{ArrowUp}');
    expect(within(look).getByRole('heading', { name: 'Adam Reyes' })).toBeInTheDocument();
    await user.keyboard('{Enter}');
    expect(within(look).getByRole('heading', { name: 'Adam Reyes' })).toBeInTheDocument();
    expect(onOpen).not.toHaveBeenCalled();
    await user.click(within(look).getByRole('button', { name: 'Open profile' }));
    expect(onOpen).toHaveBeenLastCalledWith('a');
  });

  it('opens the card on Enter from a row, never the profile, which is the row’s Edit key', async () => {
    const user = fast();
    const onOpen = vi.fn();
    setShortcutKeys({ keys: { 'row.edit': ['e'] }, characterKeys: true });
    const { container } = render(<Directory {...props({ onOpen })} />);
    await user.click(
      within(screen.getByRole('complementary', { name: 'Quick look' })).getByRole('button', {
        name: 'Close',
      }),
    );
    const row = container.querySelector<HTMLElement>('tr[data-row-id="l"]');
    row?.focus();
    await user.keyboard('{Enter}');
    const look = screen.getByRole('complementary', { name: 'Quick look' });
    expect(within(look).getByRole('heading', { name: 'Lena Moreau' })).toBeInTheDocument();
    expect(onOpen).not.toHaveBeenCalled();
    // From the name, where ↑ and ↓ leave the keyboard, too.
    screen.getByRole('button', { name: 'Adam Reyes' }).focus();
    await user.keyboard('{Enter}');
    expect(within(look).getByRole('heading', { name: 'Adam Reyes' })).toBeInTheDocument();
    expect(onOpen).not.toHaveBeenCalled();
    await user.keyboard('e');
    expect(onOpen).toHaveBeenCalledWith('a');
    // The keys are said once, at the list's head, not on the card: under a
    // list that keeps loading they were only reached at its end.
    const hint = screen.getByText(/to open the card/);
    expect(look).not.toContainElement(hint);
    expect(hint).toHaveTextContent(/to move.*to open the card.*E for the profile/);
    expect(
      hint.compareDocumentPosition(screen.getByRole('region', { name: 'People' })) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    // Plain rows: no stripes.
    expect(container.querySelector('tr[data-striped]')).toBeNull();
    expect(within(look).queryByText(/next record/)).toBeNull();
    setShortcutKeys({ keys: {}, characterKeys: true });
  });

  it('lets HR choose people and edit them together, and nobody else choose at all (PEO-071)', async () => {
    const user = fast();
    const onBulkEdit = vi.fn();
    const { rerender } = render(<Directory {...props()} />);
    expect(screen.queryByRole('checkbox', { name: 'Select Adam Reyes' })).toBeNull();
    rerender(<Directory {...props({ onBulkEdit })} />);
    await user.click(screen.getByRole('checkbox', { name: 'Select Adam Reyes' }));
    await user.click(screen.getByRole('checkbox', { name: 'Select Lena Moreau' }));
    await user.click(screen.getByRole('button', { name: 'Edit together' }));
    expect(onBulkEdit).toHaveBeenCalledWith(['a', 'l']);
  });

  it('has loading, error and empty states', async () => {
    const { container, rerender } = render(
      <Directory {...props({ load: { status: 'loading' } })} />,
    );
    expect(screen.getByText('Loading the directory')).toBeInTheDocument();
    rerender(<Directory {...props({ load: { status: 'error', message: 'Timed out' } })} />);
    expect(screen.getByText('Timed out')).toBeInTheDocument();
    rerender(
      <Directory
        {...props({ search: 'zz', load: { status: 'ready', data: { ...state, people: [] } } })}
      />,
    );
    expect(screen.getByText('Nobody matches')).toBeInTheDocument();
    expect(await axeViolations(container)).toEqual([]);
  });

  it('says there is nobody yet, with one Import and no Add employee of its own', async () => {
    const user = fast();
    const onImport = vi.fn();
    const empty = { status: 'ready', data: { ...state, people: [] } } as const;
    const { container, rerender } = render(<Directory {...props({ load: empty, onImport })} />);
    expect(screen.getByText('No employees yet')).toBeInTheDocument();
    expect(screen.getByText(/one at a time with Add person/)).toBeInTheDocument();
    // Adding one person is the host's manifest action beside the screen, never a copy here.
    expect(screen.queryByRole('button', { name: 'Add employee' })).toBeNull();
    const imports = screen.getAllByRole('button', { name: 'Import' });
    expect(imports).toHaveLength(1);
    await user.click(imports[0] as HTMLElement);
    expect(onImport).toHaveBeenCalledOnce();
    expect(await axeViolations(container)).toEqual([]);

    // Anybody else: the same news, and nothing to press.
    rerender(<Directory {...props({ load: empty })} />);
    expect(screen.getByText('Nobody has been added to People yet.')).toBeInTheDocument();
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('keeps Import off while an import runs, saying whose and since when, with the way to it', async () => {
    const onImport = vi.fn();
    const empty = { status: 'ready', data: { ...state, people: [] } } as const;
    const { container } = render(
      <Directory {...props({ load: empty, onImport, running: RUN_GOING })} />,
    );
    const button = screen.getByRole('button', { name: 'Import' });
    expect(button).toBeDisabled();
    expect(button).toHaveAccessibleDescription(
      /^An import is running\. Started by Ada Lovelace at \d\d:\d\d\.$/,
    );
    expect(screen.getByRole('link', { name: 'See the import' })).toHaveAttribute(
      'href',
      `/people/import?run=${RUN_GOING.id}`,
    );
    expect(await axeViolations(container)).toEqual([]);
  });

  it('draws the view its route names, and asks the shell for another (V2, V3)', async () => {
    const user = fast();
    const onViewChange = vi.fn();
    const { container, rerender } = render(<Directory {...props({ onViewChange })} />);
    const views = screen.getAllByRole('radiogroup', { name: 'Show people as' })[0] as HTMLElement;
    expect(within(views).getByRole('radio', { name: 'List' })).toBeChecked();
    expect(screen.getByRole('grid', { name: 'People' })).toBeInTheDocument();
    expect(await axeViolations(container)).toEqual([]);

    rerender(<Directory {...props({ onViewChange, view: 'cards' })} />);
    expect(within(views).getByRole('radio', { name: 'Cards' })).toBeChecked();
    expect(screen.queryByRole('table')).toBeNull();
    expect(screen.getAllByRole('button', { name: 'Profile' })).toHaveLength(2);

    // The view is the route: the screen asks, and stays as it is until the route changes.
    await user.click(within(views).getByRole('radio', { name: 'Org chart' }));
    expect(onViewChange).toHaveBeenCalledWith('org-chart');
    await user.click(within(views).getByRole('radio', { name: 'List' }));
    expect(onViewChange).toHaveBeenLastCalledWith('list');
    expect(within(views).getByRole('radio', { name: 'Cards' })).toBeChecked();
  });

  it('asks the shell for the next page and back to the first, never paging itself', async () => {
    const user = fast();
    const onNextPage = vi.fn();
    const onFirstPage = vi.fn();
    const { container, rerender } = render(<Directory {...props()} />);
    // One page and nothing after it: no pager at all.
    expect(screen.queryByRole('navigation', { name: 'Pages of people' })).toBeNull();

    rerender(<Directory {...props({ onNextPage, onFirstPage })} />);
    await user.click(screen.getByRole('button', { name: 'Next page' }));
    await user.click(screen.getByRole('button', { name: 'First page' }));
    expect(onNextPage).toHaveBeenCalledTimes(1);
    expect(onFirstPage).toHaveBeenCalledTimes(1);
    expect(await axeViolations(container)).toEqual([]);

    rerender(<Directory {...props({ onFirstPage })} />);
    expect(screen.queryByRole('button', { name: 'Next page' })).toBeNull();
  });

  it('applies a saved segment through the shell, and saves the filters as one (PEO-068)', async () => {
    const user = fast();
    const onView = vi.fn();
    const onSaveSegment = vi.fn(() => Promise.resolve({ ok: true as const }));
    const withSegments = { ...state, segments: [{ id: 'seg-1', name: 'Madrid engineering' }] };
    const { container, rerender } = render(
      <Directory
        {...props({
          load: { status: 'ready', data: withSegments },
          onView,
          onSaveSegment,
        })}
      />,
    );
    // Nothing to save until a filter is set.
    expect(screen.queryByRole('button', { name: 'Save view' })).toBeNull();
    await user.click(screen.getByRole('radio', { name: 'Madrid engineering' }));
    expect(onView).toHaveBeenCalledWith({ conditions: [], incomplete: false, segmentId: 'seg-1' });

    rerender(
      <Directory
        {...props({
          load: { status: 'ready', data: withSegments },
          filters: { cost_centre: 'ENG-204' },
          onView,
          onSaveSegment,
        })}
      />,
    );
    await user.click(screen.getByRole('button', { name: 'Save view' }));
    await user.type(screen.getByRole('textbox', { name: /^Name/ }), 'ENG-204');
    await user.click(screen.getByRole('radio', { name: 'Share with the company' }));
    const panel = screen.getByRole('dialog');
    await user.click(within(panel).getByRole('button', { name: 'Save view' }));
    expect(onSaveSegment).toHaveBeenCalledWith({ name: 'ENG-204', shared: true });
    expect(await axeViolations(container)).toEqual([]);
  });

  it('draws a manager as a person, and loads the next page as the table nears its end', async () => {
    const withManager: DirectoryState = {
      ...state,
      columns: [...state.columns, { key: 'manager_id', label: 'Manager' }],
      people: state.people.map((p) => ({
        ...p,
        values: { ...p.values, manager_id: 'Grace Hopper' },
        people: [{ key: 'manager_id', id: 'g', name: 'Grace Hopper', avatarUrl: null }],
      })),
    };
    const onLoadMore = vi.fn(() =>
      Promise.resolve({
        people: [
          {
            id: 'k',
            name: 'Katherine Johnson',
            email: null,
            avatarUrl: null,
            values: {},
            missing: 0,
          },
        ],
        next: null,
      }),
    );
    const { container } = render(
      <Directory
        {...props({ load: { status: 'ready', data: withManager }, onLoadMore, next: 'cursor-1' })}
      />,
    );
    // jsdom measures nothing, so the first page never fills the table: it asks at once.
    expect(onLoadMore).toHaveBeenCalledWith('cursor-1');
    expect(await screen.findByText('Katherine Johnson')).toBeInTheDocument();
    expect(screen.getAllByText('Grace Hopper').length).toBeGreaterThan(0);
    // Said as it lands, to a screen reader too.
    expect(screen.getByRole('status')).toHaveTextContent(
      '1 more loaded. Results stream in 50 at a time.',
    );
    // No pager beside an infinite table.
    expect(screen.queryByRole('navigation', { name: 'Pages of people' })).toBeNull();
    expect(onLoadMore).toHaveBeenCalledOnce();
    expect(await axeViolations(container)).toEqual([]);
  });

  it('cards load the next page as the reader nears the end, with cards in their shape meanwhile and no button', async () => {
    // The sentinel a screen ahead is in view at once: jsdom lays nothing out.
    const observed: (() => void)[] = [];
    vi.stubGlobal(
      'IntersectionObserver',
      class {
        readonly #call: IntersectionObserverCallback;
        constructor(call: IntersectionObserverCallback) {
          this.#call = call;
        }
        observe(): void {
          observed.push(() => {
            this.#call(
              [{ isIntersecting: true } as IntersectionObserverEntry],
              this as unknown as IntersectionObserver,
            );
          });
        }
        disconnect(): void {}
      },
    );
    let arrive: (page: { people: unknown[]; next: string | null }) => void = () => undefined;
    const onLoadMore = vi.fn(
      () =>
        new Promise<{ people: unknown[]; next: string | null }>((resolve) => {
          arrive = resolve;
        }),
    );
    const { container } = render(
      <Directory {...props({ view: 'cards', onLoadMore, next: 'cursor-1' })} />,
    );
    for (const call of observed.splice(0)) call();
    await vi.waitFor(() => {
      expect(onLoadMore).toHaveBeenCalledWith('cursor-1');
    });
    // The cards' own shape says a page is coming; the line under them holds still.
    expect(container.querySelectorAll('li[aria-hidden="true"]')).toHaveLength(4);
    expect(screen.getByRole('status')).toHaveTextContent('Results stream in 50 at a time.');
    expect(screen.queryByRole('button', { name: /more people/i })).toBeNull();
    arrive({
      people: [
        {
          id: 'k',
          name: 'Katherine Johnson',
          email: null,
          avatarUrl: null,
          values: {},
          missing: 0,
        },
      ],
      next: null,
    });
    expect(await screen.findByText('Katherine Johnson')).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent(
      '1 more loaded. Results stream in 50 at a time.',
    );
    expect(container.querySelectorAll('li[aria-hidden="true"]')).toHaveLength(0);
    expect(await axeViolations(container)).toEqual([]);
    vi.unstubAllGlobals();
  });

  it('groups people under a heading per value, ordered by it on the server', async () => {
    const user = fast();
    const onGroupChange = vi.fn();
    const grouped: DirectoryState = {
      ...state,
      fields: [
        {
          key: 'cost_centre',
          label: 'Cost centre',
          kind: 'select',
          options: [{ value: 'ENG-204', label: 'ENG-204' }],
        },
      ],
    };
    const { rerender } = render(
      <Directory {...props({ load: { status: 'ready', data: grouped }, onGroupChange })} />,
    );
    await user.click(screen.getByRole('combobox', { name: 'Group by' }));
    await user.click(await screen.findByRole('option', { name: 'Group by cost centre' }));
    expect(onGroupChange).toHaveBeenCalledWith('cost_centre');
    rerender(
      <Directory
        {...props({
          load: { status: 'ready', data: grouped },
          onGroupChange,
          group: 'cost_centre',
        })}
      />,
    );
    expect(screen.getByRole('rowheader')).toHaveTextContent('ENG-2042');
  });
});

describe('the directory’s search, in the address (smart search: AI1–AI4)', () => {
  it('shows each key at once and asks the shell once typing rests', async () => {
    const user = fast();
    const onSearchChange = vi.fn();
    render(<Directory {...props({ onSearchChange })} />);
    const box = screen.getByRole('searchbox', { name: 'Search people' });
    await user.type(box, 'ada');
    expect(box).toHaveValue('ada');
    expect(onSearchChange).not.toHaveBeenCalled();
    await vi.waitFor(() => {
      expect(onSearchChange).toHaveBeenCalledWith('ada');
    });
    expect(onSearchChange).toHaveBeenCalledTimes(1);
  });

  it('Enter asks: typing alone never searches, and the question becomes the chips in force', async () => {
    const user = fast();
    const onSearchChange = vi.fn();
    const onAsk = vi.fn(() =>
      Promise.resolve({
        ok: true as const,
        by: 'rules' as const,
        note: 'The assistant isn’t set up here, so People read it without the assistant.',
        unused: ['managers'],
        filters: 1,
        search: null,
      }),
    );
    const { container, rerender } = render(<Directory {...props({ onSearchChange, onAsk })} />);
    const box = screen.getByRole('searchbox', { name: 'Search people' });
    await user.type(box, 'managers in Sales{Enter}');
    expect(onAsk).toHaveBeenCalledWith('managers in Sales', {});
    await new Promise((resolve) => setTimeout(resolve, 400));
    expect(onSearchChange).not.toHaveBeenCalled();
    // The host put the plan in the address: the screen draws what People answered.
    rerender(
      <Directory
        {...props({
          onSearchChange,
          onAsk,
          asked: 'managers in Sales',
          onConditionsChange: vi.fn(),
          load: { status: 'ready', data: asked },
        })}
      />,
    );
    const row = await screen.findByRole('group', { name: 'Understood as' });
    expect(
      within(row).getByRole('button', { name: 'Remove Department Sales' }),
    ).toBeInTheDocument();
    expect(within(row).getByText('“managers”')).toBeInTheDocument();
    expect(within(row).getByRole('button', { name: 'Edit as filters' })).toBeInTheDocument();
    expect(screen.getByText(/isn’t set up here/u)).toBeInTheDocument();
    expect(box).toHaveValue('managers in Sales');
    expect(screen.getByText('Updated as you edit the chips')).toBeInTheDocument();
    expect(await axeViolations(container)).toEqual([]);
  });

  it('“person with the highest missing fields”: sorted by most missing details, top 1, and the same order by hand', async () => {
    const user = fast();
    const onSortChange = vi.fn();
    const onAsk = vi.fn(() =>
      Promise.resolve({
        ok: true as const,
        by: 'rules' as const,
        note: null,
        notes: [],
        unused: [],
        filters: 1,
        search: null,
      }),
    );
    const ranked: DirectoryState = {
      ...asked,
      total: 1,
      people: state.people.slice(1),
      metrics: [
        {
          key: 'missing_count',
          label: 'Missing details',
          kind: 'number',
          filter: true,
          most: 'most missing details',
          least: 'fewest missing details',
        },
      ],
      query: {
        conditions: [],
        match: 'all',
        sort: { key: 'missing_count', direction: 'desc' },
        top: 1,
      },
    };
    const sentence = 'person with the highest missing fields';
    const { container, rerender } = render(<Directory {...props({ onAsk, onSortChange })} />);
    await user.type(screen.getByRole('searchbox', { name: 'Search people' }), `${sentence}{Enter}`);
    expect(onAsk).toHaveBeenCalledWith(sentence, {});
    rerender(
      <Directory
        {...props({
          onAsk,
          onSortChange,
          asked: sentence,
          onConditionsChange: vi.fn(),
          load: { status: 'ready', data: ranked },
        })}
      />,
    );
    const row = await screen.findByRole('group', { name: 'Understood as' });
    expect(
      within(row).getByRole('button', { name: 'Remove Sorted by most missing details · top 1' }),
    ).toBeInTheDocument();
    expect(screen.queryByText(/null/u)).toBeNull();
    expect(await axeViolations(container)).toEqual([]);
    // The same metrics, as orders anybody can pick.
    await user.click(screen.getByRole('combobox', { name: 'Sort by' }));
    await user.click(await screen.findByRole('option', { name: 'Fewest missing details' }));
    expect(onSortChange).toHaveBeenCalledWith({ key: 'missing_count', direction: 'asc' });
  });

  it('a question nothing could be read of still answers: what was not understood, said', async () => {
    const user = fast();
    const onAsk = vi.fn(() =>
      Promise.resolve({
        ok: true as const,
        by: 'rules' as const,
        note: null,
        notes: [
          'None of it is a field or an order People knows, so this is everybody you can see.',
        ],
        unused: ['shiniest', 'shoes'],
        filters: 0,
        search: null,
      }),
    );
    const sentence = 'who has the shiniest shoes';
    const everybody: DirectoryState = {
      ...asked,
      query: { conditions: [], match: 'all', sort: null },
    };
    const { rerender } = render(<Directory {...props({ onAsk })} />);
    await user.type(screen.getByRole('searchbox', { name: 'Search people' }), `${sentence}{Enter}`);
    rerender(
      <Directory
        {...props({ onAsk, asked: sentence, load: { status: 'ready', data: everybody } })}
      />,
    );
    expect(await screen.findByText('Not understood: “shiniest”, “shoes”.')).toBeInTheDocument();
    expect(screen.getByText(/so this is everybody you can see/u)).toBeInTheDocument();
    // Everybody, not a blank page.
    expect(screen.getAllByText('Lena Moreau').length).toBeGreaterThan(0);
  });

  it('offers questions from the company’s own fields and recent searches; picking one asks it', async () => {
    const user = fast();
    window.localStorage.setItem('people.directory.recent', JSON.stringify(['Lena Moreau']));
    const onAsk = vi.fn(() =>
      Promise.resolve({
        ok: true as const,
        by: 'search' as const,
        note: null,
        unused: [],
        filters: 0,
        search: null,
      }),
    );
    render(
      <Directory
        {...props({
          onAsk,
          load: {
            status: 'ready',
            data: { ...state, suggestions: ['Who joins in the next 30 days?'] },
          },
        })}
      />,
    );
    const box = screen.getByRole('searchbox', { name: 'Search people' });
    expect(box).toHaveAttribute(
      'placeholder',
      'Ask in plain English, like “who joins in the next 30 days”',
    );
    await user.click(box);
    const offered = await screen.findByRole('dialog', { name: 'Suggestions' });
    expect(within(offered).getByRole('heading', { name: 'Try asking' })).toBeInTheDocument();
    expect(within(offered).getByRole('heading', { name: 'Recent' })).toBeInTheDocument();
    await user.click(
      within(offered).getByRole('button', { name: 'Who joins in the next 30 days?' }),
    );
    expect(onAsk).toHaveBeenCalledWith('Who joins in the next 30 days?', {});
    window.localStorage.clear();
  });

  it('asks instead of guessing, applies the reading picked, and remembers it for next time', async () => {
    const user = fast();
    const onConditionsChange = vi.fn();
    const notice = { key: 'status', op: 'in', values: ['notice'] };
    const onAsk = vi.fn(() =>
      Promise.resolve({
        ok: true as const,
        by: 'rules' as const,
        note: null,
        unused: [],
        filters: 0,
        search: null,
        ask: {
          topic: 'leaving',
          phrase: 'leaving soon',
          readings: [
            { label: 'Have given notice', conditions: [notice], match: 'all' as const, count: 3 },
            {
              label: 'Contract end date in the next 90 days',
              conditions: [
                { key: 'contract_end', op: 'between', values: ['2026-10-01', '2026-12-30'] },
              ],
              match: 'all' as const,
              count: 5,
            },
          ],
        },
        refused: [],
        remembered: null,
      }),
    );
    const { container } = render(
      <Directory {...props({ onAsk, onConditionsChange, asked: null })} />,
    );
    await user.type(
      screen.getByRole('searchbox', { name: 'Search people' }),
      'people leaving soon{Enter}',
    );
    const card = await screen.findByRole('group', { name: 'What does “leaving soon” mean?' });
    expect(
      within(card).getByRole('heading', { name: 'What does “leaving soon” mean here?' }),
    ).toBeInTheDocument();
    expect(within(card).getByText(/Pick one and I’ll remember it/u)).toBeInTheDocument();
    expect(await axeViolations(container)).toEqual([]);
    await user.click(within(card).getByRole('button', { name: 'Have given notice · 3' }));
    expect(onConditionsChange).toHaveBeenCalledWith([notice], 'all');
    expect(screen.queryByRole('group', { name: 'What does “leaving soon” mean?' })).toBeNull();
    await user.type(screen.getByRole('searchbox', { name: 'Search people' }), '{Enter}');
    expect(onAsk).toHaveBeenLastCalledWith('people leaving soon', { leaving: 'Have given notice' });
    window.localStorage.clear();
  });

  it('says plainly what it won’t search, offers a field instead, and never applies it unasked', async () => {
    const user = fast();
    const onConditionsChange = vi.fn();
    const skills = { key: 'skills', op: 'contains', values: ['Go'] };
    const onAsk = vi.fn(() =>
      Promise.resolve({
        ok: true as const,
        by: 'rules' as const,
        note: null,
        unused: [],
        filters: 1,
        search: null,
        refused: [
          {
            text: 'who are good at Go',
            why: 'Kithena doesn’t rate people’s skills.',
            instead: { label: 'Skills', subject: 'Go', condition: skills, count: 4 },
          },
        ],
      }),
    );
    const { container } = render(
      <Directory
        {...props({ onAsk, onConditionsChange, load: { status: 'ready', data: asked } })}
      />,
    );
    await user.type(
      screen.getByRole('searchbox', { name: 'Search people' }),
      'Sales who are good at Go{Enter}',
    );
    expect(
      await screen.findByRole('heading', { name: 'One part I couldn’t use' }),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        /doesn’t rate people’s skills\. I can search the Skills field for “Go” instead, which 4 people have listed\./u,
      ),
    ).toBeInTheDocument();
    expect(onConditionsChange).not.toHaveBeenCalled();
    expect(await axeViolations(container)).toEqual([]);
    await user.click(screen.getByRole('button', { name: 'Use the Skills field' }));
    expect(onConditionsChange).toHaveBeenCalledWith(
      [...(asked.query?.conditions ?? []), skills],
      'all',
    );
    expect(screen.queryByRole('heading', { name: 'One part I couldn’t use' })).toBeNull();
  });

  it('Remind all, Save as view and Export, from a question’s results', async () => {
    const user = fast();
    const onRemind = vi.fn(() => Promise.resolve({ ok: true as const, asked: 7, more: false }));
    render(
      <Directory
        {...props({
          onAsk: vi.fn(),
          asked: 'engineers missing bank details',
          onRemind,
          onExport: vi.fn(),
          onSaveSegment: vi.fn(() => Promise.resolve({ ok: true as const })),
          onConditionsChange: vi.fn(),
          load: {
            status: 'ready',
            data: {
              ...asked,
              total: 7,
              remind: ['bank_account'],
              fields: [
                ...(asked.fields ?? []),
                { key: 'bank_account', label: 'Bank account', kind: 'text', options: [] },
              ],
              query: {
                conditions: [{ key: 'bank_account', op: 'empty', values: [] }],
                match: 'all',
                sort: null,
              },
            },
          },
        })}
      />,
    );
    expect(screen.getByRole('button', { name: 'Save as view' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Export' })).toBeInTheDocument();
    expect(
      within(screen.getByRole('group', { name: 'Understood as' })).getByText('Bank account'),
    ).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Remind all 7' }));
    expect(onRemind).toHaveBeenCalledWith(
      [{ key: 'bank_account', op: 'empty', values: [] }],
      'all',
    );
    expect(await screen.findByText('Asked 7 people for their bank account.')).toBeInTheDocument();
  });

  it('clearing the question clears what it became', async () => {
    const user = fast();
    const onAsk = vi.fn(() =>
      Promise.resolve({
        ok: true as const,
        by: 'search' as const,
        note: null,
        unused: [],
        filters: 0,
        search: null,
      }),
    );
    render(
      <Directory
        {...props({ onAsk, asked: 'managers in Sales', load: { status: 'ready', data: asked } })}
      />,
    );
    await user.click(screen.getByRole('button', { name: 'Clear search people' }));
    expect(onAsk).toHaveBeenCalledWith('', {});
  });

  it('returns to the row the address names: as many pages as it takes', async () => {
    const onLoadMore = vi.fn(() =>
      Promise.resolve({
        people: [
          {
            id: 'k',
            name: 'Katherine Johnson',
            email: null,
            avatarUrl: null,
            values: {},
            missing: 0,
          },
        ],
        next: null,
      }),
    );
    // Nothing nears the end on its own here: only the place asks for the page.
    vi.stubGlobal(
      'IntersectionObserver',
      class {
        observe(): void {}
        disconnect(): void {}
      },
    );
    render(<Directory {...props({ view: 'cards', onLoadMore, next: 'cursor-1', place: 3 })} />);
    await vi.waitFor(() => {
      expect(onLoadMore).toHaveBeenCalledWith('cursor-1');
    });
    expect(await screen.findByText('Katherine Johnson')).toBeInTheDocument();
    vi.unstubAllGlobals();
  });

  it('without a way to ask, Enter is only a name search', async () => {
    const user = fast();
    render(<Directory {...props()} />);
    const box = screen.getByRole('searchbox', { name: 'Search people' });
    expect(box).toHaveAttribute('placeholder', 'Search by name, email or employee number');
    await user.type(box, 'Ada{Enter}');
    expect(screen.queryByText(/read by/u)).toBeNull();
  });

  it('opens with the search a link carried, and follows the address when it changes', () => {
    const { rerender } = render(<Directory {...props({ search: 'lena' })} />);
    expect(screen.getByRole('searchbox', { name: 'Search people' })).toHaveValue('lena');
    rerender(<Directory {...props({ search: '' })} />);
    expect(screen.getByRole('searchbox', { name: 'Search people' })).toHaveValue('');
  });
});
