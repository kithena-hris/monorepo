import { describe, expect, it } from 'vitest';

import { SESSION_COOKIE } from './session-cookie';
import { strictReturn } from './strict-return';

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
