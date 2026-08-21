# Build plan

What we are actually building, in plain words.

Background and reasoning live in [authentication.md](./authentication.md) and
[auth-administration.md](./auth-administration.md). This file is the how.

---

## The whole thing in one picture

```
  BROWSER
     │
     │  acme.app.kithena.com                    auth.app.kithena.com
     ▼                                                   │
  ┌─────────────────────────────────┐          ┌─────────┴─────────┐
  │  SHELL  (Modern.js)             │          │  AUTH  (Modern.js)│
  │  • routing and layout           │          │  • login screens  │
  │  • reads the session cookie     │          │  • passkey setup  │
  │  • calls GraphQL, passes props  │          │  • recovery       │
  └───┬──────────────────────┬──────┘          └─────────┬─────────┘
      │ loads at runtime     │ /api/graphql              │ HTTP
      ▼                      ▼                           ▼
  ┌────────┐ ┌────────┐  ┌────────────┐          ┌────────────────┐
  │ people │ │timeoff │  │   ROUTER   │          │   IDENTITY     │
  │  UI    │ │  UI    │  │ (Cosmo)    │          │ (platform)     │
  └────────┘ └────────┘  └──────┬─────┘          └───┬────────┬───┘
   remotes, loaded as           │                    │        │
   components, no data          ▼                    ▼        ▼
   fetching of their own  ┌──────────┐          ┌────────┐ ┌──────┐
                          │ people   │          │Postgres│ │Valkey│
                          │ timeoff  │◀────────▶│        │ │      │
                          └──────────┘ Redpanda └────────┘ └──────┘
```

Five rules that explain most of the diagram:

1. **The shell owns everything shared** — routing, layout, session, data fetching.
2. **Remotes are dumb.** They export components. They get data as props. They
   never fetch, never touch the session.
3. **The browser never holds a token.** Cookie in, cookie out. Anything that needs
   a token happens on a server.
4. **Services never call each other.** They publish events to Redpanda.
5. **Auth is not a remote.** Separate origin, separate app, ordinary imports.

---

## Frontend

### The apps

One folder per origin, because an origin is a cookie boundary, a WebAuthn
boundary and a deploy boundary at once. Full layout and naming rules in
[code-structure.md](./code-structure.md).

| Folder             | What it is                                    | Runs on                |
| ------------------ | --------------------------------------------- | ---------------------- |
| `apps/web/shell`   | The host. Routing, layout, session, GraphQL   | `acme.app.kithena.com` |
| `apps/web/people`  | Remote. People screens                        | loaded by the shell    |
| `apps/web/timeoff` | Remote. Time Off screens                      | loaded by the shell    |
| `apps/auth/shell`  | Login, passkey setup, recovery. Not federated | `auth.app.kithena.com` |
| `apps/admin/shell` | Back-office for the CX team                   | `admin.kithena.com`    |

`packages/ui` (Reach) stays exactly as it is. Everyone imports it normally; Module
Federation shares one copy at runtime.

### What the shell does on every page load

1. Read the `Host` header, work out the tenant. `apps/web/src/lib/tenant.ts`
   already does this and does no I/O, so it **moves across unchanged**.
2. Read the session cookie. Look the session up (Valkey first, Postgres if it
   misses).
3. If there is no session, redirect to the login page.
4. Look at the URL, find which remote owns it in the route manifest.
5. Fetch the data that screen needs, in one GraphQL call.
6. Load the remote component and render it with that data as props.
7. Stream the HTML out. The browser hydrates.

### The route manifest

A plain list the shell reads at startup:

```
/people/*      → ui-people    → PeopleDirectory
/people/:id    → ui-people    → PersonProfile
/timeoff/*     → ui-timeoff   → LeaveCalendar
```

**Fetch it at runtime, do not bake it into the bundle.** Baked in, adding a screen
to Time Off means redeploying the shell, and then the remotes are not independent
after all.

### Why remotes do not fetch their own data

Modern.js has a way for remotes to fetch during SSR (`[name].data.ts`), and its
own documentation calls it "experimental and has not been fully practiced."

We do not need it. The shell already talks to a federated GraphQL router that can
answer for every module in one query. So the shell fetches and passes props down.
Remotes stay simple, the experimental path is never used, and one round trip
serves the whole page.

### Rules the build enforces

Added to `.dependency-cruiser.cjs`, same spirit as the backend rules:

- A remote may not import another remote.
- A remote may not import `@kithena/contracts`, a database client, or anything
  that talks to a server.
- Only the shell and `apps/auth` may read the session.

### Getting there

1. Stand up `apps/web/shell` in Modern.js. One route, no federation. Prove SSR works
   and `@reach/ui` compiles.
2. Move `tenant.ts` and its tests across. Rewrite `proxy.ts` as Modern.js
   middleware — **port the tests first**, this file is what keeps tenants apart.
3. Turn on Module Federation with one remote that renders "hello". Prove it loads
   at runtime and survives a rebuild of the remote alone.
4. Add the route manifest.
5. Build `apps/auth/shell`. Plain Modern.js, no federation.
6. Then real screens.

Do not skip step 3. If a remote cannot ship a fix without rebuilding the shell,
the federation is decoration and it is better to find that out on "hello".

---

## Backend

### The services

| Folder              | What it does                                     | Port |
| ------------------- | ------------------------------------------------ | ---- |
| `platform/identity` | Accounts, credentials, sessions, tenant registry | 4100 |
| `services/people`   | Employees, org chart                             | 4001 |
| `services/timeoff`  | Leave                                            | 4002 |
| `apps/gateway`      | Cosmo Router. Composes the subgraphs             | 4000 |

`platform/` is a new folder next to `services/`. Identity is not a module — nobody
buys it, every tenant has it — so it does not belong in `services/`.

> Fix on the way in: `.env.example` says `AUTH_ISSUER=http://localhost:4000` and
> the router already listens on 4000. Identity goes on 4100.

### How they talk

**They mostly do not.** Three paths only:

| From → to             | How                                  |
| --------------------- | ------------------------------------ |
| Shell → subgraph data | GraphQL, through the router          |
| Auth app → identity   | Plain HTTP with Zod, not GraphQL     |
| Service → service     | Redpanda events. Never a direct call |

Why auth is not GraphQL: login happens before there is a session, the endpoints
set cookies and follow redirects, and they speak fixed formats (OIDC, WebAuthn).
None of that is GraphQL-shaped. It also means anyone can build their own login UI
against the same API, which is what makes headless mode work.

### What identity owns in the database

Four tables in the `platform` schema:

```
identity     one row per human, worldwide.  Just an opaque id.
credential   passkeys and linked Google accounts.  Points at identity.
account      one row per (human, company).  Tenant-scoped, RLS on.
session      one row per logged-in device.  Tenant-scoped, RLS on.
```

The split matters for one reason: **a contractor working for three customers is
one `identity` with one passkey and three `account` rows.** If accounts held the
credentials, they would need three passkeys.

A new `svc_identity` database role, created `NOBYPASSRLS`, same as the existing
`svc_people` and `svc_timeoff`.

### How accounts get created

Two ways in, one thing they do:

```
HR adds a hire in the People module
   └─▶ people.person.hired event on Redpanda
        └─▶ identity consumes it, creates an account

CX creates a company in the back-office
   └─▶ POST /accounts on identity, directly
        └─▶ creates the first HR account
```

Identity reads the People **contract**, not the People **code**. That is the rule
that lets Time Off be sold to a Workday shop with no People module — the second
path still works.

### How access gets taken away

```
people.person.terminated  (carries the last working day)
   └─▶ identity consumes it
        └─▶ at end of that day, in the person's own timezone:
             delete every session row
             add them to the revoked list in Valkey
             mark the account terminated
```

The timezone matters. A last working day is a date, not a moment. Ending it at
UTC midnight logs Californians out mid-afternoon.

The account row is **not** deleted. Employment records outlive employment.

---

## Sessions and caching

You asked whether Redis fits here. Yes, but not for the part you might expect.

### Postgres is the truth. Valkey is the speed.

|                               | Postgres        | Valkey (Redis)  |
| ----------------------------- | --------------- | --------------- |
| Is a session valid?           | the real answer | the fast answer |
| Enforce max 4 devices         | **yes**         | no              |
| Survives a restart            | yes             | no              |
| Audit: who was logged in when | yes             | no              |
| Speed of a lookup             | ~1–3 ms         | ~0.2 ms         |

Valkey is already in `docker-compose.yml`. It is a drop-in Redis fork, so
everything below is ordinary Redis.

### Why the device limit lives in Postgres, not Redis

Redis _could_ do it. A Lua script is atomic, so you could count and insert safely.

The problem is not atomicity, it is **having two answers**. If Redis holds the
count and Postgres holds the rows, a Redis restart resets the count to zero while
Postgres still has four rows. Now the limit is silently five, then six. Nobody
notices, because nothing is broken enough to page anyone.

`CLAUDE.md` already settles this: where a race is possible, the database
constraint is what enforces it.

### How the limit actually works

Every session takes a numbered **slot**, 1 to 4:

```
session
  account_id
  slot         1 | 2 | 3 | 4
  UNIQUE (account_id, slot)
```

Logging in:

1. Look for a free slot.
2. Insert into it.
3. If someone else grabbed it a millisecond earlier, the unique index rejects the
   insert. Retry with the next slot.
4. If all four are taken, delete the least recently used one and take its slot —
   in the same transaction.

The database cannot produce a fifth row. Not "we check carefully" — cannot.

Making the limit configurable per tenant just changes the range check. The
uniqueness is what does the work.

### What Valkey actually does

Four jobs, and all four are things Redis is genuinely the right tool for:

| Key              | Holds                          | Expires      | Why Redis                                   |
| ---------------- | ------------------------------ | ------------ | ------------------------------------------- |
| `session:<id>`   | account, tenant, expiry, `amr` | idle timeout | Read on every request                       |
| `revoked:<id>`   | tombstone                      | 5 min        | Kills a token before it expires on its own  |
| `challenge:<id>` | WebAuthn challenge             | 60 s         | Single use, must vanish, must never persist |
| `ratelimit:*`    | counters                       | seconds      | Counters with expiry are what Redis is for  |

### Reading a session, step by step

```
request arrives with cookie  __Host-ksession = abc123
   │
   ├─ GET session:abc123 from Valkey
   │     ├─ hit  → done.  ~0.2 ms
   │     └─ miss → SELECT from Postgres
   │                 ├─ found   → write it back to Valkey → done
   │                 └─ nothing → no session → redirect to login
   │
   └─ wrap in React cache() so one page render = one lookup
```

### Writing, and the order that matters

**Login:** write Postgres first (that is where the limit is enforced), then
Valkey.

**Logout or revoke:** delete from **Valkey first**, then Postgres.

That order is deliberate. If the Postgres delete then fails, the next request
misses the cache, reads Postgres, finds the session still alive, and puts it
back. The revoke simply failed, which is honest. Do it the other way round and a
failed Valkey delete leaves the cache serving a session that no longer exists —
a logout that did not log anyone out.

### What happens when Valkey dies

Nothing serious. Every session is still in Postgres. The first request for each
session misses, reads Postgres, and repopulates. The site gets slower for a
minute and nobody is logged out.

This is the main reason not to keep sessions only in Redis. Valkey in
`docker-compose.yml` has no persistence configured at all — restart it today and
everything in it is gone.

### Tokens, and why the browser never sees one

The browser holds a cookie. That is all.

When the page needs data, the **shell** does this on the server:

```
read cookie → look up session → mint a JWT that lives 120 seconds
            → call the router with it → return only the data
```

So:

- No token in JavaScript, so no token to steal with XSS.
- Client-side GraphQL calls go to the shell's own `/api/graphql`, which does the
  same thing. Same rule after hydration as during SSR.
- Subgraphs verify the JWT against a JWKS URL. **They never call identity**, which
  is what keeps `just standalone timeoff` true.
- Revocation is at most 120 seconds behind, and for terminations the router also
  checks the revoked list, which makes it immediate.

---

## What we tackle now

Six steps. Each one ends with something you can see working.

### 1. Scaffolding

Add `platform/*` and `apps/*/*` to `pnpm-workspace.yaml`. Create `svc_identity`.
Widen the `no-domain-importing-infrastructure` rule so it still matches once
slices exist — see [code-structure.md](./code-structure.md#the-rule-this-quietly-breaks). Move the tenant
registry lookup out of `apps/web` and into identity on port 4100. Add the
dependency-cruiser rules for the platform tier.

_Done when:_ `pnpm boundaries` passes and a service on 4100 answers a tenant
lookup.

### 2. The shell, without federation

`apps/web/shell` in Modern.js. Move `tenant.ts` across with its tests. Rewrite the
proxy as middleware. One page that says which tenant you are on.

_Done when:_ `acme.app.localhost:3000` renders "acme" and `nope.app.localhost:3000`
404s, with the existing tests green.

> `apps/auth/shell` cleared the equivalent bar first, because auth is its own
> origin and does not wait for the tenant app. Three things the framework had
> to prove before anything was built on it: it builds, it server-renders — the
> copy is in the raw HTML rather than injected after hydration — and it
> compiles `@reach/ui` from TypeScript source through `source.include`, the way
> Next does it through `transpilePackages`.

### 3. Federation on "hello"

One remote, `apps/web/people`, exporting one component. Wire up Module Federation.
Add the route manifest.

_Done when:_ you can change the remote, redeploy **only** the remote, refresh, and
see the change. If you cannot, stop and fix it here.

### 4. Contracts and the identity domain

`packages/contracts/src/events/identity.ts`, every field classified. Then the
domain layer, test-first: the account state machine, the slot rule, token
validity, step-up freshness.

_Done when:_ `pnpm codegen` passes and the domain tests are green with no database
running.

### 5. Tables and isolation

Migrations for the four tables. RLS with `FORCE` and the `NULLIF` form. Integration
tests against real Postgres, including one that fires concurrent logins and proves
a fifth session cannot exist.

_Done when:_ the concurrency test passes. Do not skip it — it is the whole reason
for the slot design.

### 6. Login, end to end

`apps/auth/shell`. Passkey registration and sign-in. The session cookie. Valkey caching.
The JWT minter and JWKS.

_Done when:_ a person enrols a passkey, signs in on the tenant site, and sees
their own name rendered server-side.

### After that

Google Workspace, then the termination consumer and the session list, then HR
settings and the back-office. Those are laid out in the two design docs.

The order matters in one place: **do not ship a login before the termination
consumer.** A system that creates access but cannot reliably remove it is not
half-finished, it is a liability.
