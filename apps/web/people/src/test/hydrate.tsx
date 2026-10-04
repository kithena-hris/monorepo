import { act, createElement, Suspense, type ReactElement } from 'react';
import { hydrateRoot } from 'react-dom/client';
import { renderToString } from 'react-dom/server';
import { vi } from 'vitest';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/**
 * A screen as the shell serves it and then takes it over: rendered to HTML
 * inside a Suspense boundary (`remote-renderer.ts`), put in the page, and
 * hydrated over it with the very same element (`remote-screen.tsx`).
 *
 * Returns the server's HTML and every complaint React made while hydrating:
 * a mismatch is a recoverable error, or a console error in development. An
 * empty list means the first paint is what the browser keeps.
 */
export async function hydrated(
  element: ReactElement,
): Promise<{ readonly html: string; readonly problems: readonly string[] }> {
  const wrapped = createElement(Suspense, { fallback: null }, element);
  const html = renderToString(wrapped);
  const container = document.createElement('div');
  container.innerHTML = html;
  document.body.append(container);
  const problems: string[] = [];
  const spy = vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
    problems.push(args.map(String).join(' '));
  });
  try {
    await act(async () => {
      hydrateRoot(container, wrapped, {
        onRecoverableError: (error) => {
          problems.push(error instanceof Error ? error.message : String(error));
        },
      });
      await Promise.resolve();
    });
  } finally {
    spy.mockRestore();
    container.remove();
  }
  return { html, problems };
}
