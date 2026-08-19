/**
 * Syntax highlighting for the code samples.
 *
 * A tokeniser rather than a dependency. Every snippet on this site is JSX or a
 * short TypeScript line, which is a small enough grammar to scan in one pass;
 * Shiki would add megabytes of grammar and a WASM engine to colour thirty
 * examples, and Prism would still be a parser for a language this page never
 * shows. The trade is honest and worth naming: this understands the subset the
 * docs actually contain, and would mislabel something exotic. If a sample ever
 * needs more, that is the moment to reach for a real grammar.
 *
 * Colours are VS Code's Dark+ and Light+, expressed as tokens in `styles.css`
 * so the palette switches with the theme rather than being burned into the
 * markup here.
 */

import type { JSX } from 'react';

type TokenKind =
  'comment' | 'string' | 'keyword' | 'component' | 'attribute' | 'number' | 'punctuation' | 'text';

interface Token {
  readonly kind: TokenKind;
  readonly value: string;
}

/**
 * Words that colour as language rather than as identifiers.
 *
 * Deliberately short. Colouring every TypeScript keyword would light up a
 * snippet that is mostly JSX, and the point of highlighting is contrast, not
 * decoration.
 */
const KEYWORDS = new Set([
  'const',
  'let',
  'var',
  'function',
  'return',
  'import',
  'export',
  'from',
  'default',
  'type',
  'interface',
  'await',
  'async',
  'new',
  'true',
  'false',
  'null',
  'undefined',
]);

/*
 * One pass, alternation ordered by greed.
 *
 * Comments come first so a `//` inside a line is not read as punctuation, and
 * strings come before identifiers so a keyword inside quotes stays a string.
 * The JSX tag rule captures the leading `<` or `</` separately from the name so
 * a component and its brackets can be coloured differently, which is what makes
 * a nested tree readable at a glance.
 */
const SCANNER = new RegExp(
  [
    '(?<comment>\\{?/\\*[\\s\\S]*?\\*/\\}?|//[^\\n]*)',
    '(?<string>\'[^\']*\'|"[^"]*"|`[^`]*`)',
    '(?<tag></?)(?<tagName>[A-Za-z][\\w.]*)(?=[\\s/>])',
    '(?<attribute>[a-zA-Z-]+)(?==)',
    '(?<number>\\b\\d+(?:\\.\\d+)?n?\\b)',
    '(?<word>[A-Za-z_$][\\w$]*)',
    '(?<punctuation>[<>/{}()[\\].,;:=+\\-*!?&|]+)',
  ].join('|'),
  'g',
);

function tokenise(source: string): readonly Token[] {
  const tokens: Token[] = [];
  let last = 0;

  for (const match of source.matchAll(SCANNER)) {
    const groups = match.groups;
    if (!groups) continue;
    const at = match.index;

    // Anything the scanner skipped is plain text: whitespace, mostly.
    if (at > last) tokens.push({ kind: 'text', value: source.slice(last, at) });
    last = at + match[0].length;

    if (groups['comment'] !== undefined) {
      tokens.push({ kind: 'comment', value: groups['comment'] });
    } else if (groups['string'] !== undefined) {
      tokens.push({ kind: 'string', value: groups['string'] });
    } else if (groups['tagName'] !== undefined) {
      tokens.push({ kind: 'punctuation', value: groups['tag'] ?? '' });
      /*
       * A capitalised tag is a component; a lowercase one is a DOM element.
       * They colour differently for the same reason the editor does it: in a
       * design system's documentation, spotting which parts are Reach and which
       * are plain HTML is most of what the reader is scanning for.
       */
      tokens.push({
        kind: /^[A-Z]/.test(groups['tagName']) ? 'component' : 'keyword',
        value: groups['tagName'],
      });
    } else if (groups['attribute'] !== undefined) {
      tokens.push({ kind: 'attribute', value: groups['attribute'] });
    } else if (groups['number'] !== undefined) {
      tokens.push({ kind: 'number', value: groups['number'] });
    } else if (groups['word'] !== undefined) {
      const word = groups['word'];
      /*
       * A capitalised word is only a component where a component can appear:
       * after a bracket that opens a tag, or inside an import list. Everywhere
       * else it is prose.
       *
       * Without that test, the label inside `<Button>Approve</Button>` coloured
       * as an identifier purely for having a capital letter, so a page of
       * examples read as though half its button text were code.
       */
      const previous = tokens.toReversed().find((token) => token.value.trim() !== '');
      const inValuePosition = previous !== undefined && /[<{,(]$/.test(previous.value.trim());
      tokens.push({
        kind: KEYWORDS.has(word)
          ? 'keyword'
          : /^[A-Z]/.test(word) && inValuePosition
            ? 'component'
            : 'text',
        value: word,
      });
    } else if (groups['punctuation'] !== undefined) {
      tokens.push({ kind: 'punctuation', value: groups['punctuation'] });
    }
  }

  if (last < source.length) tokens.push({ kind: 'text', value: source.slice(last) });
  return tokens;
}

/** Each kind maps to one custom property, defined per theme in `styles.css`. */
const CLASS_BY_KIND: Record<TokenKind, string> = {
  comment: 'dc-tok-comment',
  string: 'dc-tok-string',
  keyword: 'dc-tok-keyword',
  component: 'dc-tok-component',
  attribute: 'dc-tok-attribute',
  number: 'dc-tok-number',
  punctuation: 'dc-tok-punctuation',
  text: '',
};

/**
 * The highlighted source.
 *
 * Returns spans rather than `dangerouslySetInnerHTML`. The samples are authored
 * in this repository so injection is not the risk, but building markup from a
 * string is how a docs site grows an XSS hole the first time a snippet comes
 * from anywhere else, and React's escaping is free.
 */
export function Highlighted({ code }: { code: string }): JSX.Element {
  return (
    <>
      {tokenise(code).map((token, index) =>
        token.kind === 'text' ? (
          token.value
        ) : (
          <span key={index} className={CLASS_BY_KIND[token.kind]}>
            {token.value}
          </span>
        ),
      )}
    </>
  );
}
