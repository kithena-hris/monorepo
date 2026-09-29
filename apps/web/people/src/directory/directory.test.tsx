import { render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { fast } from '../test/user';
import { axeViolations } from '../test/axe';
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

  it('opens a quick look beside the list, then the person (W3b)', async () => {
    const user = fast();
    const onOpen = vi.fn();
    const { container } = render(<Directory {...props({ onOpen })} />);
    await user.click(screen.getByRole('button', { name: 'Lena Moreau' }));
    const look = screen.getByRole('complementary', { name: 'Quick look' });
    expect(within(look).getByRole('heading', { name: 'Lena Moreau' })).toBeInTheDocument();
    expect(await axeViolations(container)).toEqual([]);
    // ↑ moves the look to the person above, ↵ opens them.
    screen.getByRole('button', { name: 'Lena Moreau' }).focus();
    await user.keyboard('{ArrowUp}');
    expect(within(look).getByRole('heading', { name: 'Adam Reyes' })).toBeInTheDocument();
    await user.keyboard('{Enter}');
    expect(onOpen).toHaveBeenCalledWith('a');
    await user.click(within(look).getByRole('button', { name: 'Profile' }));
    expect(onOpen).toHaveBeenLastCalledWith('a');
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

  it('draws the view its route names, and asks the shell for another (V2, V3)', async () => {
    const user = fast();
    const onViewChange = vi.fn();
    const { container, rerender } = render(<Directory {...props({ onViewChange })} />);
    const views = screen.getAllByRole('radiogroup', { name: 'Show people as' })[0] as HTMLElement;
    expect(within(views).getByRole('radio', { name: 'List' })).toBeChecked();
    expect(screen.getByRole('table', { name: 'People' })).toBeInTheDocument();
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
    expect(screen.getByText('Showing 3 of 420')).toBeInTheDocument();
    // No pager beside an infinite table.
    expect(screen.queryByRole('navigation', { name: 'Pages of people' })).toBeNull();
    expect(onLoadMore).toHaveBeenCalledOnce();
    expect(await axeViolations(container)).toEqual([]);
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

describe('the directory’s search, in the address', () => {
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

  it('opens with the search a link carried, and follows the address when it changes', () => {
    const { rerender } = render(<Directory {...props({ search: 'lena' })} />);
    expect(screen.getByRole('searchbox', { name: 'Search people' })).toHaveValue('lena');
    rerender(<Directory {...props({ search: '' })} />);
    expect(screen.getByRole('searchbox', { name: 'Search people' })).toHaveValue('');
  });
});
