import { describe, expect, it } from 'vitest';

import { buttonFrom, codeIn, renderCorrespondence } from './correspondence.js';

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

describe('a one-time code in a module’s own words', () => {
  it('is the six digits its subject and its words both carry, and nothing else', () => {
    expect(codeIn('482913 is your code to apply to Acme', 'Your code is 482913.')).toBe('482913');
    // A number the words do not repeat is not a code, nor part of a longer one.
    expect(codeIn('Offer of 650000 a year', 'We are pleased to offer you the role.')).toBeNull();
    expect(codeIn('Order 4829130', 'Order 4829130 shipped.')).toBeNull();
    expect(codeIn('Welcome', 'Your code is 482913.')).toBeNull();
  });

  it('draws it on its own, and says it first in the text a phone reads', () => {
    const result = renderCorrespondence(
      '482913 is your code to apply to Acme',
      'Hello Ana,\n\nYour code to send your application is 482913. It works for 10 minutes.',
      'Acme',
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.html).toContain('user-select:all;">482913<');
    expect(result.value.text.split('\n')[0]).toBe('Your verification code is 482913');
  });

  it('shows what it is about from the site its button opens, and nothing for a link elsewhere', () => {
    const ours = renderCorrespondence('Your interview', 'See you then.', 'Acme', {
      action: { label: 'Open', href: 'https://jobs.kithena.com/me/acme' },
    });
    const theirs = renderCorrespondence('Your interview', 'See you then.', 'Acme', {
      action: { label: 'Join', href: 'https://meet.example.com/abc' },
    });
    expect(ours.ok && ours.value.html).toContain('https://jobs.kithena.com/email/mail.png');
    expect(theirs.ok && theirs.value.html).not.toContain('/email/');
  });
});
