import { afterEach } from 'vitest';

/**
 * Every story, under a finger, measured against the tap floor (PRD §17.3,
 * WCAG 2.2 2.5.8 at the iOS HIG's 44px rather than its 24px minimum).
 *
 * Runs after each story in the `storybook-phone` project, where the pointer is
 * coarse and Reach has already re-pointed its control sizes. A target counts
 * the surface a finger actually hits: a field's whole shell, the label a card
 * wraps its radio in, or a `::before` hit area (`tap-target`).
 *
 * The exceptions are WCAG's, and only those: a link inside a sentence, which
 * a line of text sizes; a target that is disabled, so nothing to hit; and one
 * nobody can see or reach — hidden, `aria-hidden`, or visually hidden for a
 * screen reader.
 */
const FLOOR = 44;

const TARGETS = [
  'button',
  'a[href]',
  'input:not([type="hidden"])',
  'select',
  'textarea',
  '[role="button"]',
  '[role="link"]',
  '[role="switch"]',
  '[role="checkbox"]',
  '[role="radio"]',
  '[role="combobox"]',
  '[role="tab"]',
  '[role="slider"]',
  '[role="option"]',
  '[role="menuitem"]',
].join(', ');

/**
 * The field a text input sits in: the nearest ancestor, a few levels up at
 * most, that draws a border. Reach draws a field's border on a wrapper and the
 * input fills it, so that box is what a finger aims at.
 */
function fieldOf(el: HTMLElement): HTMLElement | null {
  let node = el.parentElement;
  for (let depth = 0; node !== null && depth < 3; depth += 1) {
    if (Number.parseFloat(getComputedStyle(node).borderTopWidth) > 0) return node;
    node = node.parentElement;
  }
  return null;
}

/** A pseudo-element hit area: `tap-target`'s `::before`, or an `::after` grown the same way. */
function grown(el: HTMLElement, pseudo: '::before' | '::after'): { width: number; height: number } {
  const style = getComputedStyle(el, pseudo);
  if (style.content === 'none' || style.position !== 'absolute') return { width: 0, height: 0 };
  return {
    width: Number.parseFloat(style.width) || 0,
    height: Number.parseFloat(style.height) || 0,
  };
}

function hitArea(el: HTMLElement): { width: number; height: number } {
  const text =
    (el instanceof HTMLInputElement && el.type !== 'checkbox' && el.type !== 'radio') ||
    el instanceof HTMLTextAreaElement;
  const surface = (text ? fieldOf(el) : el.closest('label')) ?? el;
  const own = el.getBoundingClientRect();
  const drawn = surface.getBoundingClientRect();
  const before = grown(el, '::before');
  const after = grown(el, '::after');
  return {
    width: Math.max(own.width, drawn.width, before.width, after.width),
    height: Math.max(own.height, drawn.height, before.height, after.height),
  };
}

function exempt(el: HTMLElement): boolean {
  if (el.closest('[aria-hidden="true"], [inert], [hidden]') !== null) return true;
  if (el.matches(':disabled, [aria-disabled="true"]')) return true;
  const box = el.getBoundingClientRect();
  if (box.width <= 1 || box.height <= 1) return true;
  const style = getComputedStyle(el);
  if (style.visibility === 'hidden' || style.display === 'none') return true;
  // Inline: a link within a run of text is sized by that text.
  if (el.tagName === 'A' && style.display === 'inline' && el.closest('p, li, td, dd') !== null) {
    return true;
  }
  return false;
}

export function underTapFloor(root: ParentNode = document.body): string[] {
  return [...root.querySelectorAll<HTMLElement>(TARGETS)].flatMap((el) => {
    if (exempt(el)) return [];
    const { width, height } = hitArea(el);
    if (width >= FLOOR - 0.5 && height >= FLOOR - 0.5) return [];
    const name =
      el.getAttribute('aria-label') ?? el.textContent.trim().replaceAll(/\s+/g, ' ').slice(0, 40);
    return [
      `${el.tagName.toLowerCase()} "${name}" ${String(Math.round(width))}×${String(Math.round(height))}`,
    ];
  });
}

/**
 * Measured at rest. A box mid-way through a scale-in reports the scaled size,
 * so every finite animation on the page is allowed to finish first; a spinner
 * runs forever and is not waited for.
 */
async function settled(): Promise<void> {
  await Promise.all(
    document
      .getAnimations()
      .filter((a) => a.effect?.getComputedTiming().endTime !== Number.POSITIVE_INFINITY)
      .map((a) => a.finished.catch(() => undefined)),
  );
}

afterEach(async () => {
  await settled();
  const small = underTapFloor();
  if (small.length > 0) {
    throw new Error(`Under the ${String(FLOOR)}px tap floor:\n  ${small.join('\n  ')}`);
  }
});
