import axe from 'axe-core';

/**
 * Every axe violation in a rendered container, as readable lines.
 *
 * `color-contrast` is off because jsdom computes no styles; contrast is
 * Reach's to prove, per token, in its own sweep. Everything structural —
 * names, roles, labels, landmarks, ARIA validity — runs.
 */
export async function axeViolations(container: Element): Promise<string[]> {
  const result = await axe.run(container, {
    rules: { 'color-contrast': { enabled: false }, region: { enabled: false } },
  });
  return result.violations.map(
    (v) => `${v.id}: ${v.help} (${v.nodes.map((n) => n.target.join(' ')).join(', ')})`,
  );
}
