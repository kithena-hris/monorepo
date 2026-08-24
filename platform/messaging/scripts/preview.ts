import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { toAddress } from '../src/message/domain/address.js';
import { renderInvitation } from '../src/message/domain/invitation.js';

/**
 * The invitation, rendered to a file you can open.
 *
 * Sending a real message to look at it is a bad loop: the enrolment link is
 * single-use, a real send costs a real address, and a bounce off a typo hurts
 * the sending domain's reputation. The template is a pure function over a
 * struct, so it can simply be called.
 *
 * This is also the only practical way to check the parts a unit test cannot
 * assert — whether the type scale reads, whether the card sits right, whether
 * dark mode is legible. Open the file in a browser, and toggle your OS theme to
 * see the `prefers-color-scheme` block.
 *
 * Lives here rather than in `tools/` because that directory belongs to the root
 * package, which cannot resolve this one's modules — the same reason
 * `platform/identity/scripts/seed-auth.ts` lives where it does.
 *
 * Usage:
 *   npx tsx platform/messaging/scripts/preview.ts [--logo <url>] [--out <path>]
 */
function flag(name: string): string | undefined {
  const at = process.argv.indexOf(`--${name}`);
  return at === -1 ? undefined : process.argv[at + 1];
}

const recipient = toAddress(flag('email') ?? 'grace.hopper@acme.example');
if (!recipient.ok) throw new Error('that is not an address a message can go to');

const rendered = renderInvitation({
  companyName: flag('company') ?? 'Acme Corp',
  recipient: recipient.value,
  // Four parameters, and a token of realistic length: the wrapping of a long
  // URL is one of the things worth looking at, and a short placeholder would
  // not wrap. Obviously a fixture rather than random, so it cannot be mistaken
  // for a credential by a scanner or by a reader.
  enrolUrl:
    'https://auth.app.kithena.com/enrol' +
    '?identity=01a030bf-dbbd-7173-adf6-0760f36e4cbe' +
    '&tenant=acme' +
    '&token=ENROLMENT-TOKEN-FIXTURE-NOT-A-REAL-CREDENTIAL' +
    `&name=${encodeURIComponent(recipient.value)}`,
  expiresAt: flag('expires') ?? '2026-08-27T09:05:00.000Z',
  // Only an `https:` URL renders; a `data:` URI is dropped, because Gmail will
  // not show one. Pass `--logo` to see the co-branded version.
  logoUrl: flag('logo') ?? null,
});

if (!rendered.ok) throw new Error(`the message could not be rendered: ${rendered.error.code}`);

/*
 * A private directory, not a predictable name in the shared one.
 *
 * `join(tmpdir(), 'kithena-invitation.html')` is a path any local user can
 * guess, and `writeFileSync` follows symlinks — so another account on the same
 * machine can create that name pointing at a file the developer running this
 * can write, and this clobbers it. CodeQL flags it as `js/insecure-temporary-file`
 * and is right to: the fact that this is a development script does not make the
 * developer's own home directory a safe thing to overwrite.
 *
 * `mkdtempSync` creates a uniquely named directory with 0700 permissions, so
 * there is nothing to guess and nothing for anybody else to have created first.
 */
const out = flag('out') ?? join(mkdtempSync(join(tmpdir(), 'kithena-email-')), 'invitation.html');

// `wx` fails if the path already exists rather than following a link to
// somewhere else. Redundant inside a directory we just created, and free.
writeFileSync(out, rendered.value.html, { flag: flag('out') === undefined ? 'wx' : 'w' });

process.stdout.write(
  [
    '',
    `Subject: ${rendered.value.subject}`,
    '',
    rendered.value.text,
    `HTML written to ${out}`,
    '',
  ].join('\n'),
);
