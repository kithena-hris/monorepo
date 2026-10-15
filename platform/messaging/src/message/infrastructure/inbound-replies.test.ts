import { describe, expect, it } from 'vitest';

import { forwardReplies, replyTarget } from './inbound-replies.js';

const token = 'ab'.repeat(10);

describe('inbound replies', () => {
  it('reads the company and token from an address on the inbound domain only', () => {
    expect(replyTarget(`Acme <acme.${token}@in.example.com>`, 'in.example.com')).toEqual({
      company: 'acme',
      token,
    });
    expect(replyTarget(`acme.${token}@elsewhere.com`, 'in.example.com')).toBeNull();
    expect(replyTarget('acme.short@in.example.com', 'in.example.com')).toBeNull();
  });

  it('hands the text to Recruiting behind its token', async () => {
    const posts: { url: string; init: RequestInit }[] = [];
    const forward = forwardReplies({
      domain: 'in.example.com',
      recruitingUrl: 'https://api.example.com',
      recruitingToken: 'secret',
      getEmail: () =>
        Promise.resolve({
          to: [`acme.${token}@in.example.com`, 'someone@else.com'],
          from: 'Yuki Sato <yuki@example.com>',
          subject: 'Re: Your interview',
          text: 'Thursday works.',
        }),
      post: (url, init) => {
        posts.push({ url: url as string, init: init ?? {} });
        return Promise.resolve(new Response(null, { status: 201 }));
      },
    });
    expect(await forward('e1')).toBe(1);
    expect(posts[0]?.url).toBe('https://api.example.com/v1/recruiting/public/acme/replies');
    expect((posts[0]?.init.headers as Record<string, string>)['x-internal-token']).toBe('secret');
    expect(JSON.parse(posts[0]?.init.body as string)).toEqual({
      token,
      from: 'yuki@example.com',
      subject: 'Re: Your interview',
      text: 'Thursday works.',
    });
  });
});
