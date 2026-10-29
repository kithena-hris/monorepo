/**
 * What a page-scrolled table does as it is scrolled, fetched with its first
 * mount (`DataTable`): a page that draws no table does not load it.
 */

/** How long the wheel rests before a gesture's axis is let go: a trackpad's flick coasts on a tick every frame. */
const WHEEL_REST_MS = 150;

/**
 * One axis at a time. A swipe on a trackpad is never quite straight, and a
 * table wider than its box (down with the window or its box, sideways with
 * the box) slid both ways at once under it. A gesture keeps the axis its
 * first movement chose until the wheel rests; the other waits for the next.
 */
export function lockAxis(el: HTMLElement, page: boolean): () => void {
  let axis: 'x' | 'y' | null = null;
  let rest: ReturnType<typeof setTimeout> | undefined;
  const onWheel = (event: WheelEvent): void => {
    // A pinch, or a box with nothing to its side.
    if (event.ctrlKey || el.scrollWidth <= el.clientWidth + 1) return;
    // Lines (a mouse in Firefox) and pages, in pixels.
    const unit = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? window.innerHeight : 1;
    const dx = event.deltaX * unit;
    const dy = event.deltaY * unit;
    clearTimeout(rest);
    rest = setTimeout(() => {
      axis = null;
    }, WHEEL_REST_MS);
    axis ??= Math.abs(dx) > Math.abs(dy) ? 'x' : 'y';
    // Already along its axis alone: the browser scrolls it, smoothed as ever.
    if ((axis === 'x' ? dy : dx) === 0 || !event.cancelable) return;
    event.preventDefault();
    if (axis === 'x') el.scrollLeft += dx;
    else if (page) window.scrollBy(0, dy);
    else el.scrollTop += dy;
  };
  el.addEventListener('wheel', onWheel, { passive: false });
  return () => {
    el.removeEventListener('wheel', onWheel);
    clearTimeout(rest);
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
