import { describe, expect, it } from 'vitest';

import { toAddress, type EmailAddress } from './address.js';
import { formatDeadline, linkIsTrusted, renderInvitation } from './invitation.js';
import { dark, light, scale } from './palette.js';

const ada = ((): EmailAddress => {
  const parsed = toAddress('ada@acme.example');
  if (!parsed.ok) throw new Error('the fixture address is not an address');
  return parsed.value;
})();

const invitation: {
  companyName: string;
  recipient: EmailAddress;
  enrolUrl: string;
  expiresAt: string;
  logoUrl: string | null;
} = {
  companyName: 'Acme Corp',
  recipient: ada,
  enrolUrl: 'https://auth.app.kithena.com/enrol?tenant=acme&token=abc&name=ada%40acme.example',
  expiresAt: '2026-08-27T09:05:00.000Z',
  logoUrl: null,
};

const rendered = (over: Partial<typeof invitation> = {}) => {
  const result = renderInvitation({ ...invitation, ...over });
  if (!result.ok) throw new Error(`expected a rendered message: ${result.error.code}`);
  return result.value;
};

describe('linkIsTrusted', () => {
  it('accepts a link on the auth origin', () => {
    expect(
      linkIsTrusted('https://auth.app.kithena.com/enrol?token=abc', 'https://auth.app.kithena.com'),
    ).toBe(true);
  });

  it('refuses a different host', () => {
    // The whole reason this service is not an open redirect with our sending
    // reputation attached. The caller is authenticated by a shared secret, and
    // a shared secret is the kind of credential that ends up in a CI log.
    expect(
      linkIsTrusted(
        'https://auth.app.kithena.com.evil.example/enrol',
        'https://auth.app.kithena.com',
      ),
    ).toBe(false);
    expect(linkIsTrusted('https://evil.example/enrol', 'https://auth.app.kithena.com')).toBe(false);
  });

  it('refuses a downgraded scheme and a changed port', () => {
    expect(linkIsTrusted('http://auth.app.kithena.com/enrol', 'https://auth.app.kithena.com')).toBe(
      false,
    );
    expect(
      linkIsTrusted('https://auth.app.kithena.com:8443/enrol', 'https://auth.app.kithena.com'),
    ).toBe(false);
  });

  it('refuses something that is not a URL', () => {
    expect(linkIsTrusted('/enrol?token=abc', 'https://auth.app.kithena.com')).toBe(false);
  });
});

describe('formatDeadline', () => {
  it('says the zone it is in', () => {
    expect(formatDeadline('2026-08-27T09:05:00.000Z')).toBe('27 August 2026 at 09:05 UTC');
  });

  it('converts an offset to UTC rather than printing the local wall clock', () => {
    // 23:30 in Madrid on the 27th is 21:30 UTC on the same day. Printing the
    // wall clock we were handed would put a time in the message that is right
    // for nobody.
    expect(formatDeadline('2026-08-27T23:30:00+02:00')).toBe('27 August 2026 at 21:30 UTC');
  });

  it('refuses a date it cannot read', () => {
    expect(formatDeadline('next tuesday')).toBeNull();
    expect(formatDeadline('')).toBeNull();
  });
});

describe('renderInvitation', () => {
  it('names the company in the subject', () => {
    expect(rendered().subject).toBe("You're invited to join Acme Corp on Kithena");
  });

  it('always produces a plain-text alternative', () => {
    // Not a courtesy. HTML-only scores as spam, and a corporate gateway that
    // strips HTML would deliver an empty invitation to exactly the deskless
    // population this product is meant to reach.
    const message = rendered();
    expect(message.text).toContain('Set up your account:');
    expect(message.text).toContain(invitation.enrolUrl);
  });

  it('shows the address the account was created for', () => {
    // The link lands on a page that says the same thing. Someone holding
    // passkeys for three employers needs to know which account this is before
    // their device asks them to approve one.
    expect(rendered().html).toContain('ada@acme.example');
    expect(rendered().text).toContain('ada@acme.example');
  });

  it('states the deadline in both bodies', () => {
    const message = rendered();
    expect(message.html).toContain('27 August 2026 at 09:05 UTC');
    expect(message.text).toContain('27 August 2026 at 09:05 UTC');
  });

  it('escapes the query string in the href', () => {
    // Unescaped, `&token=` is a character entity to an HTML parser, and the
    // button quietly leads somewhere other than the link printed beneath it.
    expect(rendered().html).toContain(
      'href="https://auth.app.kithena.com/enrol?tenant=acme&amp;token=abc',
    );
  });

  it('renders a hostile company name as text', () => {
    const message = rendered({ companyName: '<img src=x onerror=alert(1)>' });
    expect(message.html).not.toContain('<img src=x');
    expect(message.html).toContain('&lt;img src=x onerror=alert(1)&gt;');
  });

  it('refuses a link whose scheme would run code', () => {
    expect(renderInvitation({ ...invitation, enrolUrl: 'javascript:alert(1)' }).ok).toBe(false);
  });

  it('refuses a company with no name rather than sending "join  on Kithena"', () => {
    expect(renderInvitation({ ...invitation, companyName: '   ' }).ok).toBe(false);
  });

  it('refuses a company name too long to be one', () => {
    expect(renderInvitation({ ...invitation, companyName: 'A'.repeat(200) }).ok).toBe(false);
  });

  it('refuses an expiry it cannot render', () => {
    expect(renderInvitation({ ...invitation, expiresAt: 'soon' }).ok).toBe(false);
  });
});

describe('the message is the design system', () => {
  it('uses Reach tokens for every colour it paints', () => {
    // Not "looks about right". These are the resolved values of
    // `--reach-color-*`, and `pnpm email:theme-drift` fails if the token moves
    // without this file moving with it.
    const message = rendered().html;
    expect(message).toContain(light.canvas);
    expect(message).toContain(light.surface);
    expect(message).toContain(light['accent-solid']);
    expect(message).toContain(light['fg-muted']);
    expect(message).toContain(light.border);
  });

  it('renders the primary button as Reach renders it', () => {
    // `Button variant="primary" size="lg"`: accent-solid fill, on-accent
    // label, `--radius-md`, `--reach-control-lg`, `--text-md`, medium.
    const message = rendered().html;
    expect(message).toContain(`background:${light['accent-solid']}`);
    expect(message).toContain(`color:${light['fg-on-accent']}`);
    expect(message).toContain(`border-radius:${scale.radiusControl}`);
    expect(message).toContain(`height:${scale.controlHeight}`);
  });

  it('keeps the button usable in Outlook, which ignores radius and padding', () => {
    // Word would give a square, unpadded, hard-to-hit link. The VML shape is
    // the only way it gets the same corner and the same 44px target.
    const message = rendered().html;
    expect(message).toContain('<!--[if mso]>');
    expect(message).toContain('v:roundrect');
    expect(message).toContain('arcsize="18%"');
    // And exactly one of the two is ever shown.
    expect(message).toContain('mso-hide:all');
  });

  it('carries the dark palette for the clients that honour it', () => {
    const message = rendered().html;
    expect(message).toContain('@media (prefers-color-scheme: dark)');
    expect(message).toContain(dark.surface);
    expect(message).toContain(dark.fg);
  });

  it('never paints pure white as the page', () => {
    // Gmail keeps neither the style block nor the query and force-inverts
    // instead. An inverted `#f9fafb` is a usable dark; an inverted `#ffffff`
    // is not, which is why the canvas is a Reach token rather than white.
    expect(light.canvas).not.toBe('#ffffff');
    expect(rendered().html).toContain(`background:${light.canvas}`);
  });

  it('gives a client something to preview other than the heading twice', () => {
    const message = rendered().html;
    expect(message).toContain('Set up your account at Acme Corp');
    expect(message).toContain('mso-hide:all');
  });
});

describe('the company mark', () => {
  it('shows a hosted logo above the heading', () => {
    const message = rendered({ logoUrl: 'https://x.public.blob.vercel-storage.com/acme.png' });
    expect(message.html).toContain('src="https://x.public.blob.vercel-storage.com/acme.png"');
    expect(message.html).toContain('alt="Acme Corp"');
  });

  it('omits the row entirely when there is no logo', () => {
    // Not an empty image, and not a gap where one would have been. The heading
    // takes the card's top padding back.
    const message = rendered({ logoUrl: null });
    expect(message.html).not.toContain('<img');
  });

  it('drops a data URI rather than shipping a broken image box', () => {
    // The seed script's placeholder logo is one of these. Gmail renders none
    // of them.
    const message = rendered({ logoUrl: 'data:image/png;base64,iVBORw0KGgo=' });
    expect(message.html).not.toContain('<img');
  });

  it('escapes a hostile alt text', () => {
    const message = rendered({
      companyName: '"><script>alert(1)</script>',
      logoUrl: 'https://acme.example/l.png',
    });
    expect(message.html).not.toContain('<script>');
  });
});

describe('the plain-text part says everything the HTML does', () => {
  it('carries the address, the link, the deadline and the reason', () => {
    // A corporate gateway that strips HTML would otherwise deliver an empty
    // invitation to exactly the deskless population this product is for.
    const message = rendered().text;
    expect(message).toContain('ada@acme.example');
    expect(message).toContain(invitation.enrolUrl);
    expect(message).toContain('27 August 2026 at 09:05 UTC');
    expect(message).toContain('Acme Corp');
    expect(message).not.toContain('<');
  });
});

describe('the parts that make it read as ours', () => {
  it('carries the accent rule across the top of the card', () => {
    // The one piece of ornament, and it earns its place: it is what makes the
    // card read as Kithena at a glance in a crowded inbox.
    expect(rendered().html).toContain(`background:${light['accent-solid']};">&nbsp;`);
  });

  it('explains what a passkey actually does, in order', () => {
    // "No password to choose" raises more questions than it answers for
    // somebody who has never seen a passkey, which is most people receiving
    // this.
    const message = rendered();
    expect(message.html).toContain('What happens next');
    expect(message.html).toContain('fingerprint, face or PIN');
    expect(message.html).toContain('Nothing leaves your device');
    for (const n of ['1', '2', '3']) {
      expect(message.html).toContain(`>${n}</span>`);
    }
    // And the same three, in the same order, for a client that strips HTML.
    expect(message.text).toContain('1. Your device asks for your fingerprint');
    expect(message.text).toContain('2. That becomes your passkey');
    expect(message.text).toContain('3. You sign in to Acme Corp');
  });

  it('uses the wash pair for the chips, never the solid fill', () => {
    // `tokens.css` names this mistake: `accent-fg` on a saturated fill measures
    // about 1.5:1 and merely looks "a bit low". The subtle wash is the pair
    // chosen to clear contrast.
    const message = rendered().html;
    expect(message).toContain(`background:${light['accent-subtle']};color:${light['accent-fg']}`);
  });

  it('states the deadline once, as a badge rather than a sentence', () => {
    const message = rendered().html;
    expect(message).toContain('Works once');
    expect(message).toContain('border-radius:999px');
    expect(message).toContain('27 August 2026 at 09:05 UTC');
  });

  it('demotes the fallback link rather than leading with it', () => {
    // It was the loudest thing on the page: a 43-character token wrapped over
    // three lines in accent blue, directly under the button it duplicates.
    // Muted, and below the fine print, it is there for whoever needs it.
    const message = rendered().html;
    const button = message.indexOf('Set up your account</a>');
    const fallback = message.indexOf('Button not working?');
    expect(button).toBeGreaterThan(-1);
    expect(fallback).toBeGreaterThan(button);
    expect(message).toContain('<a href="https://auth.app.kithena.com/enrol?tenant=acme&amp;');
  });
});
