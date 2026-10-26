import { describe, expect, it } from 'vitest';

import { buttonFrom, renderCorrespondence } from './correspondence.js';

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

  it('leaves out a fact with nothing to say', () => {
    const r = renderCorrespondence('Feedback', 'Asked.', 'Acme', {
      facts: [
        { label: 'Topic', value: ' ' },
        { label: 'Asked by', value: 'Ana Ruiz' },
      ],
    });
    if (!r.ok) throw new Error('expected an email');
    expect(r.value.text).toContain('Asked by: Ana Ruiz');
    expect(r.value.text).not.toContain('Topic');
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

describe('a link at the end of the words', () => {
  it('becomes the button, labelled by the line before it', () => {
    expect(
      buttonFrom(
        'Your review is due Friday.\n\nOpen your review:\nhttps://acme.app.kithena.com/performance/r1',
        'Open',
      ),
    ).toEqual({
      label: 'Open your review',
      href: 'https://acme.app.kithena.com/performance/r1',
      text: 'Your review is due Friday.',
    });
    expect(buttonFrom('Sessions: https://acme.app.kithena.com/l', 'Open')).toBeNull();
    const r = renderCorrespondence(
      'Reminder',
      'Due Friday.\n\nhttps://acme.app.kithena.com/p',
      'Acme',
    );
    if (!r.ok) throw new Error('expected an email');
    expect(r.value.html).toContain('href="https://acme.app.kithena.com/p" class="k-button"');
  });
});
