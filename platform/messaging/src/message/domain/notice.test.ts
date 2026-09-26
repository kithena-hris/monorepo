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

  it('asks the employee to correct a detail, never saying which or why (PEO-125)', () => {
    const asked = renderNotice({ kind: 'correction_requested' }, INBOX, ACME);
    expect(asked.ok && asked.value.subject).toBe('Acme Corp: HR asked you to correct a detail');
    expect(asked.ok && asked.value.text).toContain('Open your profile');
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

describe('renderNotice: scheduled_report', () => {
  const EXPORT =
    'https://acme.app.kithena.com/people/export?export=0190a0b2-0000-7000-8000-000000000001';

  it('says how often and what format, links to the page that holds the file, and nothing more', () => {
    const result = renderNotice(
      { kind: 'scheduled_report', cadence: 'weekly', format: 'xlsx' },
      EXPORT,
      ACME,
    );
    if (!result.ok) throw new Error('expected a message');
    expect(result.value.subject).toBe('Acme Corp: your weekly People report is ready');
    expect(result.value.text).toContain('weekly Excel report');
    expect(result.value.text).toContain('24 hours');
    expect(result.value.html).toContain(`href="${EXPORT.replaceAll('&', '&amp;')}"`);
  });

  it('sends a summary to the numbers rather than with them', () => {
    const result = renderNotice(
      { kind: 'scheduled_report', cadence: 'monthly', format: 'summary' },
      'https://acme.app.kithena.com/people/analytics',
      ACME,
    );
    if (!result.ok) throw new Error('expected a message');
    expect(result.value.subject).toBe('Acme Corp: your monthly People summary');
    expect(result.value.text).toContain('Open the summary');
  });

  it('refuses a cadence or format it has no words for', () => {
    for (const notice of [
      { kind: 'scheduled_report', cadence: 'hourly', format: 'xlsx' },
      { kind: 'scheduled_report', cadence: 'daily', format: '<b>csv</b>' },
    ]) {
      expect(renderNotice(notice as never, PROFILE, ACME).ok).toBe(false);
    }
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
