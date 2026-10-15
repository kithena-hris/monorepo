import { describe, expect, it } from 'vitest';

import { docFrom, textsOf, withTexts } from './rewrite.js';

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
