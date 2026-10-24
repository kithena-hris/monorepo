import { describe, expect, it } from 'vitest';

import { withButton } from './context.js';

/** An email's link, drawn as its button: labelled by the words before it, out of the text. */
describe('an email’s link is its button', () => {
  it('takes the last link with the line that names it', () => {
    const shaped = withButton(
      'Thank you.\n\nYour page:\nhttps://jobs.example.com/me/acme#t',
      undefined,
      'Open',
    );
    expect(shaped).toEqual({
      text: 'Thank you.',
      parts: { action: { label: 'Your page', href: 'https://jobs.example.com/me/acme#t' } },
    });
  });

  it('reads a link on the same line as its words, and a bare one as Open', () => {
    expect(
      withButton('Done.\nIn Recruiting: https://acme.example.com/r', undefined, 'Open').parts,
    ).toEqual({ action: { label: 'In Recruiting', href: 'https://acme.example.com/r' } });
    expect(withButton('Done.\n\nhttps://acme.example.com/r', {}, 'Öffnen').parts).toEqual({
      action: { label: 'Öffnen', href: 'https://acme.example.com/r' },
    });
  });

  it('leaves an email that has a button, or only a link, as it was', () => {
    const own = { action: { label: 'Choose a time', href: 'https://acme.example.com/inbox' } };
    expect(withButton('See https://x.example.com', own, 'Open')).toEqual({
      text: 'See https://x.example.com',
      parts: own,
    });
    expect(withButton('https://x.example.com', undefined, 'Open').parts).toBeUndefined();
  });
});
