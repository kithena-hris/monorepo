import { describe, expect, it } from 'vitest';

import { chatReturnTo } from './chat-return';

const state = (o: string) => `${Buffer.from(JSON.stringify({ o })).toString('base64url')}.sig`;
const back = (o: string, extra = '') =>
  new URL(`https://auth.app.kithena.com/chat/slack/done?code=c1&state=${state(o)}${extra}`);

describe('chatReturnTo', () => {
  it('passes the code and state on to the company’s own origin', () => {
    const to = chatReturnTo(back('https://acme.app.kithena.com'), 'auth.app.kithena.com');
    expect(to).toMatch(/^https:\/\/acme\.app\.kithena\.com\/people\/chat\/slack\/done\?code=c1&state=/);
  });

  it('sends nobody anywhere but a company origin', () => {
    for (const o of [
      'https://evil.com',
      'https://acme.app.kithena.com.evil.com',
      'https://a.b.app.kithena.com',
      'https://auth.app.kithena.com',
      'https://acme.app.kithena.com/elsewhere',
      'javascript:alert(1)',
    ]) {
      expect(chatReturnTo(back(o), 'auth.app.kithena.com')).toBe(null);
    }
    expect(
      chatReturnTo(new URL('https://auth.app.kithena.com/chat/slack/done?state=junk'), 'auth.app.kithena.com'),
    ).toBe(null);
  });
});
