# The Dunder Mifflin demo company

How to put _The Office_'s paper company into a deployment, the way a customer
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

## Acme's Platform team, in Time Off

Locally, `pnpm db:seed` ends with Time Off's seed
(`services/timeoff/src/seed/acme.ts`): Acme's Platform team as the Time Off
design draws it, as of Thursday 1 October 2026, 12:33 in Madrid. Acme is
found by its slug in `platform.tenant`; nothing else is read from another
module, and the team is Time Off's own members, imported the way a company
without People would, so they are not the People roster above. Running it
again changes nothing: it stops when Adam is already there.

- **The team**: Marco Ruiz manages Adam Novak, Omar Haddad, Yuki Sato, Leo
  Rossi, Hana Kim and Ravi Patel, all in Madrid. Ada Lovelace is HR; she is an
  account, not a member, and her `hr_admin` comes from the authorization
  model, not from this seed: identity's seed names her Time Off's
  administrator, and `pnpm db:seed` pipes that event into Time Off's seed,
  which hands it to Time Off's consumer, as People's seed does with its own.
- **Signing in**: identity's seed invites an account for each of the seven,
  `first.last@acme.example` (account ids `7ac0e000-0000-4000-8000-0000000000a1`
  to `…a7`, Marco first, repeated in `acme.ts`), and prints an enrolment link
  for each still invited. Each member carries that account, so enrolling as
  Adam and opening Time Off shows Adam. With `OPENFGA_URL` set, the seed also
  makes Time Off's store and model and writes the team's tuples, so Marco
  approves.
- **Leave types**: Spain's statutory ones from the country pack, plus a
  personal day (3 a year) and comp time, in hours.
- **Policies**, published from 1 January 2026 and only for Spain: vacation 25
  days by tenure (26 from 3 years, 27 from 6, 28 from 10), credited a twelfth
  on the 1st of each month, 5 days carried to 31 March, up to 3 below zero
  approved by the manager then HR.
- **Holidays**: Spain, the Comunidad de Madrid and Madrid city, assigned to
  the `madrid` location. **Approval**: the manager; below zero, the manager
  then HR. **Team minimum**: Platform, 5 of 7 in. **Schedules**: everyone
  09:00–17:30, Monday to Friday, half an hour's break.
- **Adam**, T1's numbers: 11.5 days of vacation left (4.167 carried in, ten
  monthly credits of 25, 10.5 taken, 3 booked for 10–12 November), 2 personal
  days of 3 (one taken on 4 September), 6 hours of comp time. His punches for
  the week of 28 September are T20's, Wednesday without its clock-out and
  Thursday still clocked in.
- **October**, the design's `OFF`: Marco 13–16, Omar 19–21, Yuki a personal
  day on the 21st, Leo 26–30, Hana sick on the 1st and 2nd, Ravi a comp day on
  the 9th, all approved.

**Adam's 19–23 October is deliberately missing.** It is the request T3 shows
him sending: the panel's 11.5 → 6.5 and its warning that Wednesday 21 drops
to 4 of 7 only read true while it is unsent. Send it as Adam, and the
calendar (T12, T13) and Marco's queue show it pending, as drawn.

Ravi's comp day costs 1 hour, not 8: the application books an hour-unit
request's working days as hours until it has a day-to-hours rule.

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
