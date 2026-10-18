import { describe, expect, it } from 'vitest';

import { mended, protectLinks, restored } from './rephrase.js';

const flag = (rewrite: string | null) => ({
  sentence: 'Ashu is a natural mentor.',
  advice: 'Add specific examples of the mentoring.',
  rewrite,
});

describe('a flag’s rewrite', () => {
  it('is kept when it is the sentence mended, placeholders and all', () => {
    const f = mended(flag('Ashu mentored [who] through [what], which [the outcome].'));
    expect(f.rewrite).toBe('Ashu mentored [who] through [what], which [the outcome].');
  });

  it('is dropped when it is advice, so advice is never pasted into a review', () => {
    expect(
      mended(flag('Add specific examples or measurable outcomes to illustrate the mentorship.'))
        .rewrite,
    ).toBeNull();
    expect(mended(flag('Consider naming who was mentored.')).rewrite).toBeNull();
    expect(mended(flag('Add specific examples of the mentoring.')).rewrite).toBeNull();
  });

  it('is dropped when it changes nothing', () => {
    expect(mended(flag('Ashu is a natural mentor.')).rewrite).toBeNull();
    expect(mended(flag('  ')).rewrite).toBeNull();
  });
});

const before =
  '<p>Shipped the <strong>billing</strong> rewrite, see <a href="https://x.test/pr/1" target="_blank" rel="noopener">the PR</a>.</p><ul><li>Led it</li><li>Wrote it</li></ul>';

describe('a rephrase', () => {
  it('shows the model markers, never a link', () => {
    const { text, links } = protectLinks(before);
    expect(text).toContain('⟦1⟧the PR⟦/1⟧');
    expect(text).not.toContain('href');
    expect(links).toEqual(['<a href="https://x.test/pr/1" target="_blank" rel="noopener">']);
  });

  it('puts each link back where it pointed, around the words the model kept for it', () => {
    const { links } = protectLinks(before);
    const html = restored(
      '<p>Delivered the <b>billing</b> rewrite (⟦1⟧pull request⟦/1⟧).</p><ul><li>Led it.</li><li>Wrote most of it.</li></ul>',
      links,
      before,
    );
    expect(html).toBe(
      '<p>Delivered the <strong>billing</strong> rewrite (<a href="https://x.test/pr/1" target="_blank" rel="noopener">pull request</a>).</p><ul><li>Led it.</li><li>Wrote most of it.</li></ul>',
    );
  });

  it('is refused when a link is lost, doubled or made up', () => {
    const { links } = protectLinks(before);
    const lists = '<ul><li>a</li><li>b</li></ul>';
    expect(restored(`<p><strong>x</strong> no link</p>${lists}`, links, before)).toBeNull();
    expect(
      restored(`<p><strong>x</strong> ⟦1⟧a⟦/1⟧ ⟦1⟧b⟦/1⟧</p>${lists}`, links, before),
    ).toBeNull();
    expect(
      restored(`<p><strong>x</strong> ⟦1⟧a⟦/1⟧ ⟦2⟧b⟦/2⟧</p>${lists}`, links, before),
    ).toBeNull();
  });

  it('is refused when the lists or marks changed', () => {
    const { links } = protectLinks(before);
    expect(
      restored('<p><strong>x</strong> ⟦1⟧a⟦/1⟧</p><ul><li>a and b</li></ul>', links, before),
    ).toBeNull();
    expect(restored('<p>x ⟦1⟧a⟦/1⟧</p><ul><li>a</li><li>b</li></ul>', links, before)).toBeNull();
  });

  it('keeps only the editor’s tags, bare, whatever else the model wrote', () => {
    const html = restored(
      '<p onclick="x()">Fine <script>work</script><span style="color:red">here</span></p>',
      [],
      '<p>Fine work here</p>',
    );
    expect(html).toBe('<p>Fine workhere</p>');
  });
});
