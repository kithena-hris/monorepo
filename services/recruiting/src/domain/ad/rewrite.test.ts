import { describe, expect, it } from 'vitest';

import {
  docFrom,
  docToMarkdown,
  markdownToDoc,
  textsOf,
  withTexts,
  withoutAmounts,
} from './rewrite.js';
import { renderAd } from './render.js';

const doc = {
  type: 'doc',
  content: [
    { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: 'The role' }] },
    {
      type: 'paragraph',
      content: [
        { type: 'text', text: 'Design the product ' },
        { type: 'text', text: 'with us', marks: [{ type: 'bold' }] },
        { type: 'text', text: '.' },
      ],
    },
  ],
};

describe('an ad’s words, apart from its structure (PRD §22.3)', () => {
  it('reads the text in order', () => {
    expect(textsOf(doc)).toEqual(['The role', 'Design the product ', 'with us', '.']);
  });

  it('puts translated text back where it was, marks and all', () => {
    const translated = withTexts(doc, ['El puesto', 'Diseña el producto ', 'con nosotros', '.']);
    expect(translated.ok && textsOf(translated.value)).toEqual([
      'El puesto',
      'Diseña el producto ',
      'con nosotros',
      '.',
    ]);
    expect(JSON.stringify(translated.ok && translated.value)).toContain('"bold"');
  });

  it('refuses a translation that lost or added a piece', () => {
    expect(withTexts(doc, ['El puesto']).ok).toBe(false);
  });

  it('builds a document from drafted sections', () => {
    expect(docFrom([{ heading: 'About', paragraphs: ['One.', 'Two.'] }])).toEqual({
      type: 'doc',
      content: [
        { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: 'About' }] },
        { type: 'paragraph', content: [{ type: 'text', text: 'One.' }] },
        { type: 'paragraph', content: [{ type: 'text', text: 'Two.' }] },
      ],
    });
  });
});

describe('a drafted ad as rich text (PRD §22.3)', () => {
  it('turns the model’s markdown into the editor’s headings, lists and marks', () => {
    const md = [
      '## What you will do',
      '',
      'Build **checkout** with a small team,',
      'shipping every week.',
      '',
      '- Own the *payments* service',
      '- Pair with design',
      '',
      '### Nice to have',
      '1. Go',
      '2. Kafka',
    ].join('\n');
    expect(renderAd(markdownToDoc(md)).html).toBe(
      '<h2>What you will do</h2><p>Build <strong>checkout</strong> with a small team, shipping every week.</p>' +
        '<ul><li><p>Own the <em>payments</em> service</p></li><li><p>Pair with design</p></li></ul>' +
        '<h3>Nice to have</h3><ol><li><p>Go</p></li><li><p>Kafka</p></li></ol>',
    );
  });

  it('reads a document back as the same markdown, so a model can revise it', () => {
    const md = '## The role\n\nDesign the product **with us**.\n\n- One\n- Two';
    expect(docToMarkdown(markdownToDoc(md))).toBe(md);
    expect(docToMarkdown(doc)).toBe('## The role\n\nDesign the product **with us**.');
  });

  it('keeps no amount of money the model wrote: the page shows the pay from the job', () => {
    expect(
      withoutAmounts(
        'A great team. You earn €60,000 a year. Remote friendly.\n\n- Salary up to $90k\n- Free lunch',
      ),
    ).toBe('A great team. Remote friendly.\n\n- Free lunch');
  });
});
