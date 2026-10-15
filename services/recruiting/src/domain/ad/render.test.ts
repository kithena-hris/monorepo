import { describe, expect, it } from 'vitest';

import { renderAd } from './render.js';

describe('the ad rendered from its document (PRD §8.2)', () => {
  it('keeps the allowed structure and escapes every text', () => {
    const doc = {
      type: 'doc',
      content: [
        {
          type: 'heading',
          attrs: { level: 2 },
          content: [{ type: 'text', text: 'What you’ll do' }],
        },
        {
          type: 'paragraph',
          content: [
            {
              type: 'text',
              text: 'Build <script>alert(1)</script> things',
              marks: [{ type: 'bold' }],
            },
          ],
        },
        {
          type: 'bulletList',
          content: [
            {
              type: 'listItem',
              content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Go' }] }],
            },
          ],
        },
        {
          type: 'paragraph',
          content: [
            {
              type: 'text',
              text: 'site',
              marks: [{ type: 'link', attrs: { href: 'javascript:alert(1)' } }],
            },
            { type: 'text', text: ' and ' },
            {
              type: 'text',
              text: 'blog',
              marks: [{ type: 'link', attrs: { href: 'https://acme.example/blog' } }],
            },
          ],
        },
        { type: 'iframe', content: [{ type: 'text', text: 'x' }] },
      ],
    };
    const { html, plain } = renderAd(doc);
    expect(html).toBe(
      '<h2>What you’ll do</h2><p><strong>Build &lt;script&gt;alert(1)&lt;/script&gt; things</strong></p><ul><li><p>Go</p></li></ul><p>site and <a href="https://acme.example/blog" rel="noopener nofollow">blog</a></p>',
    );
    expect(plain).toContain('Build <script>alert(1)</script> things');
  });
});
