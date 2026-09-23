import '@testing-library/jest-dom/vitest';

import { cleanup } from '@testing-library/react';
import axe from 'axe-core';
import { afterEach, beforeAll } from 'vitest';

afterEach(() => {
  cleanup();
});

/*
 * What jsdom does not implement and Reach's primitives reach for. Stubs, not
 * behaviour: nothing here is under test, it only lets a component mount.
 * `matches: false` is a fine pointer, which is the desk layout.
 */
Object.assign(globalThis, {
  ResizeObserver: class {
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
  },
});
Object.assign(window, {
  matchMedia: (query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
    addListener: () => undefined,
    removeListener: () => undefined,
    dispatchEvent: () => false,
  }),
});
Object.assign(Element.prototype, {
  scrollIntoView: () => undefined,
  hasPointerCapture: () => false,
  releasePointerCapture: () => undefined,
});

/*
 * axe builds its rule caches on its first call, and that first call cost more
 * than a whole later test. Paid here, once per file, where it is setup rather
 * than the first test's time.
 */
beforeAll(async () => {
  await axe.run(document.body, { rules: { region: { enabled: false } } });
});
