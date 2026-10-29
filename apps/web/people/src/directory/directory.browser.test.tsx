import { PageLayout, TooltipProvider } from '@reach/ui';
import { render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { page, userEvent } from 'vitest/browser';

import { framed } from '../frame';
import { Directory as Screen, type DirectoryPerson, type DirectoryState } from './directory';

/** The screen as the host mounts it: its trail, its action and its tabs above it. */
const Directory = framed(Screen);
const FRAME = {
  section: 'Directory',
  actions: [{ href: '/people/directory/list?add=person', label: 'Add employee', icon: 'hire' }],
  tabs: [
    { href: '/people/directory/list', label: 'List', current: true },
    { href: '/people/directory/cards', label: 'Cards', current: false },
    { href: '/people/directory/org-chart', label: 'Org chart', current: false },
  ],
};

/**
 * The directory as it scrolls, in Chromium: the phone project (a finger, the
 * list) and the desk project (a mouse, the table and its quick look). What
 * jsdom cannot say: where a row is, how wide a column is laid out, and
 * whether a smooth scroll lands.
 */
const coarse = matchMedia('(pointer: coarse)').matches;
// A shared runner's WebKit draws a window-scrolled page several times slower
// than a developer's machine: the flow must still work there, in its own time
// (the same allowance as `completeness.browser.test.tsx`).
const webkit = /AppleWebKit/.test(navigator.userAgent) && !/Chrome/.test(navigator.userAgent);
const slow = import.meta.env['CI_RUN'] === true && webkit;
const PAGE = 50;
/** A desk row's height: the table's `estimateRowHeight`. */
const ROW = 57;

const person = (i: number): DirectoryPerson => ({
  id: `p${String(i)}`,
  // Some long, so a table laid out on its content would widen as they arrive.
  name: `Person ${String(i)}${i % 7 === 6 ? ' Featherstonehaugh-Cholmondeley' : ''}`,
  email: `person${String(i)}@acme.example`,
  avatarUrl: null,
  values: { job_title: i % 5 === 0 ? 'Principal product designer and researcher' : 'Engineer' },
  missing: 0,
});
const everybody = Array.from({ length: 1000 }, (_, i) => person(i));
const state: DirectoryState = {
  total: everybody.length,
  active: everybody.length,
  notStarted: null,
  incomplete: null,
  columns: [{ key: 'job_title', label: 'Job title' }],
  filterable: [],
  people: everybody.slice(0, PAGE),
};

/** People's pages, after `after`, a little later; and every cursor asked for. */
function pages() {
  const asked: string[] = [];
  const onLoadMore = vi.fn(async (after: string) => {
    asked.push(after);
    await new Promise((resolve) => setTimeout(resolve, 20));
    const from = Number(after);
    return {
      people: everybody.slice(from, from + PAGE),
      next: from + PAGE < everybody.length ? String(from + PAGE) : null,
    };
  });
  return { asked, onLoadMore };
}

/** Until no page has been asked for in a while: the list has stopped growing. */
async function quiet(asked: readonly string[]): Promise<void> {
  let seen = -1;
  while (asked.length !== seen) {
    seen = asked.length;
    // oxlint-disable-next-line no-await-in-loop -- waiting is the point
    await new Promise((resolve) => setTimeout(resolve, 600));
  }
}

function directory(over: { onLoadMore: (after: string) => Promise<unknown>; onOpen?: () => void }) {
  // Inside what the shell puts around it (`apps/web`'s `app-shell.tsx` and
  // the remote's mount): Reach's `PageLayout` with the rail alone, whose
  // query container WebKit lays out twice — where it lost the table's place —
  // and whose window is the one scroll.
  return render(
    <TooltipProvider>
      <PageLayout
        preset="sidebar"
        sidebarRail={<div className="h-full" />}
        bottomBar={<div className="h-14" />}
        bottomBarVariant="floating"
        bottomBarClassName="@min-[40rem]/page:hidden"
        contentClassName="relative px-(--reach-page-gutter) pt-3 pb-28 [--reach-page-gutter:1rem] @min-[40rem]/page:pt-8 @min-[40rem]/page:pb-12 @min-[40rem]/page:[--reach-page-gutter:2.5rem]"
      >
        <div className="flex flex-col gap-6">
          <div className="min-w-0">
            <div data-remote="people">
              <Directory
                load={{ status: 'ready', data: state }}
                search=""
                onSearchChange={vi.fn()}
                filters={{}}
                onFiltersChange={vi.fn()}
                onOpen={over.onOpen ?? vi.fn()}
                onLoadMore={over.onLoadMore as never}
                next={String(PAGE)}
                frame={FRAME}
              />
            </div>
          </div>
        </div>
      </PageLayout>
    </TooltipProvider>,
  );
}

const rows = (): number => document.querySelectorAll('[data-row-id], [data-person-id]').length;
const frame = () =>
  new Promise<void>((resolve) => {
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        resolve();
      });
    });
  });

/** The table's top on the page, for scrolling the window to a point in it. */
const tableTop = (box: HTMLElement): number => box.getBoundingClientRect().top + window.scrollY;

/** What of the table the window shows: under its pinned header, above the window's foot. */
function view(box: HTMLElement): { readonly top: number; readonly bottom: number } {
  const head = box.querySelector('thead th')?.getBoundingClientRect().bottom ?? 0;
  return {
    top: Math.max(head, 0),
    bottom: Math.min(box.getBoundingClientRect().bottom, window.innerHeight),
  };
}

/** In full view in the window, below the table's pinned header. */
function inView(id: string): boolean {
  const row = document.querySelector(`tr[data-row-id="${id}"]`);
  const box = screen.getByRole('region', { name: 'People' });
  if (row === null) return false;
  const r = row.getBoundingClientRect();
  const edge = view(box);
  return r.top >= edge.top - 1 && r.bottom <= edge.bottom + 1;
}

/**
 * How much of the window's view of the table, below its header, shows
 * neither a row nor the spacer standing in for one, in px. Read in a scroll
 * listener that runs before the table's own: the old rows at the new
 * position, which is what the compositor shows while the main thread is
 * still rendering.
 */
function gap(box: HTMLElement, rowsOnly = false): number {
  const edge = view(box);
  const top = edge.top;
  const spans = [
    ...box.querySelectorAll<HTMLElement>(
      rowsOnly
        ? 'tbody tr[data-row-id]'
        : 'tbody tr[data-row-id], tbody [aria-busy], [data-spacer]',
    ),
  ]
    .map((el) => el.getBoundingClientRect())
    .map((r) => [Math.max(r.top, top), Math.min(r.bottom, edge.bottom)] as const)
    .filter(([a, b]) => b > a)
    .sort((a, b) => a[0] - b[0]);
  let blank = 0;
  let at = top;
  for (const [a, b] of spans) {
    if (a > at) blank += a - at;
    at = Math.max(at, b);
  }
  return blank + Math.max(0, edge.bottom - at);
}

/**
 * A fast fling down the page: `step` px a frame for exactly `budget` frames,
 * driven from the page's own frames rather than the test driver's, so it
 * takes the same number of frames on any machine. Per frame: `early`, a gap
 * before the table rendered the new position; `late`, one after it;
 * `skeleton`, skeleton rather than rows in view; `off`, a total height that is
 * not the rows' at their estimate; `jumps`, a total height that moved with the
 * rows unchanged.
 */
async function fling(box: HTMLElement, budget: number, step: number) {
  let early = 0;
  let late = 0;
  let skeleton = 0;
  let off = 0;
  let jumps = 0;
  let was = { shape: '', height: 0 };
  let worst = 0;
  let frames = 0;
  let sawEarly = false;
  let sawSkeleton = false;
  const before = (): void => {
    const g = gap(box);
    worst = Math.max(worst, g);
    if (g > 2) sawEarly = true;
    if (gap(box, true) > 2) sawSkeleton = true;
  };
  const table = box.querySelector('table');
  const head = box.querySelector('thead')?.getBoundingClientRect().height ?? 0;
  // Capture on the window: it runs before the table's own scroll listener.
  window.addEventListener('scroll', before, { capture: true });
  let done: () => void = () => undefined;
  const finished = new Promise<void>((resolve) => {
    done = resolve;
  });
  const tick = (): void => {
    frames += 1;
    if (sawEarly) early += 1;
    if (sawSkeleton) skeleton += 1;
    sawEarly = false;
    sawSkeleton = false;
    if (gap(box) > 2) late += 1;
    const count = Number(table?.getAttribute('aria-rowcount') ?? 1) - 1;
    const busy = box.querySelector('tbody [aria-busy]') === null ? 0 : ROW;
    if (Math.abs(box.scrollHeight - (head + count * ROW + busy)) > 2) off += 1;
    // The same rows, yet a different height: a row measured off its estimate.
    const shape = `${String(count)}:${String(busy)}`;
    if (shape === was.shape && box.scrollHeight !== was.height) jumps += 1;
    was = { shape, height: box.scrollHeight };
    // One frame after the last step, to see it rendered.
    if (frames > budget) {
      done();
      return;
    }
    window.scrollBy(0, step);
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
  await finished;
  window.removeEventListener('scroll', before, { capture: true });
  return { frames, early, late, skeleton, off, jumps, worst: Math.round(worst) };
}

afterEach(() => {
  vi.restoreAllMocks();
  // The window is the list's scroll: each test starts at the top of the page.
  window.scrollTo(0, 0);
});

describe.runIf(!coarse)('the directory’s table, scrolled with a mouse', () => {
  it(
    'asks for page two at once and the next at the midpoint, each cursor once, columns still',
    { timeout: slow ? 90_000 : 15_000 },
    async () => {
      const { asked, onLoadMore } = pages();
      directory({ onLoadMore });
      // A page ahead from the start: nobody has scrolled.
      await vi.waitFor(() => {
        expect(asked).toEqual(['50']);
      });
      const box = screen.getByRole('region', { name: 'People' });
      await vi.waitFor(() => {
        expect(box.scrollHeight).toBeGreaterThan(PAGE * 2 * 50);
      });
      const widths = () =>
        [...box.querySelectorAll('thead th')].map((th) => th.getBoundingClientRect().width);
      const before = widths();
      // A third of the way down a hundred: not yet.
      window.scrollTo(0, tableTop(box) + box.scrollHeight * 0.3 - window.innerHeight);
      await frame();
      expect(asked).toEqual(['50']);
      // Past halfway: the next page, once, however often the scroll fires.
      window.scrollTo(0, tableTop(box) + box.scrollHeight * 0.55);
      await frame();
      window.scrollBy(0, 10);
      await frame();
      await vi.waitFor(() => {
        expect(asked).toEqual(['50', '100']);
      });
      await vi.waitFor(() => {
        expect(box.scrollHeight).toBeGreaterThan(PAGE * 3 * 50);
      });
      expect(widths()).toEqual(before);
    },
  );

  it('opens a quick look on a click, and Show in list brings their row back smoothly and focuses it', async () => {
    const { asked, onLoadMore } = pages();
    const onOpen = vi.fn();
    directory({ onLoadMore, onOpen });
    expect(screen.queryByRole('complementary', { name: 'Quick look' })).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: 'Person 0' }));
    const look = screen.getByRole('complementary', { name: 'Quick look' });
    expect(within(look).getByRole('heading', { name: 'Person 0' })).toBeVisible();
    expect(onOpen).not.toHaveBeenCalled();
    const box = screen.getByRole('region', { name: 'People' });
    await vi.waitFor(() => {
      expect(box.scrollHeight).toBeGreaterThan(PAGE * 2 * 50);
    });
    window.scrollTo(0, tableTop(box) + box.scrollHeight);
    await vi.waitFor(() => {
      expect(inView('p0')).toBe(false);
    });
    // At the end, page after page loads; on CI's WebKit that outlasts a click's wait.
    await quiet(asked);
    // DIAGNOSTIC (temporary): what moves under CI's WebKit.
    const show = within(look).getByRole('button', { name: 'Show in list' });
    const diag: string[] = [];
    for (let i = 0; i < 8; i += 1) {
      // oxlint-disable-next-line no-await-in-loop -- sampling frames
      await new Promise((r) => requestAnimationFrame(r));
      const r = show.getBoundingClientRect();
      const lk = look.getBoundingClientRect();
      const t = box.getBoundingClientRect();
      diag.push(
        `DIAG ${String(i)} show=${r.top.toFixed(1)},${r.left.toFixed(1)} look=${lk.top.toFixed(1)},${lk.height.toFixed(1)} y=${window.scrollY.toFixed(1)} doc=${String(document.documentElement.scrollHeight)} box=${t.top.toFixed(1)},${t.height.toFixed(1)},${String(box.scrollWidth)}/${String(box.clientWidth)} asked=${String(asked.length)} head=${box.querySelector('thead')?.style.transform ?? ''} anim=${String(document.getAnimations().length)}`,
      );
    }
    try {
      await userEvent.click(within(look).getByRole('button', { name: 'Show in list' }));
    } catch (error) {
      throw new Error(`${diag.join('\n')}\n${String(error)}`);
    }
    await vi.waitFor(
      () => {
        expect(inView('p0')).toBe(true);
        expect(document.querySelector('tr[data-row-id="p0"]')).toHaveFocus();
      },
      { timeout: slow ? 20_000 : 3000 },
    );
  });

  // A fixed 42 frames of flinging, at 300, 900 and 2,400 px a frame (the last
  // two past the overscan), down and back up. Each frame renders a fresh run
  // of rows: about 1.5 s here and 7 s with the CPU throttled 4x, so the
  // timeout leaves a slow runner four times the throttled figure.
  it(
    'never shows a blank frame in a fast fling, with pages still arriving',
    { timeout: slow ? 180_000 : 30_000 },
    async () => {
      const { onLoadMore } = pages();
      directory({ onLoadMore });
      const box = screen.getByRole('region', { name: 'People' });
      await vi.waitFor(() => {
        expect(box.scrollHeight).toBeGreaterThan(PAGE * 2 * 50);
      });
      const runs = [
        await fling(box, 10, 300),
        await fling(box, 10, 900),
        await fling(box, 6, 2400),
        await fling(box, 10, -900),
        await fling(box, 6, -2400),
      ];
      console.info('fling', JSON.stringify(runs));
      for (const run of runs) {
        expect(run.early + run.late).toBe(0);
        expect(run.off + run.jumps).toBe(0);
      }
      // The rows not mounted are loaded: a hairline per row, in the theme's
      // own colours, and no skeleton bar.
      expect(box.querySelector('[data-skeleton]')).toBeNull();
      const spacer = box.querySelector<HTMLElement>('tr[data-spacer] td');
      const paint = getComputedStyle(spacer as Element).backgroundImage;
      expect(paint).toMatch(/linear-gradient\(.*(?:rgb|oklch|color)\(/);
      expect(paint.match(/linear-gradient/g)).toHaveLength(1);
    },
  );

  // WebKit, inside the page's container: a fling that rendered the last rows
  // in one go laid the table out short for a pass, and the box clamped its
  // place to that, back to the top. Chromium waits for the final layout.
  it(
    'keeps its place when a fling lands on the last rows at once',
    { timeout: slow ? 90_000 : 15_000 },
    async () => {
      const { onLoadMore } = pages();
      directory({ onLoadMore });
      const box = screen.getByRole('region', { name: 'People' });
      await vi.waitFor(() => {
        expect(box.scrollHeight).toBeGreaterThan(PAGE * 2 * 50);
      });
      const end = document.documentElement.scrollHeight - window.innerHeight;
      for (const to of [end, 300, tableTop(box) + 70 * ROW]) {
        window.scrollTo(0, to);
        await frame();
        await frame();
        // What the page was, should it not hold: the table's height and what holds it.
        const said = `at ${String(window.scrollY)} of ${String(document.documentElement.scrollHeight)}, table ${String(Math.round(box.getBoundingClientRect().height))} held at ${box.style.minHeight || 'nothing'}, ${String(box.querySelectorAll('tr[data-row-id]').length)} rows drawn`;
        expect(window.scrollY, said).toBeGreaterThanOrEqual(Math.min(to, end) - 1);
      }
    },
  );

  it('says its keys under the list, on plain rows', async () => {
    const { onLoadMore } = pages();
    directory({ onLoadMore });
    const box = screen.getByRole('region', { name: 'People' });
    const hint = screen.getByText('quick look');
    expect(hint.getBoundingClientRect().top).toBeGreaterThanOrEqual(
      box.getBoundingClientRect().bottom,
    );
    // No stripes: every row the same surface, until hovered, picked or open.
    await vi.waitFor(() => {
      expect(box.querySelectorAll('tr[data-row-id]').length).toBeGreaterThan(10);
    });
    const fills = new Set(
      [...box.querySelectorAll<HTMLElement>('tr[data-row-id]:not([data-active])')].map(
        (row) => getComputedStyle(row).backgroundColor,
      ),
    );
    expect(fills.size).toBe(1);
  });

  it('keeps the place and Back to top at the list’s top corner, off the quick look', async () => {
    const { onLoadMore } = pages();
    directory({ onLoadMore });
    await userEvent.click(screen.getByRole('button', { name: 'Person 0' }));
    const box = screen.getByRole('region', { name: 'People' });
    await vi.waitFor(() => {
      expect(box.scrollHeight).toBeGreaterThan(PAGE * 2 * 50);
    });
    // Nothing until the header pins.
    expect(screen.queryByRole('button', { name: /Back to top$/ })).toBeNull();
    window.scrollTo(0, tableTop(box) + 40 * ROW);
    const back = await screen.findByRole('button', { name: /^\d+ of 1,000\. Back to top$/ });
    const look = screen.getByRole('complementary', { name: 'Quick look' });
    expect(look).not.toContainElement(back);
    const pill = back.getBoundingClientRect();
    const list = box.getBoundingClientRect();
    const card = look.getBoundingClientRect();
    // Inside the list's box, at its top right, and clear of the card.
    expect(pill.left).toBeGreaterThanOrEqual(list.left);
    expect(pill.right).toBeLessThanOrEqual(list.right);
    expect(pill.right).toBeLessThan(card.left);
    // Riding under the table's pinned header, on screen however far down the page is.
    const head = box.querySelector('thead th')?.getBoundingClientRect().bottom ?? 0;
    expect(pill.top).toBeGreaterThanOrEqual(0);
    expect(pill.top - head).toBeLessThan(80);
  });

  it('jumps instead under reduced motion', { timeout: slow ? 60_000 : 15_000 }, async () => {
    const real = window.matchMedia.bind(window);
    // Reduced motion asked for: answered by a query that always matches.
    vi.spyOn(window, 'matchMedia').mockImplementation((query) =>
      real(query.includes('prefers-reduced-motion') ? '(min-width: 0px)' : query),
    );
    const { onLoadMore } = pages();
    directory({ onLoadMore });
    const box = screen.getByRole('region', { name: 'People' });
    await vi.waitFor(() => {
      expect(box.scrollHeight).toBeGreaterThan(PAGE * 2 * 50);
    });
    await userEvent.click(screen.getByRole('button', { name: 'Person 0' }));
    window.scrollTo(0, tableTop(box) + box.scrollHeight);
    await frame();
    const look = screen.getByRole('complementary', { name: 'Quick look' });
    await userEvent.click(within(look).getByRole('button', { name: 'Show in list' }));
    // At once, not over the next few hundred milliseconds.
    expect(window.scrollY).toBeLessThan(tableTop(box) + window.innerHeight);
    await vi.waitFor(
      () => {
        expect(document.querySelector('tr[data-row-id="p0"]')).toHaveFocus();
      },
      { timeout: slow ? 20_000 : 1000 },
    );
    expect(inView('p0')).toBe(true);
  });
});

describe.runIf(!coarse)('the directory’s table, in the window', () => {
  afterEach(async () => {
    window.scrollTo(0, 0);
    await page.viewport(1280, 800);
  });

  // One scroll: the window's. The table has no box of its own, its header
  // pins under the page's, and the quick look rides beside it.
  it.each([
    { width: 1440, height: 900 },
    { width: 1280, height: 720 },
  ])('is scrolled by the window at $width×$height, its header pinned', async (size) => {
    await page.viewport(size.width, size.height);
    const { onLoadMore } = pages();
    directory({ onLoadMore });
    const box = screen.getByRole('region', { name: 'People' });
    await vi.waitFor(() => {
      expect(box.scrollHeight).toBeGreaterThan(PAGE * 2 * 50);
    });
    expect(box.scrollHeight).toBeLessThanOrEqual(box.clientHeight + 1);
    expect(document.documentElement.scrollHeight).toBeGreaterThan(window.innerHeight);
    await userEvent.click(screen.getByRole('button', { name: 'Person 0' }));
    window.scrollTo(0, tableTop(box) + 30 * ROW);
    await frame();
    await frame();
    // The cells pin, not the row group they sit in.
    const head = box.querySelector('thead th')?.getBoundingClientRect() as DOMRect;
    const sticky =
      Number.parseFloat(getComputedStyle(box).getPropertyValue('--reach-sticky-top') || '0') || 0;
    expect(Math.abs(head.top - sticky)).toBeLessThanOrEqual(2);
    const look = screen.getByRole('complementary', { name: 'Quick look' });
    expect(look.getBoundingClientRect().top).toBeGreaterThanOrEqual(head.top);
  });
  // Too wide for its box beside the quick look: the box scrolls it sideways,
  // and the header rides down the box under the page's instead of sticking.
  it('pins a wide table’s header too, while its box scrolls sideways', async () => {
    await page.viewport(900, 720);
    const { onLoadMore } = pages();
    directory({ onLoadMore });
    await userEvent.click(screen.getByRole('button', { name: 'Person 0' }));
    const box = screen.getByRole('region', { name: 'People' });
    await vi.waitFor(() => {
      expect(box.scrollWidth).toBeGreaterThan(box.clientWidth + 1);
      expect(box.scrollHeight).toBeGreaterThan(PAGE * 2 * 50);
    });
    window.scrollTo(0, tableTop(box) + 30 * ROW);
    await frame();
    await frame();
    const head = box.querySelector('thead th')?.getBoundingClientRect() as DOMRect;
    const sticky =
      Number.parseFloat(getComputedStyle(box).getPropertyValue('--reach-sticky-top') || '0') || 0;
    expect(Math.abs(head.top - sticky)).toBeLessThanOrEqual(2);
  });
});

describe.runIf(coarse)('the directory’s list, under a finger', () => {
  it('has no keyboard hint', () => {
    const { onLoadMore } = pages();
    directory({ onLoadMore });
    expect(screen.queryByText('quick look')).toBeNull();
    expect(screen.queryByText(/ move$/)).toBeNull();
  });

  it('opens with nobody selected, nobody opened, and a page ahead', async () => {
    const { asked, onLoadMore } = pages();
    const onOpen = vi.fn();
    directory({ onLoadMore, onOpen });
    expect(document.querySelector('a[data-person-id][aria-current]')).toBeNull();
    expect(onOpen).not.toHaveBeenCalled();
    await vi.waitFor(() => {
      expect(asked).toEqual(['50']);
    });
    // Both pages are the list's, though only the rows near the view are drawn.
    await vi.waitFor(() => {
      expect(document.querySelector('li[aria-posinset="1"]')).toHaveAttribute(
        'aria-setsize',
        String(PAGE * 2),
      );
    });
    expect(rows()).toBeLessThan(PAGE);
  });
});
