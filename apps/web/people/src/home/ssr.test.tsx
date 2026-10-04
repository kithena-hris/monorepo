import { TooltipProvider } from '@reach/ui';
import { act } from '@testing-library/react';
import { createElement, Suspense, type ReactElement } from 'react';
import { hydrateRoot } from 'react-dom/client';
import { renderToString } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { framed } from '../frame';
import { PeopleHome as HomeScreen, type PeopleHomeState } from './people-home';
import { overview } from './people-home.fixture';

/**
 * Home as the shell serves it: whole on the server, then hydrated over that
 * HTML without a mismatch. Its date and time are read from when People
 * answered, in the person's own zone, never from the browser's clock.
 */

const PeopleHome = framed(HomeScreen);

const element = (data: PeopleHomeState): ReactElement =>
  createElement(
    TooltipProvider,
    null,
    createElement(
      Suspense,
      { fallback: null },
      createElement(PeopleHome, { load: { status: 'ready', data } }),
    ),
  );

afterEach(() => {
  document.body.innerHTML = '';
  vi.restoreAllMocks();
});

describe('Home on the server, then in the browser', () => {
  it.each([
    ['an employee', overview({ roles: { hr: false, admin: false, finance: false } })],
    [
      'HR',
      {
        ...overview(),
        hr: {
          headcount: { value: 412, change: 14, trend: [] },
          complete: { percent: 79, incomplete: 88 },
          expiring: 6,
          identifiers: 3,
          duplicates: 2,
          accessRequests: 1,
          joiners: [{ label: 'Sep', value: 14 }],
          starting: [],
        },
      },
    ],
  ] as const)('renders %s’s Home whole, and hydrates it without a mismatch', async (_, data) => {
    const html = renderToString(element(data));
    expect(html).not.toContain('<!--$!-->');
    expect(html).toContain('Hi Ada');
    const container = document.createElement('div');
    container.innerHTML = html;
    document.body.append(container);
    const errors = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const root = await act(async () => {
      const r = hydrateRoot(container, element(data), {
        onRecoverableError: (e) => {
          throw e;
        },
      });
      await Promise.resolve();
      return r;
    });
    expect(errors.mock.calls).toEqual([]);
    act(() => {
      root.unmount();
    });
  });
});
