import { PageLayout, TooltipProvider } from '@reach/ui';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { useState, type JSX } from 'react';
import { describe, expect, it, vi } from 'vitest';

import type { CompletenessPage, CompletenessState, GapRow } from '../completeness/completeness-grid';
import type { DuplicatePair } from './duplicates';
import { idCheckId, type ReviewItem } from './identifier-reviews';
import { Review, type ReviewState } from './review';
import { NOTHING, actions } from './review.fixture';

/**
 * Review at a company's scale, in a real browser: ten thousand items waiting
 * (five thousand ID checks, five thousand possible duplicates) and five
 * thousand people missing details, a page at a time. What jsdom cannot say:
 * how long a chip, a pick and a page take to be painted, the longest frame
 * of a scroll, and whether what was on screen is still the same element
 * afterwards rather than one drawn again in its place.
 *
 * Mounted as the shell mounts it: a fresh `load` and fresh callbacks on every
 * render, the chip, the item and the fill-in grid held in the address.
 */

const coarse = matchMedia('(pointer: coarse)').matches;
// As `completeness.browser.test.tsx`: Chromium's budgets on a developer
// machine, twice the room in WebKit, and on CI the flow without the clock.
const webkit = /AppleWebKit/.test(navigator.userAgent) && !/Chrome/.test(navigator.userAgent);
const room = import.meta.env['CI_RUN'] === true ? Number.POSITIVE_INFINITY : webkit ? 2 : 1;
const SCALE_TIMEOUT = 60_000;

const N = 5_000;
const minutesAgo = (i: number): string => new Date(Date.UTC(2026, 8, 24) - i * 60_000).toISOString();

const idCheck = (i: number): ReviewItem => ({
  personId: `p${String(i)}`,
  name: `Person ${String(i)}`,
  attributeKey: 'national_id',
  label: 'National ID',
  last4: '123Y',
  findings: [{ level: 'mismatch', code: 'checksum', message: 'does not compute' }],
  enteredAt: minutesAgo(i),
  enteredBy: 'Marco Ruiz',
});

const pair = (i: number): DuplicatePair => ({
  personIds: [`d${String(i)}a`, `d${String(i)}b`],
  names: [`Twin ${String(i)}`, `Twin ${String(i)} B`],
  reasons: ['Same work email'],
  match: 'strong',
  flaggedBy: 'SCIM provisioning',
});

const many = (n: number, word: string) =>
  Array.from({ length: n }, (_, i) => ({
    value: `${word}${String(i)}`,
    label: `${word} ${String(i)}`,
  }));

/** A dozen fields of every kind, as `completeness.browser.test.tsx` fills them. */
const FIELDS: CompletenessState['fields'] = [
  { key: 'desk', label: 'Desk', dataType: 'text', options: [], person: false },
  {
    key: 'cost_centre',
    label: 'Cost centre',
    dataType: 'select',
    options: many(12, 'CC'),
    person: false,
  },
  {
    key: 'nationality',
    label: 'Nationality',
    dataType: 'country',
    options: many(249, 'Country'),
    person: false,
  },
  { key: 'contract_end', label: 'Contract end', dataType: 'date', options: [], person: false },
  {
    key: 'equipment',
    label: 'Equipment',
    dataType: 'multi_select',
    options: many(8, 'Kit'),
    person: false,
  },
  { key: 'remote', label: 'Remote', dataType: 'boolean', options: [], person: false },
  {
    key: 'allowance',
    label: 'Allowance',
    dataType: 'money',
    currency: 'EUR',
    options: [],
    person: false,
  },
  { key: 'work_phone', label: 'Work phone', dataType: 'phone', options: [], person: false },
  { key: 'es_nif', label: 'NIF', dataType: 'national_id', options: [], person: false },
  { key: 'manager', label: 'Manager', dataType: 'person_ref', options: [], person: true },
  {
    key: 'emergency_contact_relationship',
    label: 'Emergency contact relationship',
    dataType: 'text',
    options: [],
    person: false,
  },
];

const gap = (i: number): GapRow => ({
  personId: `g${String(i)}`,
  name: `Gap ${String(i)}`,
  department: 'Engineering',
  manager: null,
  // Each person a different few of them, so no two rows are alike: what a
  // table laid out on its content would widen and heighten for as they pass.
  missing: FIELDS.filter((_, k) => k === 0 || (i + k) % 4 !== 0).map((f) => f.key),
  owner: 'hr',
  remindedAt: null,
});

const MISSING_PAGE = 1_000;

const STATE: ReviewState = {
  ...NOTHING,
  identifiers: { items: Array.from({ length: N }, (_, i) => idCheck(i)) },
  duplicates: {
    items: Array.from({ length: N }, (_, i) => pair(i)),
    merges: [],
    comparison: null,
  },
  completeness: {
    since: 'Since version 4',
    waiting: { people: 0, lastReminded: null, due: 0 },
    completedThisWeek: 0,
    toFill: 4 * N,
    listed: 2 * N,
    blocking: null,
    fields: FIELDS,
    rows: Array.from({ length: MISSING_PAGE }, (_, i) => gap(i)),
    next: String(MISSING_PAGE),
  },
  counts: { changes: 0, identifiers: N, duplicates: N, accessRequests: 0, exports: 0 },
};

/** People's pages of missing details, each when `land` is called for it. */
function missingPages() {
  const waiting: (() => void)[] = [];
  const onLoadMore = vi.fn(
    (after: string) =>
      new Promise<CompletenessPage | null>((resolve) => {
        const from = Number(after);
        waiting.push(() => {
          resolve({
            rows: Array.from({ length: MISSING_PAGE }, (_, i) => gap(from + i)),
            fields: FIELDS,
            next: from + MISSING_PAGE < 2 * N ? String(from + MISSING_PAGE) : null,
          });
        });
      }),
  );
  const land = async (): Promise<void> => {
    await vi.waitFor(() => {
      expect(waiting.length).toBeGreaterThan(0);
    });
    await act(async () => {
      waiting.shift()?.();
      await Promise.resolve();
    });
  };
  return { onLoadMore, land };
}

/** Reads the page again, as the shell's `refresh()` after a save does. */
let reread: () => void = () => undefined;

/** The shell: the address in state, and everything handed down made again on each render. */
function Host({
  onLoadMore,
  opened = null,
}: {
  readonly onLoadMore: (after: string) => Promise<CompletenessPage | null>;
  /** The item the address opened the page on (`?item=`). */
  readonly opened?: string | null;
}): JSX.Element {
  const [kind, setKind] = useState<string | null>(null);
  const [item, setItem] = useState<string | null>(opened);
  const [fill, setFill] = useState<string | null>(null);
  // The page read again, as the shell does after a save: the same answer, new objects.
  const [data, setData] = useState(STATE);
  reread = () => {
    setData((d) => ({
      ...d,
      completeness: d.completeness === null ? null : { ...d.completeness },
    }));
  };
  return (
    <Review
      load={{ status: 'ready', data }}
      tab="waiting"
      {...actions()}
      kind={kind}
      onKindChange={(next) => {
        setKind(next);
        setItem(null);
        setFill(null);
      }}
      item={item}
      onItemChange={(next) => {
        setItem(next);
      }}
      fill={fill}
      onFillChange={(next) => {
        setFill(next);
      }}
      onLoadMoreMissing={(after) => onLoadMore(after)}
      onRemind={() => Promise.resolve({ ok: true as const })}
    />
  );
}

function mount(opened: string | null = null) {
  const pages = missingPages();
  render(
    <TooltipProvider>
      <PageLayout>
        <Host onLoadMore={pages.onLoadMore} opened={opened} />
      </PageLayout>
    </TooltipProvider>,
  );
  return pages;
}

/** Two frames: what was rendered has been laid out and painted. */
const painted = () =>
  new Promise<void>((done) => {
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        done();
      });
    });
  });

/**
 * From a click to what it shows, painted, in ms. The render is React's in
 * the click (`act`); what it shows is checked after the clock stops, so the
 * test's own search of the page is not counted.
 */
async function timed(target: HTMLElement, shown: () => unknown): Promise<number> {
  const start = performance.now();
  act(() => {
    fireEvent.click(target);
  });
  await painted();
  const took = performance.now() - start;
  await vi.waitFor(shown);
  return took;
}

/** The nearest box that scrolls `el`, else the page. */
function scrollerOf(el: Element): HTMLElement {
  for (let at: Element | null = el.parentElement; at !== null; at = at.parentElement) {
    const style = getComputedStyle(at);
    if (/(auto|scroll)/.test(style.overflowY) && at.scrollHeight > at.clientHeight + 1) {
      return at as HTMLElement;
    }
  }
  return document.scrollingElement as HTMLElement;
}

/** What moved while a box scrolled: frames a column's width or the box's height changed. */
const moved = { widths: 0, heights: 0 };

/**
 * `step` px a frame for `frames` frames, from the page's own frames: the
 * longest frame, in ms. In a table, each frame also counts in `moved` whether
 * a column changed width or the rows' height changed with no rows added: the
 * table jumping under the reader, which is what a flicker is.
 */
async function scrolled(box: HTMLElement, frames: number, step: number): Promise<number> {
  let worst = 0;
  let last = performance.now();
  const widths = () =>
    [...box.querySelectorAll('thead th')].map((th) => th.getBoundingClientRect().width).join();
  const count = () => box.querySelector('table')?.getAttribute('aria-rowcount') ?? '';
  let was = { widths: widths(), count: count(), height: box.scrollHeight };
  for (let i = 0; i < frames; i += 1) {
    box.scrollTop += step;
    // eslint-disable-next-line no-await-in-loop -- one frame after another, in order
    await new Promise<void>((done) => {
      requestAnimationFrame(() => {
        done();
      });
    });
    const now = performance.now();
    worst = Math.max(worst, now - last);
    last = now;
    const is = { widths: widths(), count: count(), height: box.scrollHeight };
    if (is.widths !== was.widths) moved.widths += 1;
    if (is.count === was.count && is.height !== was.height) moved.heights += 1;
    was = is;
  }
  return worst;
}

const queue = () => screen.getByRole('list', { name: 'Waiting for a decision' });
const chip = (name: RegExp) => screen.getByRole('radio', { name });
/** A row of the queue by its title and kind: a search of the list alone, not of every name on the page. */
const rowOf = (name: string): HTMLElement => {
  const found = [...queue().querySelectorAll<HTMLElement>('[data-list-row]')].find((row) =>
    row.textContent.includes(name),
  );
  if (found === undefined) throw new Error(`No row ${name}`);
  return found;
};
/** How many rows the list says it has (`aria-setsize`), drawn or not. */
const listedSize = (): string | null =>
  queue().querySelector('li[aria-setsize]')?.getAttribute('aria-setsize') ?? null;
const hasRow = (name: string): boolean =>
  [...queue().querySelectorAll('[data-list-row]')].some((row) => row.textContent.includes(name));
const missingTable = () => screen.getByRole('grid', { name: 'Missing information' });
/** The queue's list, or null where it is not on the page at all. */
const listed = (): Element | null => document.querySelector('ul[aria-label="Waiting for a decision"]');

describe.skipIf(coarse)('Review at ten thousand items waiting', () => {
  it(
    'switches chips and picks items at once, scrolls smoothly, and keeps what is on screen',
    async () => {
      const start = performance.now();
      mount();
      await vi.waitFor(() => {
        expect(listed()).not.toBeNull();
      });
      await painted();
      const mounted = performance.now() - start;

      // The list, and a row on it, before the chips change what it lists.
      const list = queue();
      const first = rowOf('Person 0, ID checks');
      // Whether each was still the element it was, not one drawn again in its
      // place: the list from one kind of decision to another and back, a row
      // listed under both, and missing details between All and their chip.
      const kept: Record<string, boolean> = {};

      const ids = await timed(chip(/^ID checks/u), () => {
        expect(listedSize()).toBe(String(N));
      });
      kept['list, ID checks'] = queue() === list;
      kept['row, ID checks'] = rowOf('Person 0, ID checks') === first;
      const back = await timed(chip(/^All/u), () => {
        expect(listedSize()).toBe(String(2 * N));
      });
      kept['list, All'] = queue() === list;
      kept['row, All'] = rowOf('Person 0, ID checks') === first;
      const table = missingTable();
      const missing = await timed(chip(/^Missing details/u), () => {
        expect(listed()).toBeNull();
      });
      kept['table, Missing details'] = missingTable() === table;
      const all = await timed(chip(/^All/u), () => {
        expect(rowOf('Person 0, ID checks')).toBeVisible();
      });
      kept['table, All'] = missingTable() === table;
      const again = queue();
      const dups = await timed(chip(/^Duplicates/u), () => {
        expect(hasRow('Twin 0, Duplicates')).toBe(true);
        expect(hasRow('Person 0, ID checks')).toBe(false);
      });
      kept['list, Duplicates'] = queue() === again;
      await timed(chip(/^All/u), () => {
        expect(hasRow('Person 0, ID checks')).toBe(true);
      });

      // Picking an item: its detail beside the list, and the rest of the list as it was.
      const picking = rowOf('Person 0, ID checks');
      let pick = 0;
      for (const i of [1, 2, 3]) {
        const name = `Person ${String(i)}`;
        // eslint-disable-next-line no-await-in-loop -- one pick after another
        const took = await timed(rowOf(`${name}, ID checks`), () => {
          expect(
            [...document.querySelectorAll('h2')].some(
              (h) => h.textContent === `${name} · National ID`,
            ),
          ).toBe(true);
        });
        pick = Math.max(pick, took);
      }
      kept['row, picked'] = rowOf('Person 0, ID checks') === picking;

      // Down the list, fast, and back.
      const box = scrollerOf(queue());
      const scroll = Math.max(await scrolled(box, 30, 600), await scrolled(box, 30, -600));

      const chips = Math.max(ids, back, dups, missing, all);
      const said = `mount ${mounted.toFixed(0)}, chips ${chips.toFixed(0)} (ids ${ids.toFixed(0)}, all ${back.toFixed(0)}, missing ${missing.toFixed(0)}, all ${all.toFixed(0)}, duplicates ${dups.toFixed(0)}), pick ${pick.toFixed(0)}, scroll frame ${scroll.toFixed(0)} ms; kept ${JSON.stringify(kept)}`;
      console.info('review', said);
      expect(Object.values(kept).every(Boolean), said).toBe(true);
      // Before: chips 1.1 to 3.6 s, a pick 1.6 s, a scroll frame 51 ms, mounting
      // 3.8 s. A chip back to All also mounts missing details' first thousand.
      expect({ said, chips: chips < 150 * room }).toEqual({ said, chips: true });
      expect({ said, pick: pick < 100 * room }).toEqual({ said, pick: true });
      expect({ said, scroll: scroll < 50 * room }).toEqual({ said, scroll: true });
    },
    SCALE_TIMEOUT,
  );

  it(
    'lands pages of missing details under the rows already drawn, and the grid takes them in place',
    async () => {
      const pages = mount();
      moved.widths = 0;
      moved.heights = 0;
      await vi.waitFor(() => {
        expect(missingTable()).toBeInTheDocument();
      });
      const table = missingTable();
      const box = scrollerOf(table.querySelector('tbody tr[data-row-id]') as Element);
      // To the end of the first page: the next is asked for, and lands under
      // the last rows, which stay the rows they were.
      box.scrollTop = box.scrollHeight;
      await painted();
      const last = table.querySelector(`tr[data-row-id="g${String(MISSING_PAGE - 1)}-hr"]`);
      expect(last).not.toBeNull();
      let landing = performance.now();
      await pages.land();
      await painted();
      landing = performance.now() - landing;
      const kept: Record<string, boolean> = {
        table: missingTable() === table,
        row: table.querySelector(`tr[data-row-id="g${String(MISSING_PAGE - 1)}-hr"]`) === last,
        place: box.scrollTop > 0,
      };
      box.scrollTop = 0;
      await painted();
      const listScroll = Math.max(await scrolled(box, 30, 800), await scrolled(box, 30, -800));
      const listMoved = { ...moved };
      moved.widths = 0;
      moved.heights = 0;

      // Fill in for all: the grid over everybody HR fills, a page landing in it.
      const open = performance.now();
      act(() => {
        fireEvent.click(screen.getByRole('button', { name: 'Fill in for all' }));
      });
      await painted();
      const opened = performance.now() - open;
      const gridTable = screen.getByRole('table', { name: 'Missing values' });
      const gridBox = scrollerOf(gridTable.querySelector('tbody tr[data-row-id]') as Element);
      gridBox.scrollTop = gridBox.scrollHeight;
      await painted();
      const lastCell = `Desk for Gap ${String(2 * MISSING_PAGE - 1)}`;
      const atEnd = screen.getByRole('textbox', { name: lastCell });
      let gridLanding = performance.now();
      await pages.land();
      await painted();
      gridLanding = performance.now() - gridLanding;
      kept['grid'] = screen.getByRole('table', { name: 'Missing values' }) === gridTable;
      kept['cell'] = screen.getByRole('textbox', { name: lastCell }) === atEnd;
      kept['grid place'] = gridBox.scrollTop > 0;
      // A save, and the page read again: the rows loaded and the place stay.
      const place = gridBox.scrollTop;
      let reading = performance.now();
      act(() => {
        reread();
      });
      await painted();
      reading = performance.now() - reading;
      kept['grid, read again'] = screen.getByRole('table', { name: 'Missing values' }) === gridTable;
      kept['cell, read again'] = screen.queryByRole('textbox', { name: lastCell }) === atEnd;
      kept['place, read again'] = Math.abs(gridBox.scrollTop - place) < 2;
      gridBox.scrollTop = 0;
      await painted();
      const cell = screen.getByRole('textbox', { name: 'Desk for Gap 0' });
      const gridScroll = Math.max(
        await scrolled(gridBox, 30, 800),
        await scrolled(gridBox, 30, -800),
      );

      // A keystroke in a cell, at its worst of ten.
      let key = 0;
      for (let i = 1; i <= 10; i += 1) {
        const t = performance.now();
        act(() => {
          fireEvent.change(cell, { target: { value: 'A'.repeat(i) } });
        });
        // eslint-disable-next-line no-await-in-loop -- one key after another
        await new Promise<void>((done) => {
          requestAnimationFrame(() => {
            done();
          });
        });
        key = Math.max(key, performance.now() - t);
      }

      const said = `list page ${landing.toFixed(0)}, list scroll frame ${listScroll.toFixed(0)}, grid ${opened.toFixed(0)}, grid page ${gridLanding.toFixed(0)}, read again ${reading.toFixed(0)}, grid scroll frame ${gridScroll.toFixed(0)}, key ${key.toFixed(0)} ms; kept ${JSON.stringify(kept)}; moved while scrolling: list ${JSON.stringify(listMoved)}, grid ${JSON.stringify(moved)}`;
      console.info('missing', said);
      expect(Object.values(kept).every(Boolean), said).toBe(true);
      expect({ said, list: listMoved, grid: moved }).toEqual({
        said,
        list: { widths: 0, heights: 0 },
        grid: { widths: 0, heights: 0 },
      });
      expect({ said, pages: Math.max(landing, gridLanding) < 150 * room }).toEqual({
        said,
        pages: true,
      });
      // A dozen controls a row in the grid; before, its worst frame was 88 to 165 ms.
      expect({ said, scroll: Math.max(listScroll, gridScroll) < 75 * room }).toEqual({
        said,
        scroll: true,
      });
      expect({ said, grid: opened < 300 * room }).toEqual({ said, grid: true });
      expect({ said, key: key < 50 * room }).toEqual({ said, key: true });
    },
    SCALE_TIMEOUT,
  );

  it('opens on the item a link named, far down the list, in view beside its detail', async () => {
    mount(`id-${idCheckId(idCheck(3000))}`);
    const row = await vi.waitFor(() => rowOf('Person 3000, ID checks'));
    expect(row).toHaveAttribute('aria-current', 'true');
    expect(
      [...document.querySelectorAll('h2')].some((h) => h.textContent === 'Person 3000 · National ID'),
    ).toBe(true);
    // The virtualizer settles its scroll over a frame or two, as rows are measured.
    await vi.waitFor(() => {
      const shownRow = rowOf('Person 3000, ID checks');
      const box = scrollerOf(shownRow).getBoundingClientRect();
      const at = shownRow.getBoundingClientRect();
      expect(at.top >= box.top - 1 && at.bottom <= box.bottom + 1).toBe(true);
    });
  });
});

describe.runIf(coarse)('Review at ten thousand items waiting, under a finger', () => {
  it('lists with the page as its scroll, then opens an item with All items to go back', async () => {
    mount();
    const row = await vi.waitFor(() => rowOf('Person 2, ID checks'));
    // The page scrolls, not a box of its own, and only the rows near the view are drawn.
    expect(scrollerOf(row)).toBe(document.scrollingElement);
    expect(queue().querySelectorAll('[data-list-row]').length).toBeLessThan(60);
    act(() => {
      fireEvent.click(row);
    });
    const back = await screen.findByRole('button', { name: 'All items' });
    expect(
      [...document.querySelectorAll('h2')].some((h) => h.textContent === 'Person 2 · National ID'),
    ).toBe(true);
    act(() => {
      fireEvent.click(back);
    });
    await vi.waitFor(() => {
      expect(rowOf('Person 2, ID checks')).toBeVisible();
    });
  });
});
