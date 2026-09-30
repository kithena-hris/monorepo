// @vitest-environment jsdom
import { renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

const router = { push: vi.fn(), prefetch: vi.fn() };
vi.mock('next/navigation', () => ({ useRouter: () => router }));

const { inAppHref, useInAppLinks } = await import('./links');

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

describe('useInAppLinks', () => {
  it('prefetches a plain link on hover, only where there is a page', () => {
    renderHook(() => {
      useInAppLinks((path) => path.startsWith('/people/'));
    });
    document.body.innerHTML =
      '<a id="tab" href="/people/insights/turnover">T</a><a id="file" href="/files/1">F</a>';
    const over = (id: string): void => {
      document.getElementById(id)?.dispatchEvent(new Event('pointerover', { bubbles: true }));
    };
    over('tab');
    over('tab');
    over('file');
    expect(router.prefetch.mock.calls).toEqual([['/people/insights/turnover']]);
  });
});
