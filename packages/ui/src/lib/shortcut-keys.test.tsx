// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, hydrateRoot } from 'react-dom/client';
import { renderToString } from 'react-dom/server';
import { afterEach, expect, it, vi } from 'vitest';

import {
  LIST_KEYS,
  keysOf,
  setShortcutKeys,
  useScreenCommand,
  useScreenCommands,
  useShortcutKeys,
} from './shortcut-keys';

function Hint(): string {
  const keys = useShortcutKeys();
  const commands = useScreenCommands();
  return `${keysOf('page.search', keys).join('+')}|${String(commands.length)}`;
}

/** A screen elsewhere on the page offering a command. */
function Offer(): null {
  useScreenCommand({ id: 'create', label: 'New', run: () => undefined });
  return null;
}

afterEach(() => {
  setShortcutKeys({ keys: LIST_KEYS, characterKeys: true });
});

it('hydrates with what the server drew, though the app set its keys first', async () => {
  // The server draws before any app has set a key or registered a command.
  const html = renderToString(<Hint />);
  expect(html).toBe('|0');

  // A root whose code came late: the app has run by the time it hydrates.
  setShortcutKeys({ keys: { 'page.search': ['/'] }, characterKeys: true });
  const offering = createRoot(document.createElement('div'));
  await act(async () => {
    offering.render(<Offer />);
    await Promise.resolve();
  });
  const container = document.createElement('div');
  container.innerHTML = html;
  const mismatch = vi.fn();
  await act(async () => {
    hydrateRoot(container, <Hint />, { onRecoverableError: mismatch });
    await Promise.resolve();
  });

  expect(mismatch).not.toHaveBeenCalled();
  // And the app's keys straight after.
  expect(container.textContent).toBe('/|1');
  act(() => {
    offering.unmount();
  });
});
