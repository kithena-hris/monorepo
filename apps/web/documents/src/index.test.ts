import { describe, expect, it } from 'vitest';

import * as browser from './index.browser';
import * as server from './index';

describe('the two entries', () => {
  it('export the same screens, so a route the server draws the browser can hydrate', () => {
    expect(Object.keys(browser).toSorted()).toEqual(Object.keys(server).toSorted());
  });

  it('load each screen the browser splits off, and load it once', async () => {
    for (const screen of Object.values(browser)) {
      if (!('preload' in screen)) continue;
      const first = screen.preload();
      expect(screen.preload()).toBe(first);
      await first;
    }
  });
});
