import { describe, expect, it } from 'vitest';

import { renderCorrespondence } from './correspondence.js';

/** A module's own email (Recruiting PRD §12.7), drawn in the frame every email shares. */
describe('correspondence', () => {
  const parts = {
    facts: [{ label: 'Candidate', value: 'Yuki Sato' }],
    steps: ['Send their invitation', 'They sign up'],
    action: { label: 'Invite Yuki', href: 'https://acme.app.kithena.com/recruiting/candidates/c1' },
  };

  it('lays out the facts and what happens next, numbered, in the HTML and the text', () => {
    const r = renderCorrespondence('Hired: invite them', 'Yuki signed.', 'Acme', parts);
    if (!r.ok) throw new Error('expected an email');
    expect(r.value.html).toContain('What happens next');
    expect(r.value.html).toContain('>2</div>');
    expect(r.value.text).toContain('1. Send their invitation');
  });

  it('tells a candidate to reply, and a member where they choose what reaches them', () => {
    const toCandidate = renderCorrespondence('Hello', 'Thanks.', 'Acme', parts);
    const toMember = renderCorrespondence('Hello', 'Thanks.', 'Acme', parts, undefined, {
      manageHref: 'https://acme.app.kithena.com/settings/notifications',
    });
    if (!toCandidate.ok || !toMember.ok) throw new Error('expected emails');
    expect(toCandidate.value.html).toContain('Reply to this email');
    expect(toMember.value.html).not.toContain('Reply to this email');
    expect(toMember.value.html).toContain(
      'href="https://acme.app.kithena.com/settings/notifications"',
    );
  });
});
