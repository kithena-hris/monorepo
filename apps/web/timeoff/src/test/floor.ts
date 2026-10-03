/** WCAG 2.5.8 and the iOS HIG: nothing a finger has to hit is smaller. */
export const FLOOR = 44;

/**
 * Targets under the floor, by name and size, in a real browser. A `::before`
 * hit area counts, as Reach draws one; what is hidden from everyone
 * (`aria-hidden`, a modal's inert page) is not a target.
 */
export function underFloor(root: Element): string[] {
  return [...root.querySelectorAll<HTMLElement>('button, a[href]')].flatMap((el) => {
    if (el.closest('[aria-hidden="true"]') !== null) return [];
    // A control inside a label is hit through the label: a radio card's
    // radio is visually hidden and the whole card is the target.
    const target = el.closest('label') ?? el;
    const box = target.getBoundingClientRect();
    if (box.width === 0 || box.height === 0) return [];
    const hit = getComputedStyle(target, '::before');
    const width = Math.max(box.width, Number.parseFloat(hit.width) || 0);
    const height = Math.max(box.height, Number.parseFloat(hit.height) || 0);
    if (width >= FLOOR - 0.5 && height >= FLOOR - 0.5) return [];
    const name = el.getAttribute('aria-label') ?? el.textContent.trim().slice(0, 40);
    return [
      `${el.tagName.toLowerCase()} "${name}" ${String(Math.round(width))}×${String(Math.round(height))}`,
    ];
  });
}
