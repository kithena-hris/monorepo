// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';

const { inAppHref } = await import('./remote-screen');

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
      inAppHref(clickOn('<a data-target href="/people/directory?search=a#x">D</a>'), ORIGIN),
    ).toBe('/people/directory?search=a#x');
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
