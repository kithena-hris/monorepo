/**
 * What a page-scrolled table does as it is scrolled, fetched with its first
 * mount (`DataTable`): a page that draws no table does not load it.
 */

/** How long the wheel rests before a gesture is over: a trackpad's flick coasts on a tick every frame. */
const WHEEL_REST_MS = 150;

/**
 * One axis at a time, without taking the scroll from the browser. A sideways
 * swipe is never quite level, and the window slid down under a table being
 * read across. A gesture that starts sideways stops the box handing its
 * vertical part to the window (`overscroll-behavior-y`) until the wheel rests.
 *
 * Passive, and nothing scrolled from script: the last version cancelled each
 * wheel event and moved the box itself, which held every frame of a scroll
 * on the main thread, behind the rows being drawn, and the table lagged and
 * jumped under the finger.
 */
export function lockAxis(el: HTMLElement): () => void {
  let rest: ReturnType<typeof setTimeout> | undefined;
  let moving = false;
  const release = (): void => {
    moving = false;
    el.style.overscrollBehaviorY = '';
  };
  const onWheel = (event: WheelEvent): void => {
    // A pinch, or a box with nothing to its side.
    if (event.ctrlKey || el.scrollWidth <= el.clientWidth + 1) return;
    clearTimeout(rest);
    rest = setTimeout(release, WHEEL_REST_MS);
    if (moving) return;
    moving = true;
    if (Math.abs(event.deltaX) > Math.abs(event.deltaY)) el.style.overscrollBehaviorY = 'none';
  };
  el.addEventListener('wheel', onWheel, { passive: true });
  return () => {
    el.removeEventListener('wheel', onWheel);
    clearTimeout(rest);
    release();
  };
}

/**
 * A wide table's header ridden down its box from script, where a browser has
 * no scroll timelines for `table-pin-head`; nothing to do where it has them.
 */
export function pinHead(el: HTMLElement, head: HTMLElement): () => void {
  if (typeof window.CSS === 'undefined' || window.CSS.supports('animation-timeline: view()')) {
    return () => undefined;
  }
  const pin = (): void => {
    const top = Number.parseFloat(getComputedStyle(el).getPropertyValue('--reach-sticky-top')) || 0;
    const box = el.getBoundingClientRect();
    const by = window.matchMedia('(pointer: fine)').matches
      ? Math.min(Math.max(top - box.top, 0), box.height - head.offsetHeight)
      : 0;
    head.style.transform = by > 0 ? `translateY(${String(by)}px)` : '';
  };
  pin();
  window.addEventListener('scroll', pin, { passive: true });
  window.addEventListener('resize', pin);
  return () => {
    window.removeEventListener('scroll', pin);
    window.removeEventListener('resize', pin);
    head.style.transform = '';
  };
}
