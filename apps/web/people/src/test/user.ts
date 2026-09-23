import userEvent, { PointerEventsCheckLevel } from '@testing-library/user-event';

/**
 * A user for jsdom tests that does not wait and does not second-guess.
 *
 * `delay: null` drops the macrotask user-event waits between every event;
 * a click is several events and a typed word is several per letter. The
 * pointer-events check walks `getComputedStyle` up the tree for every target,
 * which jsdom does slowly and which none of these tests is about — Reach's
 * enabled controls never set `pointer-events: none`.
 *
 * Neither changes what happens, only how long the waiting takes. On a shared
 * CI runner, where the same test ran 15 to 25 times slower than locally, that
 * waiting was what pushed a test past its timeout.
 */
export function fast(): ReturnType<typeof userEvent.setup> {
  return userEvent.setup({ delay: null, pointerEventsCheck: PointerEventsCheckLevel.Never });
}
