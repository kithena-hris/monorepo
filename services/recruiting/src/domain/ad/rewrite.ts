import { err, failure, ok, type Result } from '@kithena/domain-kit';

/**
 * An ad's words apart from its structure (PRD §22.3): a model drafts or
 * translates prose, and the structure — headings, lists, marks, and the parts
 * filled from data — is the document's, untouched. A translation comes back
 * as the same number of pieces in the same order, or it is refused.
 */

interface Node {
  readonly type: string;
  readonly text?: string;
  readonly content?: readonly Node[];
  readonly [key: string]: unknown;
}

const isNode = (v: unknown): v is Node =>
  typeof v === 'object' && v !== null && typeof (v as { type?: unknown }).type === 'string';

export function textsOf(doc: unknown): string[] {
  if (!isNode(doc)) return [];
  if (doc.type === 'text') return [doc.text ?? ''];
  return (doc.content ?? []).flatMap(textsOf);
}

export function withTexts(doc: unknown, texts: readonly string[]): Result<Node> {
  if (!isNode(doc)) return err(failure('INVALID', 'Not a document'));
  if (textsOf(doc).length !== texts.length)
    return err(failure('TRANSLATION_SHAPE', 'The translation does not match the ad; try again'));
  let i = 0;
  const walk = (node: Node): Node =>
    node.type === 'text'
      ? { ...node, text: texts[i++] ?? '' }
      : node.content === undefined
        ? node
        : { ...node, content: node.content.map(walk) };
  return ok(walk(doc));
}

const text = (t: string) => ({ type: 'text', text: t });

export function docFrom(
  sections: readonly { readonly heading: string | null; readonly paragraphs: readonly string[] }[],
): Node {
  return {
    type: 'doc',
    content: sections.flatMap((s) => [
      ...(s.heading === null || s.heading === ''
        ? []
        : [{ type: 'heading', attrs: { level: 2 }, content: [text(s.heading)] }]),
      ...s.paragraphs
        .filter((p) => p.trim() !== '')
        .map((p) => ({ type: 'paragraph', content: [text(p)] })),
    ]),
  };
}
