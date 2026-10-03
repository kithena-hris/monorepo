import type { Writer } from './ports.js';

/**
 * Lines of text for a screen: the model's when a `Writer` is configured and
 * its answer holds up, the template otherwise. Either way the screen gets a
 * sentence, and `ai` says which, so the AI tag is shown only on text a model
 * actually wrote (PRD §14.1).
 *
 * A model's line is refused, and the template used in its place, when it is
 * empty, longer than a line, leaves a placeholder unfilled, or carries a
 * number that is not among the facts it was given: the domain computes every
 * number, and a model that invents one has written something else.
 */

export interface Written {
  readonly text: string;
  readonly ai: boolean;
}

export interface Line {
  /** What the line should say, for the model. Never sent with the template. */
  readonly about: string;
  /** The line without a model: the same facts, in a fixed sentence. */
  readonly template: string;
}

export const templated = (text: string): Written => ({ text, ai: false });

const MAX = 320;
const PLACEHOLDER = /\{([a-z][a-z0-9]{0,11})\}/gu;
const NUMBER = /\d+(?:[.,:]\d+)*/gu;

/** The model's line made ready to show, or null when it does not hold up. */
export function accept(
  value: unknown,
  facts: Readonly<Record<string, unknown>>,
  fill: Readonly<Record<string, string>>,
): string | null {
  if (typeof value !== 'string') return null;
  const line = value.trim();
  if (line.length === 0 || line.length > MAX || /[\r\n]/u.test(line)) return null;
  const known = JSON.stringify(facts);
  const bare = line.replaceAll(PLACEHOLDER, '');
  if (bare.includes('{') || bare.includes('}')) return null;
  for (const [n] of bare.matchAll(NUMBER)) {
    if (!n.split(/[.,:]/u).every((part) => known.includes(part))) return null;
  }
  for (const [, key] of line.matchAll(PLACEHOLDER)) if (fill[key ?? ''] === undefined) return null;
  return line.replaceAll(PLACEHOLDER, (_, key: string) => fill[key] ?? '');
}

export async function written<K extends string>(
  writer: Writer | undefined,
  tenantId: string,
  ask: { readonly instruction: string; readonly facts: Readonly<Record<string, unknown>> },
  lines: Readonly<Record<K, Line>>,
  fill: Readonly<Record<string, string>> = {},
): Promise<Record<K, Written>> {
  const keys = Object.keys(lines) as K[];
  const plain = Object.fromEntries(keys.map((k) => [k, templated(lines[k].template)])) as Record<
    K,
    Written
  >;
  if (writer === undefined || keys.length === 0) return plain;
  const answer = await writer.write(tenantId, {
    instruction:
      `${ask.instruction} Write in plain, warm British English, one short sentence per line, ` +
      'using only the facts given. Copy figures and dates exactly as the facts spell them. ' +
      (Object.keys(fill).length === 0
        ? ''
        : `Refer to people only by these placeholders, braces included: ${Object.keys(fill)
            .map((k) => `{${k}}`)
            .join(', ')}. `) +
      'Answer with one JSON object whose keys are the line keys and whose values are the lines.',
    facts: ask.facts,
    lines: Object.fromEntries(keys.map((k) => [k, lines[k].about])),
  });
  if (answer === null) return plain;
  return Object.fromEntries(
    keys.map((k) => {
      const text = accept(answer[k], ask.facts, fill);
      return [k, text === null ? plain[k] : { text, ai: true }];
    }),
  ) as Record<K, Written>;
}
