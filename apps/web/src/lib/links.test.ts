// @vitest-environment jsdom
import { renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

const router = { push: vi.fn(), prefetch: vi.fn() };
vi.mock('next/navigation', () => ({ useRouter: () => router }));

const { inAppHref, pagesToWarm, useInAppLinks } = await import('./links');

// The page's own origin, as the shell passes it.
const ORIGIN = window.location.origin;

/** A click on an anchor built from `html`, as the browser would dispatch it. */
function clickOn(html: string, init: MouseEventInit = {}): MouseEvent {
  document.body.innerHTML = html;
  const target = document.querySelector('[data-target]') ?? document.body;
  const event = new MouseEvent('click', { bubbles: true, cancelable: true, button: 0, ...init });
  Object.defineProperty(event, 'target', { value: target });
  return event;
}

describe('inAppHref', () => {
  it('keeps a plain click on a link to this app inside the page', () => {
    expect(
      inAppHref(
        clickOn('<a href="/people/reports/1"><span data-target>History</span></a>'),
        ORIGIN,
      ),
    ).toBe('/people/reports/1');
    expect(
      inAppHref(clickOn('<a data-target href="/people/directory/list?q=a#x">D</a>'), ORIGIN),
    ).toBe('/people/directory/list?q=a#x');
  });

  it('leaves the browser a new tab, a download, another origin and a handled click', () => {
    const link = '<a data-target href="/people">P</a>';
    expect(inAppHref(clickOn(link, { metaKey: true }), ORIGIN)).toBeNull();
    expect(inAppHref(clickOn(link, { button: 1 }), ORIGIN)).toBeNull();
    expect(inAppHref(clickOn('<a data-target href="/f.csv" download>F</a>'), ORIGIN)).toBeNull();
    expect(inAppHref(clickOn('<a data-target href="/p" target="_blank">P</a>'), ORIGIN)).toBeNull();
    expect(
      inAppHref(clickOn('<a data-target href="https://files.example/x">X</a>'), ORIGIN),
    ).toBeNull();
    expect(inAppHref(clickOn('<span data-target>not a link</span>'), ORIGIN)).toBeNull();
    const handled = clickOn(link);
    handled.preventDefault();
    expect(inAppHref(handled, ORIGIN)).toBeNull();
  });
});

/** The pointer arriving over the element with this id. */
function over(id: string): void {
  document.getElementById(id)?.dispatchEvent(new Event('pointerover', { bubbles: true }));
}

describe('useInAppLinks', () => {
  it('prefetches a plain link whole on hover, only where there is a page', () => {
    renderHook(() => {
      useInAppLinks((path) => path.startsWith('/people/'));
    });
    document.body.innerHTML =
      '<a id="tab" href="/people/insights/turnover">T</a><a id="file" href="/files/1">F</a>';
    over('tab');
    over('tab');
    over('file');
    // Whole: a dynamic page prefetched any less holds nothing a press can draw.
    expect(router.prefetch.mock.calls).toEqual([['/people/insights/turnover', { kind: 'full' }]]);
  });
});

describe('pagesToWarm', () => {
  const people = {
    places: [
      { path: '/people/directory/list', label: 'Directory' },
      {
        path: '/people/review/waiting',
        label: 'Review',
        tabs: [
          { path: '/people/review/waiting', label: 'Waiting' },
          { path: '/people/review/decided', label: 'Decided' },
        ],
      },
      { path: '/people/import-export', label: 'Import & export' },
    ],
    routes: [
      '/people/directory/list',
      '/people/directory/cards',
      '/people/directory/org-chart',
      '/people/review/waiting',
      '/people/review/decided',
      '/people/import-export',
      '/people/:id',
    ],
  };

  it('is the other tabs of the place this page is under, not the other sections', () => {
    expect(pagesToWarm('/people/review/decided', '', [people])).toEqual(['/people/review/waiting']);
    expect(pagesToWarm('/people/import-export', '', [people])).toEqual([]);
  });

  it('is the Directory’s other views, keeping the search and filters but not the page', () => {
    expect(pagesToWarm('/people/directory/list', '?q=ada&after=c1', [people])).toEqual([
      '/people/directory/cards?q=ada',
      '/people/directory/org-chart?q=ada',
    ]);
  });

  it('is nothing on a page no area claims', () => {
    expect(pagesToWarm('/settings', '', [people])).toEqual([]);
  });
});
