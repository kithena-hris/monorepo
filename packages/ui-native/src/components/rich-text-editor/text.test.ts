import { describe, expect, it } from 'vitest';

import { textOf } from './text.ts';

describe('textOf', () => {
  it('keeps the text and drops the tags', () => {
    expect(textOf('<p>Welcome, <strong>Lucas</strong>!</p>')).toBe('Welcome, Lucas!');
  });

  it('is empty for an editor with only empty paragraphs', () => {
    expect(textOf('<p></p><p><br></p>').trim()).toBe('');
  });

  it('drops everything after a tag that never closes', () => {
    expect(textOf('Hello <scr<script>ipt')).toBe('Hello ipt');
    expect(textOf('Hello <p')).toBe('Hello ');
  });

  it('leaves entities as they are, as the count always has', () => {
    expect(textOf('<p>Tom &amp; Lucas</p>')).toBe('Tom &amp; Lucas');
  });
});
