import { describe, expect, it } from 'vitest';

import { light } from './palette.js';
import { linkIsOnTenantApp, renderNotice } from './notice.js';

const PROFILE = 'https://acme.app.kithena.com/people';
const ACME = 'Acme Corp';

describe('renderNotice: webhook_disabled', () => {
  it('names the host and nothing after it', () => {
    const result = renderNotice(
      { kind: 'webhook_disabled', host: 'hooks.example.com' },
      'https://acme.app.kithena.com/people',
      ACME,
    );
    if (!result.ok) throw new Error('expected a message');
    expect(result.value.subject).toBe('Acme Corp: a People webhook was turned off');
    expect(result.value.text).toContain('hooks.example.com');
    expect(result.value.html).toContain(light['accent-solid']);
  });

  it('refuses anything that is not a bare hostname', () => {
    for (const host of ['hooks.example.com/path?token=x', '<b>x</b>', '', 'a b']) {
      expect(renderNotice({ kind: 'webhook_disabled', host }, PROFILE, ACME).ok).toBe(false);
    }
  });
});

describe('renderNotice: the approval of a change (PEO-077)', () => {
  const INBOX = 'https://acme.app.kithena.com/people/approvals';

  it('asks an approver to look, naming neither the person, the field nor the value', () => {
    const result = renderNotice({ kind: 'approval_requested' }, INBOX, ACME);
    if (!result.ok) throw new Error('expected a message');
    expect(result.value.subject).toBe('Acme Corp: a change is waiting for your approval');
    expect(result.value.text).toContain(INBOX);
    expect(result.value.text).toContain('seven days');
  });

  it('tells the requester whether it was approved or rejected', () => {
    const approved = renderNotice({ kind: 'approval_decided', decision: 'approved' }, INBOX, ACME);
    const rejected = renderNotice({ kind: 'approval_decided', decision: 'rejected' }, INBOX, ACME);
    expect(approved.ok && approved.value.subject).toBe('Acme Corp: your change was approved');
    expect(rejected.ok && rejected.value.subject).toBe('Acme Corp: your change was not approved');
    expect(rejected.ok && rejected.value.text).toContain('was not applied');
  });

  it('tells the requester nobody decided in time', () => {
    const expired = renderNotice({ kind: 'approval_expired' }, INBOX, ACME);
    expect(expired.ok && expired.value.subject).toBe(
      'Acme Corp: your change expired without a decision',
    );
    expect(expired.ok && expired.value.text).toContain('was not applied');
  });

  it('refuses a decision it has no words for', () => {
    expect(
      renderNotice({ kind: 'approval_decided', decision: 'maybe' as 'approved' }, INBOX, ACME).ok,
    ).toBe(false);
  });
});

describe('renderNotice: profile_reminder', () => {
  it('counts what is missing and links to the profile, in both bodies', () => {
    const result = renderNotice({ kind: 'profile_reminder', missing: 3 }, PROFILE, ACME);
    if (!result.ok) throw new Error('expected a message');
    const { subject, html, text } = result.value;

    expect(subject).toBe('Acme Corp: a few details are missing from your profile');
    expect(html).toContain('3 details');
    expect(text).toContain('3 details');
    expect(html).toContain(`href="${PROFILE}"`);
    expect(text).toContain(PROFILE);
    // Reach, resolved: the button is accent-solid on fg-on-accent.
    expect(html).toContain(light['accent-solid']);
    expect(html).toContain(light['fg-on-accent']);
  });

  it('says "one detail" rather than "1 details"', () => {
    const result = renderNotice({ kind: 'profile_reminder', missing: 1 }, PROFILE, ACME);
    expect(result.ok && result.value.text).toContain('one detail');
  });

  it('refuses a count that is not a positive whole number', () => {
    for (const missing of [0, -1, 1.5, Number.NaN, 5000]) {
      expect(renderNotice({ kind: 'profile_reminder', missing }, PROFILE, ACME).ok).toBe(false);
    }
  });

  it('refuses a link that is not http(s)', () => {
    expect(
      renderNotice({ kind: 'profile_reminder', missing: 2 }, 'javascript:alert(1)', ACME).ok,
    ).toBe(false);
  });
});

describe('the company', () => {
  it('is named in the subject and both bodies, and escaped in the HTML', () => {
    const result = renderNotice({ kind: 'profile_reminder', missing: 2 }, PROFILE, 'Smith & <Co>');
    if (!result.ok) throw new Error('expected a message');
    expect(result.value.subject).toContain('Smith & <Co>');
    expect(result.value.text).toContain('Sent by Kithena on behalf of Smith & <Co>.');
    expect(result.value.html).toContain('Smith &amp; &lt;Co&gt;');
    expect(result.value.html).not.toContain('<Co>');
  });

  it('must be given: a notice that will not say who sent it is not sent', () => {
    for (const name of ['', '   ', 'x'.repeat(121)]) {
      expect(renderNotice({ kind: 'profile_reminder', missing: 2 }, PROFILE, name).ok).toBe(false);
    }
  });
});

describe('linkIsOnTenantApp', () => {
  const BASE = 'https://{slug}.app.kithena.com';

  it('admits a company’s own origin', () => {
    expect(linkIsOnTenantApp('https://acme.app.kithena.com/people', BASE)).toBe(true);
    expect(
      linkIsOnTenantApp(
        'http://acme.app.localhost:3000/people',
        'http://{slug}.app.localhost:3000',
      ),
    ).toBe(true);
  });

  it('refuses every origin that is nobody’s', () => {
    for (const url of [
      'https://app.kithena.com/people',
      'https://a.b.app.kithena.com/people',
      'https://acme.app.kithena.com.evil.example/people',
      'https://acme.app.kithena.com:8443/people',
      'http://acme.app.kithena.com/people',
      'https://evil.example/people',
      'not a url',
    ]) {
      expect(linkIsOnTenantApp(url, BASE)).toBe(false);
    }
  });

  it('refuses everything when the base has no place for a slug', () => {
    expect(linkIsOnTenantApp('https://app.kithena.com/people', 'https://app.kithena.com')).toBe(
      false,
    );
  });
});
