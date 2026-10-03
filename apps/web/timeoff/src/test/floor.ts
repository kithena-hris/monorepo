/** WCAG 2.5.8 and the iOS HIG: nothing a finger has to hit is smaller. */
export const FLOOR = 44;

/**
 * Targets under the floor, by name and size, for the phone suites in
 * Chromium. A `::before` hit area counts, as Reach draws one.
 */
export function underFloor(root: Element): string[] {
  return [...root.querySelectorAll<HTMLElement>('button, a[href]')].flatMap((el) => {
    if (el.closest('[aria-hidden="true"]') !== null) return [];
    const box = el.getBoundingClientRect();
    if (box.width === 0 || box.height === 0) return [];
    const hit = getComputedStyle(el, '::before');
    const width = Math.max(box.width, Number.parseFloat(hit.width) || 0);
    const height = Math.max(box.height, Number.parseFloat(hit.height) || 0);
    if (width >= FLOOR - 0.5 && height >= FLOOR - 0.5) return [];
    const name = el.getAttribute('aria-label') ?? el.textContent.trim().slice(0, 40);
    return [
      `${el.tagName.toLowerCase()} "${name}" ${String(Math.round(width))}×${String(Math.round(height))}`,
    ];
  });
}
