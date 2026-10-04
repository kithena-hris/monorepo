import { TooltipProvider } from '@reach/ui';
import { createElement, type ReactElement } from 'react';
import { describe, expect, it } from 'vitest';

import { framed } from '../frame';
import { serveAndHydrate } from '../test/hydrate';
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
    createElement(PeopleHome, { load: { status: 'ready', data } }),
  );

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
    const { html, errors } = await serveAndHydrate(element(data));
    expect(html).not.toContain('<!--$!-->');
    expect(html).toContain('Hi Ada');
    expect(errors).toEqual([]);
  });
});
