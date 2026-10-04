// @vitest-environment jsdom
import { createElement } from 'react';
import { describe, expect, it } from 'vitest';

import { framed } from '../frame';
import { serveAndHydrate } from '../test/hydrate';
import { WhatChanged as WhatChangedScreen } from './what-changed';
import { SEPTEMBER } from './what-changed.fixture';

/**
 * What changed, served and then taken over: a follow-up in the address is
 * answered in the server's HTML, and hydrating it asks nothing again and
 * changes nothing.
 */
const WhatChanged = framed(WhatChangedScreen);

describe('What changed, hydrated', () => {
  it('serves the follow-up the address asks, answered, and hydrates it unchanged', async () => {
    let asked = 0;
    const { html, errors } = await serveAndHydrate(
      createElement(WhatChanged, {
        load: {
          status: 'ready',
          data: {
            ...SEPTEMBER,
            answered: {
              question: 'what grew the headcount?',
              result: {
                kind: 'answer',
                sentences: [[{ text: 'Engineering hired nine people.', strong: false }]],
                keys: ['headcount'],
                byModel: false,
              },
            },
          },
        },
        question: 'what grew the headcount?',
        onQuestionChange: () => undefined,
        onAsk: () => {
          asked += 1;
          return Promise.resolve({ ok: false as const, message: 'not again' });
        },
      }),
    );
    expect(html).toContain('Engineering hired nine people.');
    expect(asked).toBe(0);
    expect(errors).toEqual([]);
  });
});
