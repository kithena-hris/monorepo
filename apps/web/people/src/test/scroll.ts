import { cdp } from 'vitest/browser';

/**
 * Scrolls the way a person does, from on top of `over`: a finger's swipe
 * where the pointer is coarse, a wheel where it is fine. Through Chromium's
 * own input pipeline, so scroll chaining and `overscroll-behavior` decide
 * where the scroll goes — `window.scrollTo` would skip exactly that.
 */
export async function scrollOver(
  over: Element,
  distance: number,
  /** How far in from `over`'s left edge the hand starts; by default 40px, or the middle. */
  inset?: number,
): Promise<void> {
  const box = over.getBoundingClientRect();
  // A point on the part of `over` that is on screen.
  const x = Math.round(box.left + (inset ?? Math.min(box.width / 2, 40)));
  const y = Math.round((Math.max(box.top, 0) + Math.min(box.bottom, window.innerHeight)) / 2);
  const session = cdp();
  if (matchMedia('(pointer: coarse)').matches) {
    await session.send('Input.synthesizeScrollGesture', {
      x,
      y,
      yDistance: -distance,
      gestureSourceType: 'touch',
      speed: 4000,
    });
  } else {
    await session.send('Input.dispatchMouseEvent', {
      type: 'mouseWheel',
      x,
      y,
      deltaX: 0,
      deltaY: distance,
    });
  }
  await new Promise<void>((resolve) => {
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        resolve();
      });
    });
  });
}

/** Whether `el` is wholly inside the viewport, give or take a subpixel. */
export function onScreen(el: Element): boolean {
  const box = el.getBoundingClientRect();
  return (
    box.width > 0 &&
    box.top >= -0.5 &&
    box.left >= -0.5 &&
    box.bottom <= window.innerHeight + 0.5 &&
    box.right <= window.innerWidth + 0.5
  );
}

/** Scrolls from on top of `over` until `target` is on screen, or gives up. */
export async function scrollUntilOnScreen(
  over: Element,
  target: Element,
  inset?: number,
): Promise<boolean> {
  for (let i = 0; i < 40 && !onScreen(target); i += 1) {
    // One gesture after another, as a hand makes them: never in parallel.
    // oxlint-disable-next-line no-await-in-loop
    await scrollOver(over, 300, inset);
  }
  return onScreen(target);
}
