import { describe, expect, it } from 'vitest';

import { privateAddress, textOf } from './web.js';

describe('reading a company’s website', () => {
  it('never reaches a private, loopback or link-local address', () => {
    for (const ip of [
      '10.1.2.3',
      '127.0.0.1',
      '169.254.169.254',
      '172.20.0.1',
      '192.168.1.1',
      '::1',
      'fd00::1',
      '::ffff:10.0.0.1',
    ])
      expect(privateAddress(ip)).toBe(true);
    for (const ip of ['8.8.8.8', '172.32.0.1', '2606:4700::1111'])
      expect(privateAddress(ip)).toBe(false);
  });

  it('reads a page as its words: title, description and text, without scripts or tags', () => {
    expect(
      textOf(
        '<html><head><title>Meridian Freight</title><meta name="description" content="Freight by rail &amp; road"><script>var x = 1;</script></head><body><h1>We move&nbsp;goods</h1><style>p{}</style><p>Across Europe.</p></body></html>',
      ),
    ).toBe('Meridian Freight Freight by rail & road We move goods Across Europe.');
  });
});
