# Messaging

How a person is told something. Today there is exactly one thing to tell them:
that an account is waiting for them at a company, and here is how to set it up.

---

## The short version

**`platform/messaging` is a platform service, not a module.** Nobody buys it,
every tenant has it, and `ModuleKey` correctly does not list it — the same
argument `docs/authentication.md` makes for identity, and the reason
`pnpm-workspace.yaml` has a `platform/*` entry at all.

**It holds one table, and refuses to hold a second column.** `messaging.delivery`
records outcomes: who, what kind, which provider, what the provider called it,
how it ended. No body, no subject, no link — [the section
below](#what-it-refuses-to-hold) explains why that is a boundary rather than a
gap.

**Resend is the provider**, behind a port called `EmailTransport` that names one
recipient, a subject and two bodies. Swapping providers is one file.

**With no `RESEND_API_KEY` it prints the message instead of sending it**, and
says so. That is what `just auth-dev` and `just admin-dev` give you, and it is
the only way to walk the enrolment flow repeatedly — the link is single-use, so
every walk needs a fresh one.

**Identity calls it over HTTP.** It is not imported, and that is not ceremony:
identity holds the signing key and the one plaintext copy of an enrolment token,
messaging holds a third party's API key and talks to the public internet on
every request.

**The email is Reach, resolved.** Every colour in the template is a
`--reach-color-*` token converted to sRGB, because no mail client resolves
`oklch()`. `pnpm email:theme-drift` fails if one of them moves — see [Why the
email is the design system](#why-the-email-is-the-design-system).

---

## The flow

```
back-office ──POST /api/internal/admin/tenants/<id>/invitations──▶ identity
                                                                     │
                          creates the account, mints the token,      │
                          builds the enrolment link                  │
                                                                     ▼
                            POST /api/internal/messaging/invitation
                                                                     │
                                                                     ▼
                                                                 messaging
                                                                     │
                                              renders, and asks Resend to send
                                                                     ▼
                                                        the person's mailbox
                                                                     │
                             click ──▶ auth origin /enrol?…&name=<their address>
```

The last hop is the second half of the brief: the enrolment page reads `name`
from the link and shows it before the device prompt appears. One device holds
passkeys for several accounts — a contractor at three customers, someone testing
two environments — and the system prompt only shows what it was told at
registration. Saying it on the page as well means the choice is made before the
prompt rather than guessed at inside it.

### Endpoints

| Method | Path                                             | Who calls it                 |
| ------ | ------------------------------------------------ | ---------------------------- |
| `POST` | `/api/internal/admin/tenants/<uuid>/invitations` | the back-office, on identity |
| `POST` | `/api/internal/messaging/invitation`             | identity, on messaging       |
| `GET`  | `/healthz`                                       | a deploy, on messaging       |

Both `POST`s are guarded by `INTERNAL_API_TOKEN`, compared in constant time by
`presentsInternalToken` in `@kithena/auth-kit`. `/healthz` is not, and returns
nothing worth having — a status and which transport is composed. Putting the
shared secret into a smoke test is how the shared secret reaches a workflow log.

### What the invitation reports back

```json
{
  "accountId": "af9da7d6-…",
  "email": "grace.hopper@acme.example",
  "enrolUrl": "https://auth.app.kithena.com/enrol?identity=…&tenant=acme&token=…&name=…",
  "expiresAt": "2026-08-26T22:33:03.561Z",
  "delivery": { "delivered": true, "messageId": "…", "reason": null }
}
```

`delivery` is separate from the status code on purpose. `201` means an account
and a live enrolment token now exist; whether the message arrived is a different
question, and the operator has to be able to see that the answer is no. When it
is no, `enrolUrl` is the fallback — and handing that link over in person is the
channel `docs/authentication.md` prefers anyway.

`employmentStart` and `timeZone` are echoed because they are load bearing rather
than decorative. `Account.enrol` refuses a passkey before the start date, so an
account commissioned with today's date can be enrolled the moment the link
arrives — right for somebody starting today, wrong for a hire entered three
weeks early. Omit them and the invitation is against today in UTC; send them and
the gate does what it exists for. A date more than two years out is refused,
because that is the shape a mistyped year takes.

### The events it raises

Creating an account raises `identity.account.provisioned` and issuing the link
raises `identity.account.invited`, both into `platform.outbox` in the same
transaction as the rows. Both were defined in `packages/contracts` and raised by
nothing until this landed, because accounts were created by two raw INSERTs in
the composition root — so the audit trail HR is entitled to began at enrolment
rather than at hire.

`account.provisioned` is the one event an account raises whose envelope carries
an `effectiveFrom`: the employment start date. A consumer deciding whether this
hire is live yet reads the envelope, not a payload field whose name it would
have to know.

The enrolment token is not in either event. `account.invited` carries its expiry
and its second channel, and nothing else — which is why messaging cannot be a
consumer of the topic and has to be handed the link by the service that minted
it.

---

## What it refuses to hold

There is no body column on `messaging.delivery`, no subject, and above all no
link — and an integration test asserts the exact column list, so adding one is a
decision somebody has to make on purpose.

The enrolment link is the one secret that passes through this service.
`platform.enrolment_token` stores only its SHA-256, precisely so that a backup, a
replica or a support query yields nothing usable. A rendered message in a table
would undo that in one column, and it is the easy thing to add.

What is recorded is the outcome, which is what the questions are actually about:
HR asks "did the invitation go out", and an operator asks "why not".

### Two states, and only one of them is knowable at send time

`accepted` is what the send path writes. A provider queueing a message is not a
mailbox receiving one — a mistyped work address is accepted, queued, and
rejected by the receiving server minutes later.

`delivered`, `bounced`, `complained` and `suppressed` arrive by webhook, and that
is the whole reason the webhook exists. Without it a bounced invitation stays
recorded as having gone out fine, a new hire cannot log in, and nobody can say
why.

A `delivered` message is never moved backwards. Providers do not guarantee order,
so a `delivered` arriving after a `delivery_delayed` is the normal case, and
applying events as they land would leave a message that reached the mailbox
recorded as still in trouble.

### The events deliberately ignored

`email.sent` is what the send path already recorded. `email.opened` and
`email.clicked` are engagement tracking, and this is a transactional message to
an employee rather than a marketing campaign — recording who opened their own
invitation is surveillance we have no reason to do and would then have to
declare. `email.delivery_delayed` is transient and the provider retries by
itself.

### Isolation

`messaging.delivery` carries row-level security keyed on `tenant_id`, with FORCE,
and `svc_messaging` is `NOBYPASSRLS`. One customer's support query cannot read
another's, and `delivery-log.integration.test.ts` proves it against a real
Postgres rather than against a fake that would only agree with the code.

The webhook is the exception that proves the rule. A provider event names a
message and no tenant, because the provider has never heard of our tenants — so
finding the row has to cross every one of them, which is exactly what the policy
forbids. `messaging.delivery_tenant_of` is a `SECURITY DEFINER` function scoped
to that one question, with a pinned `search_path`, returning only the row's own
tenant. It cannot enumerate and it cannot see a body, because there is none.

---

## Why the email is the design system

The template is `packages/ui` written out longhand, and it has to be: the
dependency-cruiser rule `no-design-system-in-services` forbids `platform/*` from
importing `packages/ui`, and correctly — a service has no user interface. An
email is the one exception that cannot live anywhere else.

So the values are copied and a drift check pays for the copy. That is the same
trade `apps/storybook/.storybook/reach-tokens.json` makes for Storybook's
manager, and the same one `packages/ui/src/brand/kithena-mark-data-uri.ts` makes
for the mark.

**Colour.** `platform/messaging/src/message/domain/palette.ts` holds every
`--reach-color-*` the template paints, resolved to sRGB. `pnpm email:theme-drift`
reads `packages/ui/src/styles/tokens.css`, follows the `var()` chain, converts
from OKLCH, and fails if any line has moved. The conversion itself is checked
against `reach-tokens.json` — which a _browser_ produced — so it is verified
against the renderer it stands in for rather than against itself.

**Everything else.** The card is `Card variant="outlined"`: `surface`, a
`border` line rather than a shadow, `--radius-lg`, `p-5`. The button is `Button
variant="primary" size="lg"`: `accent-solid` on `fg-on-accent`, `--radius-md`,
`--reach-control-lg` (44px, which is also the WCAG 2.2 target floor),
`--text-md`, medium. Type comes from the Reach scale with its size-specific
tracking. These are named in comments rather than checked mechanically, because
only the colours are values a machine can compare.

### Why it still looks like 2004 underneath

Outlook on Windows renders through Word. No flexbox, no grid, no
`border-radius`, and a `<style>` block it feels free to ignore; Gmail strips the
`<head>` on some clients. So the layout is tables and the styling is inline.

The primary action is written twice — a VML `roundrect` inside an MSO
conditional, and an anchor for everyone else — because Word ignores both
`border-radius` and `padding` on a link, and Outlook would otherwise get a
square, unpadded, hard-to-hit target instead of the same 8px corner and 44px
height as every other client.

### Dark mode, and the client that will not play

The inline styles are the light theme, because inline is the only thing every
client honours. A `<style>` block adds the Reach dark palette for the clients
that keep it _and_ report `prefers-color-scheme` — Apple Mail, iOS Mail,
Outlook.com.

Gmail keeps neither and force-inverts instead. That is why the page colour is
`--reach-color-canvas` rather than white: an inverted `#f9fafb` is a usable
dark, and an inverted `#ffffff` is not.

### The mark

The Kithena wordmark is type, not an image. Gmail does not render `data:` image
sources at all and Outlook desktop will not render SVG, so the mark would be a
broken-image box for most of the people receiving this.

The _company's_ logo is shown when there is one, because a hosted `https:` URL
does render. It goes through `brandingFor` first, so a company that has asked
not to be displayed on surfaces it does not control gets a clean message — an
email is forwarded, which is exactly the case that flag is for. The company
_name_ is not gated: it is in the subject line, and an invitation that will not
say which company it is for is not an invitation.

The tenant's own accent colour is deliberately not used for the button. It is a
value a customer picks, and white on an arbitrary accent is a contrast failure
waiting to happen; the mark and the name carry their identity instead.

---

## Configuration

| Variable             | Where     | Notes                                                                                  |
| -------------------- | --------- | -------------------------------------------------------------------------------------- |
| `MESSAGING_URL`      | identity  | Absent means invitations are not emailed. Supported, not broken.                       |
| `INTERNAL_API_TOKEN` | both      | The same value on both sides.                                                          |
| `AUTH_ORIGIN`        | both      | Messaging refuses to mail a link pointing anywhere else.                               |
| `RESEND_API_KEY`     | messaging | Absent locally. Required in production, where the service refuses to start without it. |
| `RESEND_FROM`        | messaging | `Name <address@verified-domain>`.                                                      |
| `RESEND_REPLY_TO`    | messaging | Optional, and worth setting. People answer these.                                      |

### Before the first real send

1. **Verify the sending domain in Resend**, and make `RESEND_FROM` match it
   exactly. A `from` on `kithena.com` against a key verified for
   `send.kithena.com` is a 403 at send time, not at deploy time.
2. **Keep click and open tracking off for that domain.** Click tracking rewrites
   every link through Resend's own host, which would both hand the single-use
   enrolment token to a third party and change the origin the enrolment ceremony
   checks — the single most important setting on this page. Open tracking adds a
   pixel, and this is a transactional message to an employee rather than a
   campaign. Both are already off on `send.kithena.com`.
3. **Publish SPF, DKIM and DMARC** as Resend's dashboard instructs. An
   invitation in a spam folder is a new hire who cannot start.
4. **Warm the domain up.** A new domain is limited to roughly 150 sends on day
   one.
5. **Verify the domain.** `send.kithena.com` is created in Resend with tracking
   off; it needs three DNS records at the registrar before it can send. Run
   `verify-domain` once they have propagated.
6. **Add the webhook.** Point it at `https://messaging.<env>.kithena.com/api/webhooks/resend`,
   subscribe to `email.delivered`, `email.bounced`, `email.complained` and
   `email.suppressed`, and put its signing secret in `RESEND_WEBHOOK_SECRET`.
   Without this a bounced invitation stays recorded as accepted.

Test addresses: `delivered@resend.dev`, `bounced@resend.dev`,
`complained@resend.dev`. Never test with a plausible-looking address at a real
provider — it bounces, and bounces are what get a sending domain suppressed.

---

## What it deliberately does not do

**It does not make the emailed link sufficient.** `docs/authentication.md` is
explicit that SP 800-63B-4 deprecates email OTP and that enrolment is a
two-channel ceremony. Today `second_channel` is _recorded_ — the invitation
endpoint takes it, `identity.account.invited` carries it — and not _enforced_:
the link alone still admits somebody. So the copy in the message says nothing
about a second channel, because saying it would be a claim the code does not
honour. When enforcement lands, the copy changes with it.

**It does not track who read their own invitation.** `email.opened` and
`email.clicked` are subscribed to by nobody and ignored if they arrive. This is
a transactional message to an employee, and recording their engagement with it
is surveillance we would then have to declare.

**It does not use the tenant's accent colour.** See [the mark](#the-mark).

---

## Locally

```bash
just admin-dev                      # messaging, identity, the auth origin, the back-office
just invite <tenant-uuid> <email>   # the same endpoint the back-office calls
```

With no `RESEND_API_KEY`, the message is printed by the messaging process rather
than sent. Copy the link out of it and open it.
