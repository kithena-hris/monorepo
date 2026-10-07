import { act, createElement, Suspense, type ReactElement } from 'react';
import { hydrateRoot, type Root } from 'react-dom/client';
import { renderToString } from 'react-dom/server';
import { onTestFinished, vi } from 'vitest';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/**
 * A screen as the shell serves it (`remote-renderer.ts`, `remote-screen.tsx`):
 * HTML from the server inside a Suspense boundary, then hydrated over in the
 * browser with the very same element.
 *
 * Answers the server's HTML, every complaint React made while hydrating (a
 * mismatch is a recoverable error, or a console error in development) and the
 * live host, which stays in the page until the test finishes. An empty
 * `errors` means the first paint is what the browser keeps.
 *
 * The root is unmounted when the test finishes, before the host goes. Left
 * mounted, work React had already scheduled (an effect's state update) could
 * run after the test file's jsdom was torn down, and fail the whole run with
 * "window is not defined" though every test passed.
 */
export async function serveAndHydrate(element: ReactElement): Promise<{
  readonly html: string;
  readonly errors: readonly string[];
  readonly host: HTMLElement;
}> {
  const tree = createElement(Suspense, { fallback: null }, element);
  const html = renderToString(tree);
  const host = document.createElement('div');
  host.innerHTML = html;
  document.body.append(host);
  let root: Root | undefined;
  onTestFinished(() => {
    act(() => {
      root?.unmount();
    });
    host.remove();
  });
  const errors: string[] = [];
  const spy = vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
    errors.push(args.map(String).join(' '));
  });
  try {
    await act(async () => {
      root = hydrateRoot(host, tree, {
        onRecoverableError: (error) => {
          errors.push(error instanceof Error ? error.message : String(error));
        },
      });
      await Promise.resolve();
    });
  } finally {
    spy.mockRestore();
  }
  return { html, errors, host };
}
