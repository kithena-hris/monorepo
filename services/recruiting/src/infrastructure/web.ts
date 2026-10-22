import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';

import type { Web } from '../application/ports.js';

/**
 * A company's own website, read for its careers page's "about" (S1): the
 * home page as text. Only the public web: a host that resolves to a private,
 * loopback or link-local address is never fetched, at the first request or
 * after a redirect, so a name typed in settings cannot reach inside.
 */

const PRIVATE_V4: readonly (readonly [number, number])[] = [
  [0x00000000, 8],
  [0x0a000000, 8],
  [0x64400000, 10],
  [0x7f000000, 8],
  [0xa9fe0000, 16],
  [0xac100000, 12],
  [0xc0a80000, 16],
];

const v4 = (ip: string): number =>
  ip.split('.').reduce((n, part) => (n << 8) + Number(part), 0) >>> 0;

/** Not on the public internet. */
export function privateAddress(ip: string): boolean {
  if (isIP(ip) === 4) {
    const n = v4(ip);
    return PRIVATE_V4.some(([base, bits]) => n >>> (32 - bits) === base >>> (32 - bits));
  }
  const low = ip.toLowerCase();
  return (
    low === '::1' ||
    low === '::' ||
    low.startsWith('fc') ||
    low.startsWith('fd') ||
    low.startsWith('fe80') ||
    (low.startsWith('::ffff:') && privateAddress(low.slice(7)))
  );
}

async function publicHost(host: string): Promise<boolean> {
  if (!/^(?=.{4,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,}$/u.test(host))
    return false;
  try {
    const addresses = await lookup(host, { all: true });
    return addresses.length > 0 && addresses.every((a) => !privateAddress(a.address));
  } catch {
    return false;
  }
}

const ENTITIES: Readonly<Record<string, string>> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
};

/** The words a page shows: no scripts, styles or tags, entities read, space collapsed. */
export function textOf(html: string): string {
  const title = /<title[^>]*>([^<]*)<\/title>/iu.exec(html)?.[1] ?? '';
  const description =
    /<meta[^>]+name=["']description["'][^>]+content=["']([^"']*)["']/iu.exec(html)?.[1] ?? '';
  const body = html
    .replaceAll(/<(script|style|noscript|svg|title)[\s\S]*?<\/\1>/giu, ' ')
    .replaceAll(/<[^>]+>/gu, ' ');
  return [title, description, body]
    .join(' ')
    .replaceAll(/&(#\d+|[a-z]+);/giu, (whole, name: string) =>
      name.startsWith('#')
        ? String.fromCodePoint(Number(name.slice(1)))
        : (ENTITIES[name] ?? whole),
    )
    .replaceAll(/\s+/gu, ' ')
    .trim();
}

export function webReader(): Web {
  return {
    async read(host) {
      let url = `https://${host}/`;
      for (let hop = 0; hop < 4; hop += 1) {
        const at = new URL(url);
        if (at.protocol !== 'https:' || !(await publicHost(at.hostname))) return null;
        let response: Response;
        try {
          response = await fetch(url, {
            redirect: 'manual',
            headers: {
              'user-agent': 'KithenaRecruiting/1.0 (+https://kithena.com)',
              accept: 'text/html',
            },
            signal: AbortSignal.timeout(6_000),
          });
        } catch {
          return null;
        }
        const next = response.headers.get('location');
        if (response.status >= 300 && response.status < 400 && next !== null) {
          url = new URL(next, url).toString();
          continue;
        }
        if (!response.ok || !(response.headers.get('content-type') ?? '').includes('text/html'))
          return null;
        const html = (await response.text()).slice(0, 500_000);
        return { url, text: textOf(html).slice(0, 8_000) };
      }
      return null;
    },
  };
}
