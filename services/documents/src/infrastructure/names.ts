import nlp from 'compromise';

/**
 * People's names in a text, found on this server (PRD §14.1): what lets a
 * name the company does not know, somebody outside named in a letter, become
 * a stand-in before anything reaches a model. compromise rather than a model
 * or a hand-written list: finding names is what keeps text away from a model,
 * so it cannot be one, and a list of first names misses most of the world's.
 * A pure library, no network, no install scripts.
 */
export function namesIn(text: string): string[] {
  const found = nlp(text).people().out('array') as unknown;
  return (Array.isArray(found) ? found : [])
    .filter((name): name is string => typeof name === 'string')
    .map((name) =>
      name
        .replace(/[.,;:!?)]+$/u, '')
        .replace(/^(?:Mr|Mrs|Ms|Mx|Dr|Prof|Sr|Sra|Herr|Frau)\.?\s+/iu, '')
        .trim(),
    )
    .filter((name) => name.length >= 2);
}
