/**
 * An ad's HTML and text, rendered from the editor's document (Recruiting PRD
 * §8.2): the Tiptap JSON the editor saves, walked node by node through an
 * allow-list. No HTML from the browser is parsed or kept, so nothing it
 * carried can reach the public page; every text is escaped, and a link is
 * kept only when it is http or https.
 */

interface Node {
  readonly type?: unknown;
  readonly text?: unknown;
  readonly attrs?: { readonly level?: unknown; readonly href?: unknown };
  readonly marks?: readonly {
    readonly type?: unknown;
    readonly attrs?: { readonly href?: unknown };
  }[];
  readonly content?: readonly unknown[];
}

const escape = (text: string): string =>
  text
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');

const safeHref = (href: unknown): string | null => {
  if (typeof href !== 'string') return null;
  try {
    const url = new URL(href);
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.toString() : null;
  } catch {
    return null;
  }
};

const BLOCKS: Readonly<Record<string, string>> = {
  paragraph: 'p',
  bulletList: 'ul',
  orderedList: 'ol',
  listItem: 'li',
  blockquote: 'blockquote',
};

function inline(node: Node): string {
  if (node.type === 'hardBreak') return '<br>';
  if (node.type !== 'text' || typeof node.text !== 'string') return '';
  let out = escape(node.text);
  for (const mark of node.marks ?? []) {
    if (mark.type === 'bold') out = `<strong>${out}</strong>`;
    else if (mark.type === 'italic') out = `<em>${out}</em>`;
    else if (mark.type === 'link') {
      const href = safeHref(mark.attrs?.href);
      if (href !== null) out = `<a href="${escape(href)}" rel="noopener nofollow">${out}</a>`;
    }
  }
  return out;
}

function block(node: Node): string {
  const children = (node.content ?? []) as readonly Node[];
  if (node.type === 'doc') return children.map(block).join('');
  if (node.type === 'heading') {
    const level = node.attrs?.level === 3 ? 3 : 2;
    return `<h${String(level)}>${children.map(inline).join('')}</h${String(level)}>`;
  }
  const tag = typeof node.type === 'string' ? BLOCKS[node.type] : undefined;
  if (tag === undefined) return inline(node);
  const inner = tag === 'p' ? children.map(inline).join('') : children.map(block).join('');
  return `<${tag}>${inner}</${tag}>`;
}

function text(node: Node): string {
  if (node.type === 'text' && typeof node.text === 'string') return node.text;
  if (node.type === 'hardBreak') return '\n';
  const inner = ((node.content ?? []) as readonly Node[]).map(text).join('');
  return node.type === 'paragraph' || node.type === 'heading' || node.type === 'listItem'
    ? `${inner}\n`
    : inner;
}

/** The public HTML and the plain text the checks and the search read. */
export function renderAd(doc: unknown): { readonly html: string; readonly plain: string } {
  if (doc === null || typeof doc !== 'object') return { html: '', plain: '' };
  const root = doc as Node;
  return {
    html: block(root),
    plain: text(root)
      .replace(/\n{3,}/gu, '\n\n')
      .trim(),
  };
}
