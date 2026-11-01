/**
 * WCAG 2.5.8 and the iOS HIG: nothing a finger has to hit is smaller than
 * 44px. People's phone suite's measure (`apps/web/people/src/test`), which
 * counts every kind of control and what a finger actually hits.
 */
export const FLOOR = 44;

const TARGETS =
  'button, a[href], input:not([type="hidden"]), select, textarea, [role="switch"], [role="checkbox"], [role="radio"], [role="combobox"], [role="tab"]';

/** Targets under the floor, by name and size. A `::before` hit area counts, as Reach draws one. */
export function underFloor(root: Element): string[] {
  return [...root.querySelectorAll<HTMLElement>(TARGETS)].flatMap((el) => {
    if (el.closest('[aria-hidden="true"]') !== null) return [];
    // What a finger actually hits: a field's whole shell (the input fills it),
    // or the card-sized label a `RadioCard` wraps its radio in.
    const surface =
      el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement
        ? (el.parentElement ?? el)
        : (el.closest('label') ?? el);
    const box = surface.getBoundingClientRect();
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

/**
 * What reaches past the screen's edge, innermost last: the message a width
 * check fails with, so a page too wide on one machine names its culprit.
 */
export function pastEdge(root: Element, width: number): string {
  return [...root.querySelectorAll<HTMLElement>('*')]
    .filter((el) => el.getBoundingClientRect().right > width + 0.5)
    .slice(-6)
    .map(
      (el) =>
        `${el.tagName.toLowerCase()}[${String(Math.round(el.getBoundingClientRect().right))}] ${String(el.getAttribute('class') ?? '').slice(0, 120)} "${(el.textContent ?? '').slice(0, 40)}"`,
    )
    .join('\n');
}
