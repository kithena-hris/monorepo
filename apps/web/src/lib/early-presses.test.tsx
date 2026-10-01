// @vitest-environment jsdom
import { Suspense, use, useEffect, useState, type JSX } from 'react';
import { act } from 'react';
import { hydrateRoot } from 'react-dom/client';
import { renderToString } from 'react-dom/server';
import { runInThisContext } from 'node:vm';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { EARLY_PRESSES_SCRIPT, WAITING, releaseEarlyPresses } from './early-presses';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

beforeAll(() => {
  // As the page runs it: the inline script's own text, not the function.
  runInThisContext(EARLY_PRESSES_SCRIPT);
});

afterEach(() => {
  document.body.innerHTML = '';
});

/** A remote's container as the server sends it: its HTML, waiting for its code. */
function serverScreen(html: string): HTMLElement {
  const container = document.createElement('div');
  container.setAttribute('data-remote', 'people');
  container.setAttribute(WAITING, '');
  container.innerHTML = html;
  document.body.append(container);
  return container;
}

/** The one element `selector` finds. */
function one(root: ParentNode, selector: string, index = 0): HTMLElement {
  const found = [...root.querySelectorAll<HTMLElement>(selector)][index];
  if (found === undefined) throw new Error(`no ${selector}`);
  return found;
}

/** Let the replay's timer run. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('a press before the remote hydrates', () => {
  it('is held, shown, and replayed once on the same element as a whole press', async () => {
    const container = serverScreen(
      '<section><button type="button">Show the numbers</button></section>',
    );
    const button = one(container, 'button');
    const seen: string[] = [];
    for (const type of ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click']) {
      button.addEventListener(type, () => {
        seen.push(type);
      });
    }

    const first = new MouseEvent('click', { bubbles: true, cancelable: true, detail: 1 });
    button.dispatchEvent(first);
    // A second press while the first waits: replaying both would act twice.
    button.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    expect(first.defaultPrevented).toBe(true);
    expect(seen).toEqual([]);
    expect(button.hasAttribute('data-early-press')).toBe(true);
    expect(button.getAttribute('aria-busy')).toBe('true');

    releaseEarlyPresses(container);
    await settle();
    expect(seen).toEqual(['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click']);
    expect(button.hasAttribute('data-early-press')).toBe(false);
    expect(button.hasAttribute('aria-busy')).toBe(false);
    expect(container.hasAttribute(WAITING)).toBe(false);

    // Hydrated: nothing is held any more, and releasing again replays nothing.
    const later = new MouseEvent('click', { bubbles: true, cancelable: true });
    button.dispatchEvent(later);
    releaseEarlyPresses(container);
    await settle();
    expect(later.defaultPrevented).toBe(false);
    expect(seen.filter((s) => s === 'click')).toHaveLength(2);
  });

  it('skips the mouse events when pointerdown is cancelled, as a browser does', async () => {
    const container = serverScreen('<button type="button" aria-haspopup="menu">More</button>');
    const button = one(container, 'button');
    const seen: string[] = [];
    button.click();
    button.addEventListener('pointerdown', (e) => {
      seen.push('pointerdown');
      e.preventDefault();
    });
    button.addEventListener('mousedown', () => {
      seen.push('mousedown');
    });
    button.addEventListener('click', () => {
      seen.push('click');
    });
    releaseEarlyPresses(container);
    await settle();
    expect(seen).toEqual(['pointerdown', 'click']);
  });

  it('leaves a link opened in a new tab to the browser, and holds a plain one', () => {
    const container = serverScreen('<a href="/people/directory">Directory</a>');
    const link = one(container, 'a');
    // What reached the link; then cancelled, since jsdom cannot open a tab.
    let reached: boolean | undefined;
    link.addEventListener('click', (e) => {
      reached ??= !e.defaultPrevented;
      e.preventDefault();
    });
    link.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, metaKey: true }));
    expect(reached).toBe(true);
    const plain = new MouseEvent('click', { bubbles: true, cancelable: true });
    link.dispatchEvent(plain);
    expect(plain.defaultPrevented).toBe(true);
  });

  it('leaves a press outside a waiting container, or on no control, alone', () => {
    const shell = document.createElement('button');
    document.body.append(shell);
    const outside = new MouseEvent('click', { bubbles: true, cancelable: true });
    shell.dispatchEvent(outside);
    expect(outside.defaultPrevented).toBe(false);

    const container = serverScreen('<p>Text</p>');
    const text = new MouseEvent('click', { bubbles: true, cancelable: true });
    one(container, 'p').dispatchEvent(text);
    expect(text.defaultPrevented).toBe(false);
  });

  it('replays at the same place when hydration rebuilt the tree, and puts the focus back', async () => {
    const html = '<div><button type="button">A</button><button type="button">B</button></div>';
    const container = serverScreen(html);
    const pressed = one(container, 'button', 1);
    pressed.focus();
    pressed.click();
    container.innerHTML = html;
    const rebuilt = one(container, 'button', 1);
    const clicked = vi.fn();
    rebuilt.addEventListener('click', clicked);
    releaseEarlyPresses(container);
    await settle();
    expect(clicked).toHaveBeenCalledTimes(1);
    expect(document.activeElement).toBe(rebuilt);
  });

  it('holds a form submitted from its only field, and submits it once', async () => {
    const container = serverScreen('<form><input name="q" /></form>');
    const form = one(container, 'form');
    const submitted = vi.fn((e: Event) => {
      e.preventDefault();
    });
    const early = new Event('submit', { bubbles: true, cancelable: true });
    form.dispatchEvent(early);
    expect(early.defaultPrevented).toBe(true);
    form.addEventListener('submit', submitted);
    releaseEarlyPresses(container);
    await settle();
    expect(submitted).toHaveBeenCalledTimes(1);
  });

  it('lets the press go when the remote never arrives', async () => {
    const container = serverScreen('<button type="button">Save</button>');
    const button = one(container, 'button');
    button.click();
    const clicked = vi.fn();
    button.addEventListener('click', clicked);
    releaseEarlyPresses(container, false);
    await settle();
    expect(clicked).not.toHaveBeenCalled();
    expect(button.hasAttribute('data-early-press')).toBe(false);
  });
});

function Section({ onSave }: { readonly onSave: (name: string) => void }): JSX.Element {
  const [name, setName] = useState('Priya');
  return (
    <form
      aria-label="Personal information"
      onSubmit={(e) => {
        e.preventDefault();
        onSave(name);
      }}
    >
      <input
        aria-label="Preferred name"
        value={name}
        onChange={(e) => {
          setName(e.target.value);
        }}
      />
      <button type="submit">Save</button>
    </form>
  );
}

/** The island's tree: the screen behind its code, released when it commits. */
function Island({
  code,
  container,
  onSave,
}: {
  readonly code: Promise<unknown>;
  readonly container: Element;
  readonly onSave: (name: string) => void;
}): JSX.Element {
  use(code);
  useEffect(() => {
    releaseEarlyPresses(container);
  }, [container]);
  return <Section onSave={onSave} />;
}

describe('with React hydrating the screen', () => {
  it('saves what was typed, once, from a Save pressed while the code was loading', async () => {
    const onSave = vi.fn();
    const container = serverScreen(
      renderToString(
        <Suspense fallback={null}>
          <Section onSave={onSave} />
        </Suspense>,
      ),
    );
    let arrive: ((value: unknown) => void) | undefined;
    const code = new Promise((resolve) => {
      arrive = resolve;
    });
    // The root exists and listens; the boundary waits on the code.
    act(() => {
      hydrateRoot(
        container,
        <Suspense fallback={null}>
          <Island code={code} container={container} onSave={onSave} />
        </Suspense>,
      );
    });

    // Typed, then Save: both before the screen can answer.
    const input = one(container, 'input') as HTMLInputElement;
    input.value = 'Pri';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    one(container, 'button').click();
    expect(onSave).not.toHaveBeenCalled();

    await act(async () => {
      arrive?.(undefined);
      await code;
    });
    await act(settle);
    expect(onSave).toHaveBeenCalledTimes(1);
    expect(onSave).toHaveBeenCalledWith('Pri');
    expect(input.value).toBe('Pri');
  });
});
