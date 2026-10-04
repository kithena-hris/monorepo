import { act, createElement, Suspense, type ReactElement } from 'react';
import { hydrateRoot } from 'react-dom/client';
import { renderToString } from 'react-dom/server';
import { vi } from 'vitest';

/**
 * A screen as the shell serves it (`remote-renderer.ts`, `remote-screen.tsx`):
 * HTML from the server, then hydrated over in the browser with the same
 * props. Answers the server's HTML and every console error the hydration
 * raised, so a test can say the page arrived whole and nothing changed.
 */
export async function serveAndHydrate(
  element: ReactElement,
): Promise<{
  readonly html: string;
  readonly errors: readonly string[];
  readonly host: HTMLElement;
}> {
  const tree = createElement(Suspense, { fallback: null }, element);
  const html = renderToString(tree);
  const host = document.createElement('div');
  host.innerHTML = html;
  document.body.append(host);
  const errors: string[] = [];
  const spy = vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
    errors.push(args.map(String).join(' '));
  });
  const recoverable: string[] = [];
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  await act(async () => {
    hydrateRoot(host, tree, {
      onRecoverableError: (error) => {
        recoverable.push(String(error));
      },
    });
    await Promise.resolve();
  });
  spy.mockRestore();
  return { html, errors: [...errors, ...recoverable], host };
}
