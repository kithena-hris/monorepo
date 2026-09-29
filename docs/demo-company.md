# The Dunder Mifflin demo company

How to put *The Office*'s paper company into a deployment, the way a customer
would set one up: the back office creates the company, its administrator signs
in, and everything else goes through People's own screens' operations.

Locally none of this is needed: `pnpm db:seed` already makes Dunder Mifflin
(`services/people/src/seed-companies.ts`). This is for staging and production,
where the seed never runs and nobody writes to a database by hand.

## What gets loaded

`apps/gateway/scripts/load-demo-company.ts` loads, from the same roster the
local seed uses:

- version 1 of the profile, as the setup wizard publishes it, in the company's
  country;
- the seed's fields (job title, department, working hours, work phone, start
  date, emergency contact, date of birth, marital status, partner, children,
  hometown), published together;
- four locations: Corporate (New York), Scranton, Nashua and Utica;
- 29 people with their work email (`first.last@dunder-mifflin.example`), start
  date and location, and Toby's own record completed and hired from his start
  date; Nellie Bertram starts in a fortnight and Gabe Lewis is added and not
  hired;
- everybody's job, department, reporting line and personal details;
- a photo for everybody who has none: an illustrated avatar drawn for each
  character (`services/people/src/seed-photos.ts`). No real photograph of
  anyone is used or downloaded.

Every step reads first and writes only what differs, so running it again
changes nothing. It does not delete: a person added by hand stays, and a photo
already there is kept. It does put back a roster value that was edited since —
a re-run after somebody renamed Michael's job restores it.

## How it authenticates

As Toby, through the router, and no other way. The script is a client of the
Cosmo Router at `api.kithena.com`, like the tenant app's own server
(`apps/web/src/lib/people.ts`):

1. It takes the session cookie of Toby's signed-in browser (`__Host-ksession`).
2. It asks identity for a five-minute access token for that session
   (`POST /api/internal/session/token`), again whenever one is about to lapse.
   That call needs identity's internal token, which is the one privileged
   value involved: it is what the tenant app's server presents for the same
   exchange. There is no customer-facing API credential for the router yet, so
   this is the only way a script can hold a token People accepts.
3. Every call is one of the tenant app's persisted operations
   (`apps/web/src/lib/people-operations.ts`), so the router's safelist lets it
   through, and People decides each one as it would for Toby at his desk:
   his roles, his audit trail, every validation.

It reads no table, holds no People secret and cannot do anything Toby could
not do in the browser.

## Runbook

### By hand, in the back office and a browser

1. **Create the company.** At `https://admin.kithena.com`, sign in with your
   operator passkey, and add a company:
   - slug `dunder-mifflin` (it becomes `dunder-mifflin.app.kithena.com`),
     name `Dunder Mifflin`;
   - registered address `1725 Slough Avenue`, `Scranton`, state `PA`,
     postcode `18505`, United States; time zone `America/New_York`;
   - modules: People;
   - administrators to invite: one, Toby, at an email address **you can
     receive mail at** (the enrolment link goes there, and it becomes Toby's
     work email and sign-in), named People's administrator.
2. **Enrol Toby.** Open the invitation, enrol a passkey, and give the name
   `Toby Flenderson` if asked. The script refuses to run as anybody whose name
   is not Toby's, because it completes the signed-in person's record as his.
3. **Sign in as Toby** at `https://dunder-mifflin.app.kithena.com` and open
   People once. That also wakes the VM if it was asleep.
4. **Copy the session cookie.** Developer tools → Application → Cookies →
   `https://dunder-mifflin.app.kithena.com` → `__Host-ksession` → its value.
   It is Toby's session: treat it as a password.
5. **Have identity's internal token to hand**: `INTERNAL_API_TOKEN` of the
   production identity project on Vercel (the tenant app holds the same
   value). Paste it into your shell only; never into a file in this
   repository.

### The script

From a checkout with dependencies installed (`pnpm install`):

```bash
export KITHENA_IDENTITY_URL=https://identity.kithena.com
export KITHENA_ROUTER_URL=https://api.kithena.com
export KITHENA_COMPANY=dunder-mifflin
read -rs KITHENA_INTERNAL_TOKEN && export KITHENA_INTERNAL_TOKEN   # paste, Enter
read -rs KITHENA_SESSION && export KITHENA_SESSION                 # paste, Enter

# What it would do: reads everything, writes nothing.
pnpm --silent --filter @kithena/gateway load-demo --dry-run

# Do it. About a minute; safe to run again if it stops part way.
pnpm --silent --filter @kithena/gateway load-demo

# Proof: a second run has nothing to do.
pnpm --silent --filter @kithena/gateway load-demo --dry-run
```

`--company`, `--identity` and `--router` override the environment. The two
secrets are read from the environment only, so they stay out of shell history
and off the command line. On a company where nothing is published yet, the dry run
stops after the setup, fields and locations it would add, because People has
nothing to read about people until version 1 exists.

For staging: `https://identity.staging.kithena.com`,
`https://api.staging.kithena.com`, and the company on
`dunder-mifflin.staging.app.kithena.com`.

### Afterwards, by hand

1. **Sign Toby out** in that browser. It ends the session, so the copied
   cookie is worthless from then on.
2. `unset KITHENA_INTERNAL_TOKEN KITHENA_SESSION`.
3. Look at People as Toby: the directory, the org chart from David Wallace
   down, and a few profiles.

## Things to know

- **The addresses are not real.** Everybody but Toby has a
  `@dunder-mifflin.example` work email, which no mail server accepts. Nothing
  loaded here sends them mail: no account is created for them, and on the
  local stack the roster leaves nobody with a detail of their own to fill in,
  so People's weekly reminder has nobody to write to. Adding a required field
  that employees fill in themselves would change that and send bouncing
  reminders from our domain, so do not add one to this company.
- **"The router did not answer (530)"** means the VM is asleep: open People
  in the browser, wait for it, and run again.
- **"Identity refused the session"** means the cookie is from a signed-out or
  expired session, or another company: sign in as Toby again and copy the new
  value.
- **Nothing here removes the company.** There is no path for that in the back
  office yet.
