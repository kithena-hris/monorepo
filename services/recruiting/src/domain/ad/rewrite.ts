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

/*
 * Markdown, both ways (PRD §22.3): a model writes an ad as the little
 * markdown a job ad needs, and the editor holds the same structure as its
 * document. Only what the renderer allows is made: headings at levels 2 and
 * 3, paragraphs, bulleted and numbered lists, bold and italic. Anything else
 * a model writes is kept as plain words.
 */

type Mark = { readonly type: 'bold' | 'italic' };

/** Inline text with **bold** and *italic* (or _italic_), as the editor's text nodes. */
function inlineNodes(line: string): Node[] {
  const out: Node[] = [];
  const pattern = /\*\*([^*]+)\*\*|\*([^*]+)\*|_([^_]+)_/gu;
  let at = 0;
  for (const m of line.matchAll(pattern)) {
    const index = m.index;
    if (index > at) out.push(text(line.slice(at, index)));
    const bold = m[1];
    const italic = m[2] ?? m[3];
    const marks: Mark[] = bold === undefined ? [{ type: 'italic' }] : [{ type: 'bold' }];
    out.push({ type: 'text', text: bold ?? italic ?? '', marks });
    at = index + m[0].length;
  }
  if (at < line.length) out.push(text(line.slice(at)));
  return out.filter((n) => n.text !== '');
}

const paragraphOf = (lines: readonly string[]): Node => ({
  type: 'paragraph',
  content: inlineNodes(lines.map((l) => l.trim()).join(' ')),
});

export function markdownToDoc(markdown: string): Node {
  const content: Node[] = [];
  let paragraph: string[] = [];
  let list: { readonly type: 'bulletList' | 'orderedList'; readonly items: Node[] } | null = null;
  const flush = (): void => {
    if (paragraph.length > 0) content.push(paragraphOf(paragraph));
    paragraph = [];
    if (list !== null) content.push({ type: list.type, content: list.items });
    list = null;
  };
  for (const raw of markdown.replaceAll('\r\n', '\n').split('\n')) {
    const line = raw.trimEnd();
    const heading = /^(#{1,6})\s+(.*)$/u.exec(line);
    const bullet = /^\s*[-*•]\s+(.*)$/u.exec(line);
    const numbered = /^\s*\d+[.)]\s+(.*)$/u.exec(line);
    if (line.trim() === '') flush();
    else if (heading !== null) {
      flush();
      const level = (heading[1] ?? '').length >= 3 ? 3 : 2;
      content.push({ type: 'heading', attrs: { level }, content: inlineNodes(heading[2] ?? '') });
    } else if (bullet !== null || numbered !== null) {
      if (paragraph.length > 0) {
        content.push(paragraphOf(paragraph));
        paragraph = [];
      }
      const type = bullet === null ? 'orderedList' : 'bulletList';
      if (list === null || list.type !== type) {
        if (list !== null) content.push({ type: list.type, content: list.items });
        list = { type, items: [] };
      }
      list.items.push({
        type: 'listItem',
        content: [paragraphOf([(bullet ?? numbered)?.[1] ?? ''])],
      });
    } else {
      if (list !== null) {
        content.push({ type: list.type, content: list.items });
        list = null;
      }
      paragraph.push(line);
    }
  }
  flush();
  return { type: 'doc', content: content.filter((n) => (n.content ?? []).length > 0) };
}

function inlineMarkdown(nodes: readonly Node[]): string {
  return nodes
    .map((n) => {
      if (n.type === 'hardBreak') return ' ';
      const t = n.text ?? '';
      const marks = (n['marks'] as readonly { type?: unknown }[] | undefined) ?? [];
      const bold = marks.some((m) => m.type === 'bold');
      const italic = marks.some((m) => m.type === 'italic');
      return bold ? `**${t}**` : italic ? `*${t}*` : t;
    })
    .join('');
}

/** The editor's document as markdown: what a model revises. */
export function docToMarkdown(doc: unknown): string {
  if (!isNode(doc)) return '';
  const blocks: string[] = [];
  for (const node of doc.content ?? []) {
    const children = node.content ?? [];
    if (node.type === 'heading') {
      const level = (node['attrs'] as { level?: unknown } | undefined)?.level === 3 ? '###' : '##';
      blocks.push(`${level} ${inlineMarkdown(children)}`);
    } else if (node.type === 'paragraph') blocks.push(inlineMarkdown(children));
    else if (node.type === 'bulletList' || node.type === 'orderedList')
      blocks.push(
        children
          .map((item, i) => {
            const words = (item.content ?? [])
              .map((p) => inlineMarkdown(p.content ?? []))
              .join(' ');
            return node.type === 'bulletList' ? `- ${words}` : `${String(i + 1)}. ${words}`;
          })
          .join('\n'),
      );
  }
  return blocks.filter((b) => b.trim() !== '').join('\n\n');
}

/** An amount of money: a currency sign or code beside a number, or a number with a "k". */
const AMOUNT =
  /[€$£₹]\s?\d|\d[\d.,]*\s?(?:€|£|₹|\$|EUR|USD|GBP|INR|k\b)|\b(?:EUR|USD|GBP|INR)\s?\d/iu;

/**
 * The ad's words without any amount of money in them: the page shows the pay
 * from the job's own figures, and a model's guess at a salary would sit
 * beside them disagreeing. A sentence or a list item naming one is dropped.
 */
export function withoutAmounts(markdown: string): string {
  return markdown
    .split('\n')
    .map((line) => {
      if (!AMOUNT.test(line)) return line;
      if (/^\s*([-*•]|\d+[.)])\s+/u.test(line)) return null;
      const kept = line.split(/(?<=[.!?])\s+/u).filter((sentence) => !AMOUNT.test(sentence));
      return kept.length === 0 ? null : kept.join(' ');
    })
    .filter((line): line is string => line !== null)
    .join('\n')
    .replace(/\n{3,}/gu, '\n\n')
    .trim();
}
