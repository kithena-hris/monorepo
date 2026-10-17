import { Decimal } from 'decimal.js';

/**
 * Sentence sentiment (PRD §13.6, PRF-135): a model labels each sentence from
 * very negative (-2) to very positive (2); the position on the slider is
 * computed here, the labels' mean weighted by each sentence's length, so the
 * number is reproducible and points back to its sentences.
 */

export interface Labelled {
  readonly sentence: string;
  readonly label: -2 | -1 | 0 | 1 | 2;
}

/** 0 is "needs support", 50 mixed, 100 strong; null with nothing to weigh. */
export function position(labels: readonly Labelled[]): number | null {
  let sum = new Decimal(0);
  let total = new Decimal(0);
  for (const l of labels) {
    const w = new Decimal(Math.max(1, l.sentence.trim().length));
    sum = sum.plus(w.times(l.label));
    total = total.plus(w);
  }
  if (total.isZero()) return null;
  // -2..2 onto 0..100.
  return sum
    .dividedBy(total)
    .plus(2)
    .times(25)
    .toDecimalPlaces(0, Decimal.ROUND_HALF_UP)
    .toNumber();
}

export function counts(labels: readonly Labelled[]): {
  positive: number;
  negative: number;
  neutral: number;
} {
  return {
    positive: labels.filter((l) => l.label > 0).length,
    negative: labels.filter((l) => l.label < 0).length,
    neutral: labels.filter((l) => l.label === 0).length,
  };
}

/** Sentences of a text, as the model is asked to label them. */
export function sentences(text: string): string[] {
  return text
    .replaceAll(/\s+/gu, ' ')
    .split(/(?<=[.!?])\s+(?=[A-Z0-9“"(])/u)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}
