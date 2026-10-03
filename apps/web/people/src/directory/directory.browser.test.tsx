import { render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { userEvent } from 'vitest/browser';

import { Directory, type DirectoryPerson, type DirectoryState } from './directory';

/**
 * The directory as it scrolls, in Chromium: the phone project (a finger, the
 * list) and the desk project (a mouse, the table and its quick look). What
 * jsdom cannot say: where a row is, how wide a column is laid out, and
 * whether a smooth scroll lands.
 */
const coarse = matchMedia('(pointer: coarse)').matches;
const PAGE = 50;

const person = (i: number): DirectoryPerson => ({
  id: `p${String(i)}`,
  // Some long, so a table laid out on its content would widen as they arrive.
  name: `Person ${String(i)}${i % 7 === 6 ? ' Featherstonehaugh-Cholmondeley' : ''}`,
  email: `person${String(i)}@acme.example`,
  avatarUrl: null,
  values: { job_title: i % 5 === 0 ? 'Principal product designer and researcher' : 'Engineer' },
  missing: 0,
});
const everybody = Array.from({ length: 400 }, (_, i) => person(i));
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

function directory(over: { onLoadMore: (after: string) => Promise<unknown>; onOpen?: () => void }) {
  return render(
    <Directory
      load={{ status: 'ready', data: state }}
      search=""
      onSearchChange={vi.fn()}
      filters={{}}
      onFiltersChange={vi.fn()}
      onOpen={over.onOpen ?? vi.fn()}
      onLoadMore={over.onLoadMore as never}
      next={String(PAGE)}
    />,
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

/** In full view inside the table's box, below its pinned header. */
function inView(id: string): boolean {
  const row = document.querySelector(`tr[data-row-id="${id}"]`);
  const box = screen.getByRole('region', { name: 'People' });
  if (row === null) return false;
  const r = row.getBoundingClientRect();
  const edge = box.getBoundingClientRect();
  const head = box.querySelector('thead')?.getBoundingClientRect().height ?? 0;
  return r.top >= edge.top + head - 1 && r.bottom <= edge.bottom + 1;
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe.runIf(!coarse)('the directory’s table, scrolled with a mouse', () => {
  it('asks for page two at once and the next at the midpoint, each cursor once, columns still', async () => {
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
    box.scrollTop = box.scrollHeight * 0.3;
    await frame();
    expect(asked).toEqual(['50']);
    // Past halfway: the next page, once, however often the scroll fires.
    box.scrollTop = box.scrollHeight * 0.55;
    await frame();
    box.scrollTop += 10;
    await frame();
    await vi.waitFor(() => {
      expect(asked).toEqual(['50', '100']);
    });
    await vi.waitFor(() => {
      expect(box.scrollHeight).toBeGreaterThan(PAGE * 3 * 50);
    });
    expect(widths()).toEqual(before);
  });

  it('opens on the first person, and Show in list brings their row back smoothly and focuses it', async () => {
    const { onLoadMore } = pages();
    const onOpen = vi.fn();
    directory({ onLoadMore, onOpen });
    const look = screen.getByRole('complementary', { name: 'Quick look' });
    expect(within(look).getByRole('heading', { name: 'Person 0' })).toBeVisible();
    expect(onOpen).not.toHaveBeenCalled();
    const box = screen.getByRole('region', { name: 'People' });
    await vi.waitFor(() => {
      expect(box.scrollHeight).toBeGreaterThan(PAGE * 2 * 50);
    });
    box.scrollTop = box.scrollHeight;
    await vi.waitFor(() => {
      expect(inView('p0')).toBe(false);
    });
    await userEvent.click(within(look).getByRole('button', { name: 'Show in list' }));
    await vi.waitFor(
      () => {
        expect(inView('p0')).toBe(true);
        expect(document.querySelector('tr[data-row-id="p0"]')).toHaveFocus();
      },
      { timeout: 3000 },
    );
  });

  it('jumps instead under reduced motion', async () => {
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
    box.scrollTop = box.scrollHeight;
    await frame();
    const look = screen.getByRole('complementary', { name: 'Quick look' });
    await userEvent.click(within(look).getByRole('button', { name: 'Show in list' }));
    // At once, not over the next few hundred milliseconds.
    expect(box.scrollTop).toBeLessThan(box.clientHeight);
    await vi.waitFor(() => {
      expect(document.querySelector('tr[data-row-id="p0"]')).toHaveFocus();
    });
    expect(inView('p0')).toBe(true);
  });
});

describe.runIf(coarse)('the directory’s list, under a finger', () => {
  it('opens with the first person selected, without opening them, and a page ahead', async () => {
    const { asked, onLoadMore } = pages();
    const onOpen = vi.fn();
    directory({ onLoadMore, onOpen });
    expect(document.querySelector('a[data-person-id="p0"]')).toHaveAttribute(
      'aria-current',
      'true',
    );
    expect(document.querySelector('a[data-person-id="p1"]')).not.toHaveAttribute('aria-current');
    expect(onOpen).not.toHaveBeenCalled();
    await vi.waitFor(() => {
      expect(asked).toEqual(['50']);
    });
    await vi.waitFor(() => {
      expect(rows()).toBe(PAGE * 2);
    });
  });
});
