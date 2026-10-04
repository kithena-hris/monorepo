import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { renderToString } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

import {
  DataTable,
  describeSorts,
  stretchOverflowing,
  type DataColumn,
  type DataTableHandle,
} from './data-table';

interface Person {
  id: string;
  name: string;
  team: string;
  start: string;
  salary: number;
}

const people: Person[] = [
  { id: '1', name: 'Priya Shah', team: 'Engineering', start: '2024-09-02', salary: 92000 },
  { id: '2', name: 'Amara Okafor', team: 'Design', start: '2022-06-20', salary: 84000 },
  { id: '3', name: 'Jonas Weber', team: 'Engineering', start: '2021-01-14', salary: 118000 },
  { id: '4', name: 'Lucas Moreau', team: 'Sales', start: '2026-09-21', salary: 71000 },
];

const columns: DataColumn<Person>[] = [
  { id: 'name', header: 'Name', sortBy: (p) => p.name, cell: (p) => p.name },
  { id: 'team', header: 'Team', sortBy: (p) => p.team, cell: (p) => p.team },
  { id: 'start', header: 'Start date', sortBy: (p) => p.start, cell: (p) => p.start },
  {
    id: 'salary',
    header: 'Salary',
    numeric: true,
    sortBy: (p) => p.salary,
    cell: (p) => String(p.salary),
    aggregate: (rows) => `Σ ${String(rows.reduce((sum, p) => sum + p.salary, 0))}`,
  },
];

const names = (): string[] =>
  within(screen.getAllByRole('rowgroup')[1] ?? document.body)
    .getAllByRole('row')
    .map((row) => within(row).queryAllByRole('cell')[0]?.textContent ?? '');

describe('<DataTable multiSort>', () => {
  it('replaces the sort on a click and adds to it on a shift-click', () => {
    const onSortsChange = vi.fn();
    render(
      <DataTable
        label="People"
        rows={people}
        columns={columns}
        rowId={(p) => p.id}
        multiSort
        onSortsChange={onSortsChange}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: /^Team/ }));
    fireEvent.click(screen.getByRole('button', { name: /^Start date/ }), { shiftKey: true });

    expect(onSortsChange).toHaveBeenLastCalledWith([
      { columnId: 'team', direction: 'ascending' },
      { columnId: 'start', direction: 'ascending' },
    ]);
    // Design first, then Engineering by start date, then Sales.
    expect(names()).toEqual(['Amara Okafor', 'Jonas Weber', 'Priya Shah', 'Lucas Moreau']);
    // One sorted header for ARIA; the second says its place in words.
    expect(screen.getByRole('columnheader', { name: /Team/ })).toHaveAttribute(
      'aria-sort',
      'ascending',
    );
    expect(screen.getByRole('columnheader', { name: /Start date/ })).toHaveAttribute(
      'aria-sort',
      'none',
    );
    expect(screen.getByRole('button', { name: /^Start date, sort 2/ })).toBeInTheDocument();
  });

  it('flips a column already in the sort without dropping the others', () => {
    const onSortsChange = vi.fn();
    render(
      <DataTable
        label="People"
        rows={people}
        columns={columns}
        rowId={(p) => p.id}
        multiSort
        defaultSort={[
          { columnId: 'team', direction: 'ascending' },
          { columnId: 'start', direction: 'ascending' },
        ]}
        onSortsChange={onSortsChange}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: /^Start date/ }), { shiftKey: true });

    expect(onSortsChange).toHaveBeenLastCalledWith([
      { columnId: 'team', direction: 'ascending' },
      { columnId: 'start', direction: 'descending' },
    ]);
  });
});

describe('describeSorts', () => {
  it('names the columns in order', () => {
    expect(
      describeSorts(
        [
          { columnId: 'team', direction: 'ascending' },
          { columnId: 'start', direction: 'descending' },
        ],
        columns,
      ),
    ).toBe('Team, then start date');
  });
});

describe('<DataTable groupBy>', () => {
  it('draws a header per group with its count and aggregates, and collapses it', () => {
    render(
      <DataTable
        label="People"
        rows={people}
        columns={columns}
        rowId={(p) => p.id}
        groupBy={(p) => p.team}
        defaultCollapsedGroups={['Sales']}
      />,
    );

    const engineering = screen.getByRole('button', { name: 'Engineering, 2 rows' });
    expect(engineering).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByText('Σ 210000')).toBeInTheDocument();
    // Sales is collapsed: its header and count stay, its row does not.
    expect(screen.getByRole('button', { name: 'Sales, 1 row' })).toHaveAttribute(
      'aria-expanded',
      'false',
    );
    expect(screen.queryByText('Lucas Moreau')).not.toBeInTheDocument();

    fireEvent.click(engineering);

    expect(engineering).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByText('Priya Shah')).not.toBeInTheDocument();
    expect(screen.getByText('Amara Okafor')).toBeInTheDocument();
  });
});

interface Scientist {
  id: string;
  name: string;
}

const scientists: Scientist[] = [
  { id: 'a', name: 'Ada' },
  { id: 'b', name: 'Grace' },
  { id: 'c', name: 'Radia' },
];
const nameColumn: DataColumn<Scientist>[] = [{ id: 'name', header: 'Name', cell: (r) => r.name }];

describe('<DataTable> striped, resizable, paged and grouped', () => {
  it('washes every other row, never over a selection', () => {
    render(
      <DataTable
        label="People"
        rows={scientists}
        columns={nameColumn}
        rowId={(r) => r.id}
        striped
      />,
    );
    const [, first, second, third] = screen.getAllByRole('row');
    expect(first).not.toHaveAttribute('data-striped');
    expect(second).toHaveAttribute('data-striped');
    expect(third).not.toHaveAttribute('data-striped');
  });

  it('widens a column from its header edge, by keyboard as well as pointer', () => {
    const onColumnWidthsChange = vi.fn();
    render(
      <DataTable
        label="People"
        rows={scientists}
        columns={[{ ...nameColumn[0], width: '10rem' } as DataColumn<Scientist>]}
        rowId={(r) => r.id}
        resizable
        onColumnWidthsChange={onColumnWidthsChange}
      />,
    );
    const handle = screen.getByRole('separator', { name: 'Resize Name' });
    expect(handle).toHaveAttribute('aria-valuenow', '160');
    fireEvent.keyDown(handle, { key: 'ArrowRight' });
    expect(onColumnWidthsChange).toHaveBeenLastCalledWith({ name: 176 });
    expect(handle).toHaveAttribute('aria-valuenow', '176');
    fireEvent.keyDown(handle, { key: 'ArrowLeft', shiftKey: true });
    expect(onColumnWidthsChange).toHaveBeenLastCalledWith({ name: 112 });
  });

  it('asks for more when what is loaded does not fill the container', () => {
    const onEndReached = vi.fn();
    render(
      <DataTable
        label="People"
        rows={scientists}
        columns={nameColumn}
        rowId={(r) => r.id}
        onEndReached={onEndReached}
      />,
    );
    // jsdom measures nothing, so everything is "near the end".
    expect(onEndReached).toHaveBeenCalled();
  });

  it('while the next page loads, a skeleton row in the rows’ shape, and no further asking', () => {
    const onEndReached = vi.fn();
    render(
      <DataTable
        label="People"
        rows={people}
        columns={columns}
        rowId={(p) => p.id}
        onEndReached={onEndReached}
        loadingMore
      />,
    );
    const busy = screen.getAllByRole('row').find((r) => r.getAttribute('aria-busy') === 'true');
    expect(busy).toBeDefined();
    expect(within(busy ?? document.body).getAllByRole('cell')).toHaveLength(columns.length);
    expect(busy?.textContent).toBe('Loading more');
    expect(onEndReached).not.toHaveBeenCalled();
  });

  it('puts rows under a heading per group, counting each', () => {
    render(
      <DataTable
        label="People"
        rows={[
          { id: 'a', name: 'Ada', team: 'Research' },
          { id: 'b', name: 'Grace', team: 'Research' },
          { id: 'c', name: 'Radia', team: 'Networks' },
        ]}
        columns={[{ id: 'name', header: 'Name', cell: (r) => r.name }]}
        rowId={(r) => r.id}
        groupBy={(r) => r.team}
      />,
    );
    const headings = screen.getAllByRole('rowheader');
    expect(headings.map((h) => h.textContent)).toEqual(['Research2', 'Networks1']);
  });
});

describe('stretchOverflowing', () => {
  it('gives spare width only to columns that overflow, up to what each needs', () => {
    expect(stretchOverflowing(500, { name: 40, team: 0, email: 120 })).toEqual({
      name: 40,
      email: 120,
    });
  });

  it('shares too little spare in proportion to the need', () => {
    expect(stretchOverflowing(80, { name: 40, email: 120 })).toEqual({ name: 20, email: 60 });
  });

  it('moves nothing when nothing overflows or nothing is spare', () => {
    expect(stretchOverflowing(500, { name: 0 })).toEqual({});
    expect(stretchOverflowing(0, { name: 40 })).toEqual({});
  });
});

/** A desk's layout, which jsdom has none of: a 400px box, 57px rows. */
function layOut(): void {
  const height = (el: HTMLElement): number => (el.getAttribute('role') === 'region' ? 400 : 57);
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (
    this: HTMLElement,
  ) {
    const h = height(this);
    return { top: 0, left: 0, right: 800, bottom: h, width: 800, height: h } as DOMRect;
  });
  vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockImplementation(function (
    this: HTMLElement,
  ) {
    return height(this);
  });
}

describe('<DataTable> that keeps loading', () => {
  const more = (n: number): Person[] =>
    Array.from({ length: n }, (_, i) => ({
      id: `m${String(i)}`,
      name: `Person ${String(i)} with a name long enough to overflow its column`,
      team: 'Engineering',
      start: '2024-01-01',
      salary: 1,
    }));

  it('draws its first rows before its box is measured, so the server’s HTML has them', () => {
    const html = renderToString(
      <DataTable
        label="People"
        rows={[...people, ...more(150)]}
        columns={columns}
        rowId={(p) => p.id}
        onEndReached={vi.fn()}
      />,
    );
    // A window's worth and the overscan, not a skeleton, and not all 155.
    expect(html).toContain('data-row-id="1"');
    expect(html).toContain('data-row-id="m10"');
    expect(html).not.toContain('data-row-id="m140"');
  });

  it('is virtualized from its first page, so the rows on screen never remount at the threshold', () => {
    layOut();
    const { rerender } = render(
      <DataTable
        label="People"
        rows={people}
        columns={columns}
        rowId={(p) => p.id}
        onEndReached={vi.fn()}
      />,
    );
    expect(screen.getByRole('table')).toHaveAttribute('aria-rowcount', '5');
    const first = document.querySelector('tr[data-row-id="1"]');
    rerender(
      <DataTable
        label="People"
        rows={[...people, ...more(150)]}
        columns={columns}
        rowId={(p) => p.id}
        onEndReached={vi.fn()}
      />,
    );
    expect(first).not.toBeNull();
    expect(document.querySelector('tr[data-row-id="1"]')).toBe(first);
    vi.restoreAllMocks();
  });

  it('arrives from the server with its first rows drawn, not a skeleton', () => {
    const html = renderToString(
      <DataTable
        label="People"
        rows={more(500)}
        columns={columns}
        rowId={(p) => p.id}
        onEndReached={vi.fn()}
      />,
    );
    expect(html).toContain('data-row-id="m0"');
    expect(html).toContain('data-row-id="m20"');
    // Only a window of them: the rest are counted, not drawn.
    expect(html).not.toContain('data-row-id="m200"');
  });

  it('says how many more each page brought', () => {
    const { rerender } = render(
      <DataTable
        label="People"
        rows={people}
        columns={columns}
        rowId={(p) => p.id}
        onEndReached={vi.fn()}
      />,
    );
    rerender(
      <DataTable
        label="People"
        rows={[...people, ...more(50)]}
        columns={columns}
        rowId={(p) => p.id}
        onEndReached={vi.fn()}
      />,
    );
    expect(screen.getByText('50 more loaded')).toBeInTheDocument();
  });

  it('keeps fixed column widths as rows arrive', () => {
    const widths = (): string[] =>
      [...document.querySelectorAll<HTMLElement>('thead th')].map((th) => th.style.width);
    const { rerender } = render(
      <DataTable
        label="People"
        rows={people}
        columns={columns}
        rowId={(p) => p.id}
        columnSizing="fixed"
      />,
    );
    const before = widths();
    expect(before.every((w) => w.endsWith('px'))).toBe(true);
    // The widths add up to the table's, so the browser has nothing to share out.
    expect(screen.getByRole('table').style.width).toBe(`${String(176 * 4)}px`);
    rerender(
      <DataTable
        label="People"
        rows={[...people, ...more(60)]}
        columns={columns}
        rowId={(p) => p.id}
        columnSizing="fixed"
      />,
    );
    expect(widths()).toEqual(before);
  });

  it('reveals a row from outside: a jump under reduced motion, and the keyboard lands on it', () => {
    const into = vi.fn();
    Element.prototype.scrollIntoView = into;
    vi.stubGlobal(
      'matchMedia',
      vi.fn(
        (query: string) =>
          ({
            matches: query.includes('reduce'),
            media: query,
            addEventListener: vi.fn(),
            removeEventListener: vi.fn(),
          }) as unknown as MediaQueryList,
      ),
    );
    const handle: { current: DataTableHandle | null } = { current: null };
    render(
      <DataTable
        ref={handle}
        label="People"
        rows={people}
        columns={columns}
        rowId={(p) => p.id}
        onRowClick={vi.fn()}
      />,
    );
    const row = document.querySelector<HTMLElement>('tr[data-row-id="3"]');
    if (row === null) throw new Error('No row');
    // Below the box: jsdom lays nothing out, so say where it is.
    vi.spyOn(row, 'getBoundingClientRect').mockReturnValue({ top: 2000, bottom: 2057 } as DOMRect);
    act(() => {
      handle.current?.revealRow('3', { focus: true });
    });
    expect(into).toHaveBeenCalledWith({ block: 'center', behavior: 'auto' });
    expect(row).toHaveFocus();
    expect(row).toHaveAttribute('tabindex', '0');
    vi.unstubAllGlobals();
  });
});

describe('<DataTable> pinned header and a virtualized body', () => {
  const many = Array.from({ length: 400 }, (_, i) => ({
    id: String(i),
    name: `Person ${String(i)}`,
  }));
  const nameAndTeam: DataColumn<{ id: string; name: string }>[] = [
    { id: 'name', header: 'Name', sticky: true, cell: (r) => r.name },
    { id: 'team', header: 'Team', cell: () => 'Research' },
  ];

  /** The box 400px tall and every row its 57px estimate, as a browser would lay them out. */
  function scrollTo(top: number): void {
    const box = screen.getByRole('region', { name: 'People' });
    Object.defineProperty(box, 'scrollTop', { configurable: true, value: top });
    act(() => {
      fireEvent.scroll(box);
    });
  }

  it('keeps every header cell opaque and above the body, the pinned corner above both', () => {
    render(
      <DataTable
        label="People"
        rows={many.slice(0, 3)}
        columns={nameAndTeam}
        rowId={(r) => r.id}
        stickyHeader
      />,
    );
    const head = document.querySelector('thead');
    expect(head?.className).toContain('[[data-sticky-header]_&_th]:bg-surface');
    expect(head?.className).toContain('[[data-sticky-header]_&_th]:z-20');
    expect(head?.className).not.toContain('glass');
    // The corner over the header row; the body's pinned column under both.
    expect(document.querySelector('thead th')?.className).toMatch(/(^| )z-30!( |$)/);
    expect(document.querySelector('tbody td')?.className).toMatch(/(^| )z-10( |$)/);
    // And all of it inside the table's own stacking, under the page's bars.
    expect(screen.getByRole('region', { name: 'People' })).toHaveClass('isolate');
  });

  it('stripes by a row’s place in the list, not in the DOM, as rows are recycled', () => {
    layOut();
    render(
      <DataTable
        label="People"
        rows={many}
        columns={nameAndTeam}
        rowId={(r) => r.id}
        virtualize
        striped
      />,
    );
    const firstDrawn = (): number => {
      const drawn = [...document.querySelectorAll<HTMLElement>('tbody tr[data-row-id]')];
      for (const row of drawn) {
        const place = Number(row.dataset['rowId']);
        expect(row.hasAttribute('data-striped'), `row ${String(place)}`).toBe(place % 2 === 1);
      }
      return Number(drawn[0]?.dataset['rowId']);
    };
    expect(firstDrawn()).toBe(0);
    // Down the list: the first row in the DOM is a different one, at its own place.
    scrollTo(101 * 57);
    const first = firstDrawn();
    expect(first).toBeGreaterThan(0);
    scrollTo(102 * 57);
    expect(firstDrawn()).not.toBe(first);
    vi.restoreAllMocks();
  });

  it('draws the rows it has not rendered as hairlined rows, at the rows’ height, never blank', () => {
    layOut();
    render(
      <DataTable
        label="People"
        rows={many}
        columns={nameAndTeam}
        rowId={(r) => r.id}
        virtualize
        estimateRowHeight={57}
      />,
    );
    scrollTo(200 * 57);
    const spacers = [...document.querySelectorAll<HTMLElement>('tbody tr[data-spacer]')];
    // One above what is drawn and one below: together, every row not drawn.
    expect(spacers).toHaveLength(2);
    const drawn = document.querySelectorAll('tbody tr[data-row-id]').length;
    const height = spacers.reduce((sum, row) => sum + Number.parseFloat(row.style.height), 0);
    expect(height).toBe((many.length - drawn) * 57);
    for (const row of spacers) {
      expect(row).toHaveAttribute('aria-hidden', 'true');
      // One cell across the columns, a hairline tiled at the row height.
      const cells = [...row.querySelectorAll<HTMLElement>('td')];
      expect(cells).toHaveLength(1);
      expect(cells[0]).toHaveAttribute('colspan', String(nameAndTeam.length));
      expect(cells[0]?.style.backgroundSize).toContain('57px');
      expect(cells[0]?.style.backgroundRepeat).toBe('repeat-y');
    }
    // A drawn desk row is exactly its estimate, so measuring it moves nothing.
    expect(document.querySelector<HTMLElement>('tbody tr[data-row-id]')?.style.height).toBe('57px');
    vi.restoreAllMocks();
  });

  it('renders only the rows a scroll brings into view, not every row drawn', () => {
    layOut();
    const rendered: string[] = [];
    const counted: DataColumn<{ id: string; name: string }>[] = [
      {
        id: 'name',
        header: 'Name',
        cell: (r) => {
          rendered.push(r.id);
          return r.name;
        },
      },
      { id: 'team', header: 'Team', cell: () => 'Research' },
    ];
    render(
      <DataTable
        label="People"
        rows={many}
        columns={counted}
        rowId={(r) => r.id}
        virtualize
        selectable
        striped
        onRowClick={vi.fn()}
        rowActions={() => []}
        estimateRowHeight={57}
      />,
    );
    scrollTo(100 * 57);
    const before = new Set(
      [...document.querySelectorAll<HTMLElement>('tbody tr[data-row-id]')].map(
        (row) => row.dataset['rowId'],
      ),
    );
    rendered.length = 0;
    // One row further: one row enters at the bottom, one leaves at the top.
    scrollTo(101 * 57);
    const after = [...document.querySelectorAll<HTMLElement>('tbody tr[data-row-id]')].map(
      (row) => row.dataset['rowId'],
    );
    const entered = after.filter((id) => !before.has(id));
    // A window and its overscan drawn (48 here), and of them only the one
    // that entered rendered: before rows were memoised, all 48 were.
    expect(after.length).toBeGreaterThan(40);
    expect(entered).toHaveLength(1);
    expect(rendered).toEqual(entered);
    vi.restoreAllMocks();
  });

  it('draws loaded rows it has not mounted as plain rows, never as skeletons', () => {
    layOut();
    render(
      <DataTable
        label="People"
        rows={many}
        columns={nameAndTeam}
        rowId={(r) => r.id}
        virtualize
        estimateRowHeight={57}
      />,
    );
    scrollTo(200 * 57);
    const spacers = [...document.querySelectorAll<HTMLElement>('tbody tr[data-spacer]')];
    expect(spacers).toHaveLength(2);
    expect(document.querySelector('tbody [data-skeleton]')).toBeNull();
    for (const cell of spacers.flatMap((row) => [...row.querySelectorAll<HTMLElement>('td')])) {
      // The hairline under each row and nothing else: no bar.
      expect(cell.style.backgroundImage).not.toContain('surface-sunken');
      expect(cell.querySelector('[data-skeleton], .animate-pulse')).toBeNull();
    }
    vi.restoreAllMocks();
  });

  it('holds the box to the whole list’s height, not the table’s layout of the moment', () => {
    layOut();
    const props = {
      label: 'People',
      rows: many,
      columns: nameAndTeam,
      rowId: (r: { id: string }) => r.id,
      estimateRowHeight: 57,
      onEndReached: vi.fn(),
    };
    const { rerender } = render(<DataTable {...props} />);
    const box = screen.getByRole('region', { name: 'People' });
    const extent = (): number =>
      Number.parseFloat(
        box.querySelector<HTMLElement>(':scope > div[aria-hidden]')?.style.height ?? '',
      );
    // The header (57 here) and every row at its height, drawn or not.
    expect(extent()).toBe(57 + many.length * 57);
    expect(box).toHaveClass('relative');
    // The next page's skeleton row counts too.
    rerender(<DataTable {...props} loadingMore />);
    expect(extent()).toBe(57 + (many.length + 1) * 57);
    // While more is coming the wheel stays with the table; at the end it may go on to the page.
    expect(box).toHaveClass('overscroll-y-contain');
    const { onEndReached: _more, ...done } = props;
    rerender(<DataTable {...done} />);
    expect(box).not.toHaveClass('overscroll-y-contain');
    vi.restoreAllMocks();
  });
});
