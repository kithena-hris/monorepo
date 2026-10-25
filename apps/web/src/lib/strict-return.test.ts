import { describe, expect, it } from 'vitest';

import { SESSION_COOKIE } from './session-cookie';
import { fromAnotherSite, strictReturn } from './strict-return';

const at = 'https://acme.app.kithena.com/performance/tools/github/done?code=c1&state=s.x';

describe('strictReturn', () => {
  it('lets a return with the session through', () => {
    const request = new Request(at, { headers: { cookie: `a=1; ${SESSION_COOKIE}=tok` } });
    expect(strictReturn(request)).toBeNull();
  });

  it('loads the same address again, from this site, when the Strict cookie stayed behind', async () => {
    const answer = strictReturn(new Request(at));
    expect(answer?.headers.get('content-type')).toContain('text/html');
    expect(await answer?.text()).toContain(
      'url=/performance/tools/github/done?code=c1&amp;state=s.x&amp;again=1',
    );
  });

  it('sends a second arrival without it to sign in', () => {
    const answer = strictReturn(new Request(`${at}&again=1`));
    expect(answer?.status).toBe(303);
    expect(answer?.headers.get('location')).toBe('https://acme.app.kithena.com/login');
  });
});

describe('a link followed from another site, as an email’s button in a webmail', () => {
  const link = 'https://acme.app.kithena.com/recruiting/candidates/c1?application=a1';
  const from = (site: string, method = 'GET') =>
    new Request(link, {
      method,
      headers: { 'sec-fetch-site': site, 'sec-fetch-mode': 'navigate' },
    });

  it('is loaded again from this site, so a Strict session cookie goes with it', async () => {
    const answer = fromAnotherSite(from('cross-site'));
    expect(await answer?.text()).toContain('url=/recruiting/candidates/c1?application=a1"');
  });

  it('goes to sign in as before once it arrives from here, or when it is not a page', () => {
    expect(fromAnotherSite(from('same-origin'))).toBeNull();
    expect(fromAnotherSite(from('none'))).toBeNull();
    expect(fromAnotherSite(from('cross-site', 'POST'))).toBeNull();
  });
});
