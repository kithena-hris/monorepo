# Authentication

How a person proves who they are, which company they are proving it to, and
what the rest of the system is allowed to assume afterwards.

This is a plan, not a description. Nothing in it is built yet.

---

## The short version

Skip to any section for the reasoning. This is what it amounts to.

**We build the login system ourselves. We buy the enterprise plumbing later.**

Concretely, five sentences:

1. **Nobody signs up.** HR creates an account for a person; until they do, a
   perfectly valid Google account or passkey gets a refusal.
2. **Two ways in, no passwords at all.** Sign in with the company Google
   Workspace account, or with a passkey (Face ID, Touch ID, Windows Hello, a
   phone via QR).
3. **Login happens on the company's own address** — `apple.app.kithena.com/login`,
   branded as Apple's. Passkey sign-in completes right there with no redirect;
   Google bounces once through `auth.app.kithena.com`, because Google refuses
   wildcard callback URLs. Enrolling a new passkey is always on the auth origin.
4. **A session is a row in Postgres**, not a token. Four devices per person per
   company, enforced by a unique index. Logging out, being terminated, or being
   revoked by HR all mean deleting a row, and it takes effect within two minutes.
5. **Lost your device?** Your HR admin re-issues access after verifying you the
   way they already can. There is no "reset by email" link, so there is nothing
   to phish.

**What gets built:** one service (`platform/identity`) and one small web app
(`apps/auth`, roughly six screens). The cryptography is
`@simplewebauthn/server` and `jose`; the storage is the Postgres and Valkey
already in `docker-compose.yml`.

**What gets bought:** SAML and SCIM, in Phase 8, as connectors that hand us an
assertion and never own an account.

**What stays optional:** all of it. A customer with their own identity provider
can bypass this entirely and hand us their tokens — see
[Headless](#headless-bringing-your-own-identity). Configuration and support
access live in [auth-administration.md](./auth-administration.md).

**Why not Clerk or WorkOS:** both are US-only for data residency, and this
codebase already declares Spanish, German and EU payroll retention floors. More
decisively, every feature that makes this worth building — HR-mediated recovery,
effective-dated activation, termination-driven session kill — needs HR data no
identity vendor has.

**Why building is not reckless here:** dropping passwords deletes hashing,
rotation, reset flows and breach checks; dropping self-signup deletes email
verification, bot detection and abuse throttling. What remains is a WebAuthn
library, an OIDC client, and a session table.

---

## Three things in the brief that conflict with decisions already made

Raised first, because two of them change the shape of everything below.

### 1. tRPC between services is forbidden, and the build enforces it

`CLAUDE.md` says tRPC is permitted in `apps/admin` only, and
`.dependency-cruiser.cjs` fails any import of `@trpc` from `services/**` or
`packages/**`. So the "microservices talk over tRPC" half of the brief is not
something to design around — per the working agreement, it is flagged and
stopped rather than worked around.

The good news is that nothing here needs it. The synchronous surface splits
cleanly in two:

| Traffic                                    | Transport                              | Why                                                                                                                                                           |
| ------------------------------------------ | -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Browser → auth endpoints                   | plain HTTP + Zod                       | OIDC and WebAuthn have fixed wire formats. They set cookies, follow redirects and must be rate-limited _before_ a session exists. None of that is RPC-shaped. |
| Browser → domain reads and writes          | GraphQL through the Cosmo Router       | Already the decision                                                                                                                                          |
| Module → module                            | Redpanda events + `packages/contracts` | Already the decision, and the only thing keeping `just standalone` honest                                                                                     |
| Platform service → platform service, typed | Connect-RPC                            | The sanctioned escape hatch, if it is ever actually needed. It is not needed for auth.                                                                        |

Auth endpoints in particular should **not** be GraphQL fields. Login happens
before there is a principal, the router's persisted-operation safelist assumes
a client that has already booted, and `Set-Cookie` on a GraphQL mutation is a
transport smell. `auth.app.kithena.com` speaks HTTP and returns JSON validated
by the same Zod schemas.

### 2. "Host as containers" retires the deployment pipeline that just landed

`#10` and `#12` built a Vercel pipeline: preview per PR, a staging project, a
production project with an approval gate, migrations before deploy, promote-on-
smoke-test-failure rollback. `docs/environments.md` documents it in detail.

Containers behind your own ingress is the right call here — a single ingress
owning the origin is exactly what the cookie and WebAuthn design below needs —
but it makes that pipeline dead weight for the product apps. `apps/docs` and
`apps/storybook` are static and public and should stay where they are.

### 3. Passkeys are no longer a differentiator on their own

BambooHR shipped passkeys in November 2025 and Rippling supports them today.
Shipping "we have passkeys" in 2026 is table stakes, not a wedge.

What is still wide open, and what this plan aims at, is
[**recovery**](#recovery-is-the-actual-differentiator) — every passkey
deployment in this market falls back to an emailed reset link, which throws
away the phishing resistance the passkey was bought for. An HRIS is the one
product that can do better, because it is the system that already knows who
your HR department is.

---

## What makes HRIS authentication different

Four properties, and every decision below falls out of one of them.

1. **Nobody signs up.** Accounts are commissioned by someone with authority
   over the employment relationship. Self-service registration is not a feature
   that is switched off; it does not exist.
2. **Deprovisioning is a legal event, not a preference.** When
   `people.person.terminated` is emitted, access ends. Not at the next token
   expiry — then.
3. **One human, several employers.** Contractors, PEO accountants, people
   working a notice period at one company while onboarding at another. The
   identity has to survive crossing a tenant boundary; the _session_ must not.
4. **The people who most need to log in have the worst devices.** Warehouse,
   retail, care, hospitality. Shared terminals, no corporate email, no company
   phone. Designing only for the laptop-and-Google-Workspace population
   excludes most of the headcount in the industries that buy this.

---

## Where identity lives

**Not in `services/*`.** Every module in `services/*` is sellable alone, carries
an entitlement, and boots with no siblings. Identity is none of those things:
no customer buys it, every customer has it, and `ModuleKey` correctly does not
list it.

Proposal: a **platform tier**, a sibling of `services/`.

```
platform/identity/          the identity provider — accounts, credentials, sessions
platform/tenancy/           the tenant registry (migrations/…tenant_registry.sql already exists)
```

with `pnpm-workspace.yaml` gaining `platform/*` and two new dependency-cruiser
rules:

- `services/*` may not import `platform/*`. A module reaching into identity is a
  module that cannot boot alone.
- `platform/*` may not import `services/*`. Identity must not learn what a
  Person is.

**A module's only relationship with identity is a JWKS URL.** It verifies a
signed token and reads `Principal`; it never calls the identity service. This is
what keeps `just standalone timeoff` truthful, and it is what lets Time Off be
sold to a Workday shop that will point it at _their_ issuer. `auth-kit` should
therefore accept a set of trusted issuers per tenant rather than one global
issuer constant.

> **Concrete fix needed:** `.env.example` has `AUTH_ISSUER=http://localhost:4000`
> and `apps/gateway/config.yaml` has `listen_addr: '0.0.0.0:4000'`. They collide.
> Suggested convention: modules on `40xx` (people 4001, timeoff 4002), the
> router on 4000, platform services on `41xx` — identity on 4100.

### Schema and database role

`platform.account`, `platform.credential`, `platform.session` and friends live in
the existing `platform` schema, reached by a new `svc_identity` role created
`NOBYPASSRLS` in `tools/scripts/init-db.sql`, following the pattern already
there for `svc_people` and `svc_timeoff`.

Row-level security applies to session and audit tables, keyed on `tenant_id`, with
`FORCE ROW LEVEL SECURITY` and the `NULLIF(current_setting(...), '')` form that
`SECURITY.md` insists on.

`platform.account` is the exception and needs its own reasoning:

**An account is scoped to a tenant. A credential is not.** A person employed by
two customers has two accounts and one passkey. That split is the entire reason
the origin design below looks the way it does, so it is worth stating as a table
shape rather than leaving it implied:

```
platform.identity        one row per human, globally.  No PII beyond a handle.
platform.credential      passkeys and federated links, keyed to identity_id.
platform.account         one row per (identity, tenant).  Tenant-scoped, RLS.
platform.session         one row per (account, device slot).  Tenant-scoped, RLS.
```

`platform.identity` deliberately holds almost nothing: an opaque UUID used as the
WebAuthn `userHandle`, and creation metadata. Names, emails and employment live in
the People module, on the other side of a boundary. The identity table is a join
key, not a profile.

---

## Headless: bringing your own identity

`CLAUDE.md` says every module must be sellable on its own, and proves it by
booting each one with its siblings made unresolvable. **The same rule applied to
identity says the product must work with our identity provider removed** — and a
Workday shop buying Time Off alone has an IdP already and no intention of adopting
a second one.

This is not a bolt-on. It is the reason the design above already refuses to let a
module call the identity service, and the reason the auth endpoints are plain
HTTP with Zod rather than GraphQL fields. Both of those were the headless-enabling
choices; this section makes them explicit and adds the gate that keeps them
honest.

### Four modes, and only two of them are what people usually mean

| Mode                     | Credentials | Sessions | Login UI | Typical buyer                               |
| ------------------------ | ----------- | -------- | -------- | ------------------------------------------- |
| **1. Kithena auth**      | us          | us       | us       | SMB, mid-market. The default                |
| **2. Federated SSO**     | their IdP   | **us**   | us       | most enterprises. What "SSO" normally means |
| **3. Headless UI**       | us          | us       | **them** | embedding Kithena in an existing portal     |
| **4. External identity** | them        | **them** | them     | Workday/Okta shops buying one module        |

Modes 1 and 2 are the same system with a different credential source, and the
whole design above already covers both. Modes 3 and 4 are the interesting ones.

### Mode 3 costs almost nothing

`apps/auth` is a thin client over an HTTP API. A customer who wants their own
login screen calls the same endpoints. The only work is treating that API as
public: versioning it, documenting it, and resisting the temptation to let
`apps/auth` reach for a shortcut the API does not expose.

That last part is a discipline, not a feature, and it is the one that decays
silently. Worth a contract test that drives the whole login flow through the
public API with no privileged access.

### Mode 4 is the real one, and it is a token exchange

The customer's IdP mints tokens. Kithena never sees a credential.

```
their IdP ──token──▶ platform/identity  /token/exchange     (RFC 8693)
                        │
                        ├─ issuer in platform.tenant_issuer for this tenant?
                        ├─ signature valid against their JWKS?
                        ├─ audience, algorithm, expiry, clock skew?
                        ├─ map their claims → ours via the tenant's claim map
                        ├─ does an account exist for this subject?    ← still required
                        └─ not revoked?
                             │
                             ▼
                        a Kithena Principal, short-lived, for the router
```

[RFC 8693 Token Exchange](https://datatracker.ietf.org/doc/html/rfc8693) is the
right primitive because it is the specified answer to exactly this question, and
because it keeps the trust boundary in one auditable place rather than teaching
every subgraph to validate a customer-specific token.

What the tenant registers:

```
platform.tenant_issuer
  issuer               https://acme.okta.com
  jwks_uri             …/v1/keys
  audience             the value they will put in aud
  algorithms           allowed algs, explicitly — never "whatever the header says"
  claim_map            sub → external_id, email → hint,
                       acr/amr → our amr, groups → ignored
  max_token_age        we refuse anything older, whatever their exp says
```

**The account must still exist.** Commissioning does not weaken in mode 4: a valid
token for a person Kithena has never heard of is a refusal, not a login. This is
what stops their IdP's contractor directory from silently becoming employees.

### The anti-corruption layer, in the place the repo already reserves for it

`.dependency-cruiser.cjs` exempts `services/*/src/integration/` from the orphan
rule, with a comment describing it as "a module's ports: the interfaces an
external provider is adapted _to_, with no implementation in the tree yet."

Identity gets the same shape — `platform/identity/src/integration/` — holding the
`IdentitySource` port, with our own provider as one implementation among several
rather than as the privileged one. The manifest gains the flag its sibling
already has:

```
requiresIdentitySource: 'own' | 'external' | 'either'
```

### And the gate, because otherwise this is a paragraph

`just standalone timeoff` is what stops the module boundary eroding. Headless
needs the equivalent or it will be true on the day it ships and false a quarter
later:

```
just standalone-external        boot the product with Kithena's IdP absent,
                                a mock external issuer in front of it,
                                and run the acceptance suite
```

Added to the `standalone` matrix in `.github/workflows/ci.yml`, uncached, for the
same reason the existing one is uncached: a cache hit would report that the
product still runs headless without ever trying.

### What mode 4 costs, stated plainly

Honest accounting, because a customer choosing this is choosing to give things up
and should be told which:

|                              | Mode 1–2                      | Mode 4                                 |
| ---------------------------- | ----------------------------- | -------------------------------------- |
| Four-session cap             | ✅ enforced by a unique index | ✗ their sessions, their rules          |
| Termination revokes access   | immediate                     | **only as fast as their token TTL**    |
| HR-mediated recovery         | ✅                            | ✗ their helpdesk owns it               |
| Phishing-resistant guarantee | ✅ we enforce the floor       | whatever their IdP does                |
| Step-up freshness            | ✅                            | only if they emit `auth_time` or `acr` |
| Audit completeness           | full                          | logins happen where we cannot see them |

The revocation row is the one to put in writing in a contract. We revoke our
derived sessions instantly and refuse further exchanges, but a token their IdP
already minted stays valid until it expires. **Mitigations: require
`max_token_age` of five minutes or less for tenants in mode 4, and offer outbound
SCIM so `people.person.terminated` pushes a deactivation back into their
directory.** That closes the loop from our side rather than hoping theirs is
configured well.

Mode 4 is a downgrade in security properties. Some customers will rationally
accept it, and the answer is to be clear about the trade rather than to refuse the
sale or to pretend the trade is not happening.

---

## Origins, cookies, and the WebAuthn RP ID

This is the load-bearing section. Get it wrong and either passkeys do not work
across tenants, or one tenant can read another's session.

### The constraint

WebAuthn binds a credential to an **RP ID**, which must be the origin's domain
or a registrable suffix of it. From `acme.app.kithena.com` the legal choices are
`acme.app.kithena.com`, `app.kithena.com`, or `kithena.com`.

- **`acme.app.kithena.com`** — a passkey per employer. A contractor at three
  customers enrols three times. Rejected: it makes the common case worse and the
  recovery case much worse.
- **`kithena.com`** — **rejected, and this one is a security finding.**
  `CLAUDE.md` records that `design.kithena.com` and `storybook.kithena.com` are
  world-readable and cannot be protected on Vercel's Hobby plan. An RP ID of
  `kithena.com` makes every credential in the product assertable from those two
  unprotected origins. A content injection in a Storybook story would reach the
  authenticator.
- **`app.kithena.com`** — ✅. Portable across every tenant, and structurally
  unreachable from the Reach sites, which are not subdomains of it.

### The decision

|                 | Production                     | Staging                                |
| --------------- | ------------------------------ | -------------------------------------- |
| Ceremony origin | `https://auth.app.kithena.com` | `https://auth.staging.app.kithena.com` |
| RP ID           | `app.kithena.com`              | `staging.app.kithena.com`              |
| Tenant origin   | `https://acme.app.kithena.com` | `https://acme.staging.app.kithena.com` |

`auth` is **already** in `platform.reserved_slug`, so no tenant can register it.
Distinct RP IDs per environment mean a staging passkey cannot be replayed against
production, which matters because staging is where synthetic accounts are cheap
to create.

All WebAuthn ceremonies — registration and assertion — happen on the auth origin
only. Tenant hosts never call `navigator.credentials`.

### Cookies

Two cookies, both `__Host-` prefixed, which forces `Secure`, `Path=/` and — the
part that matters — **forbids a `Domain` attribute**, making them host-only.

| Cookie            | Set on                 | Contains                                |
| ----------------- | ---------------------- | --------------------------------------- |
| `__Host-kid`      | `auth.app.kithena.com` | the identity-provider session           |
| `__Host-ksession` | `acme.app.kithena.com` | that tenant's session, and nothing else |

**No cookie in this system ever carries `Domain=.app.kithena.com`.** That single
rule is what stops `evil.app.kithena.com` from receiving `acme`'s session cookie,
and `__Host-` makes it a property the browser enforces rather than a convention
a reviewer has to notice.

Both are `HttpOnly`, `SameSite=Lax`, and hold an **opaque identifier** — never a
JWT. Reasons in [Sessions](#sessions).

### The handoff

Tenant app to auth origin and back is OAuth 2.1 authorization code + PKCE, with
the identity service as the authorization server. Not because the tenant app is
untrusted, but because it is a specified, auditable, well-attacked flow and
inventing a bespoke redirect protocol here is how people lose.

The redirect URI is validated against `platform.tenant`: `acme`'s authorization
request may only redirect to `acme`'s own host. The registry already exists for
tenant resolution; this is its second job.

```mermaid
sequenceDiagram
    participant B as Browser
    participant T as acme.app.kithena.com
    participant A as auth.app.kithena.com
    participant D as platform.identity

    B->>T: GET /dashboard  (no session cookie)
    T-->>B: 302 → auth origin (PKCE challenge, tenant=acme)
    B->>A: GET /authorize
    A->>B: passkey assertion, or Google, or enrolment
    B->>A: credential
    A->>D: verify, resolve identity → account for acme
    D-->>A: account, or "no account at this tenant"
    A-->>B: 302 → acme/auth/callback?code=…
    B->>T: GET /auth/callback?code=…
    T->>A: POST /token  (code + verifier, back channel)
    A-->>T: subject, amr, authenticatedAt
    T->>D: claim a session slot for (account, acme)
    T-->>B: Set-Cookie __Host-ksession; 302 → /dashboard
```

The interesting failure is the one in the middle: **a valid Google or passkey
credential with no account at this tenant is not a login.** It is a 404-shaped
refusal that does not disclose whether the credential was valid, matching the
existing decision that an unknown tenant slug returns 404 rather than a redirect.

---

## The tenant login page

`apple.app.kithena.com/login`, branded as Apple's. Yes — mostly, and the part
that cannot work is decided by Google rather than by us.

### What can and cannot live on the tenant origin

|                                    | On `apple.app.kithena.com`? |                                                                                                  |
| ---------------------------------- | --------------------------- | ------------------------------------------------------------------------------------------------ |
| The branded login page             | ✅                          | Tenant is already known from the Host header                                                     |
| **Passkey assertion** (signing in) | ✅                          | `app.kithena.com` is a registrable suffix of `apple.app.kithena.com`, so the RP ID is legal here |
| Passkey **registration**           | ⚠️ possible, not advised    | See below                                                                                        |
| **Google OIDC callback**           | ❌ **impossible**           | See below                                                                                        |

Note the second row, because it corrects the earlier draft. I said ceremonies
should be pinned to a single origin. That was a hardening preference stated as if
it were a browser rule, and it is not one: **assertion works fine on the tenant
origin.** No redirect, no bounce, branded end to end.

### Why Google forces a central callback

This one is not negotiable.
[Google requires every redirect URI to be registered exactly](https://workos.com/blog/google-oauths-strict-redirect-uri-matching)
— scheme, host, port and path, character for character. **No wildcards**, which
[RFC 9700 §4.1.1](https://datatracker.ietf.org/doc/html/rfc9700) forbids generally
because they enable open redirects. There is a limit of roughly **100 URIs per
OAuth client**, and unlike Auth0, Okta and Azure, **Google exposes no API to
manage them** — it is manual work in the Cloud Console.

So "register `apple.app.kithena.com/auth/callback` when Apple signs up" means a
console visit per customer, and a hard wall at 100 customers. The standard answer
is the **proxy pattern**: one fixed callback, with the tenant carried in `state`.

### The recommended flow

```
apple.app.kithena.com/login          ← branded, SSR, tenant from Host header
   │
   ├── [ Sign in with a passkey ]
   │      └─ WebAuthn assertion, right here, RP ID app.kithena.com
   │           └─ session cookie on apple.app.kithena.com.  No redirect at all.
   │
   ├── [ Sign in with Google ]
   │      └─ auth.app.kithena.com/google/start?tenant=apple   (state = signed)
   │           └─ accounts.google.com
   │                └─ auth.app.kithena.com/google/callback   ← the ONE registered URI
   │                     └─ verify hd against Apple's verified domains
   │                          └─ 302 → apple.app.kithena.com/auth/callback?code=…
   │
   └── [ Set up a new passkey / I lost my device ]
          └─ auth.app.kithena.com   — always, with step-up
```

The passkey path — the one that should be most people, most days — has **no
redirect**. The Google path has one, at the moment users already expect to leave
for Google.

### Why enrolment stays centralised

Assertion on the tenant origin is safe: it produces a session, and anyone who can
run script on that origin can already act as the user through the session they
have. Registration is different — it mints a **persistent credential** that
outlives the session and any password change.

That matters here specifically because `@tiptap` is in the stack and HR types free
text into it. Rendered rich text is an XSS surface, and the escalation from "can
act as this user now" to "has permanently enrolled an authenticator" is the one
worth spending a redirect to prevent.

So: **assert anywhere under `app.kithena.com`, enrol only on the auth origin,
always behind step-up.**

### Branding, and the SVG problem

Branding config belongs in the tenant registry — it is read before a tenant is
known to be authenticated, exactly like `platform.tenant`:

```
platform.tenant_branding   logo, display name, accent colour, support contact
platform.tenant_auth_policy  which methods appear, SSO-only, session cap, attestation
```

`packages/ui` must not learn any of this. Reach renders a `<LoginCard>` that takes
a logo and a colour as props; the host supplies them. That boundary is already a
dependency-cruiser rule.

**A tenant-uploaded SVG logo is executable content.** SVG can carry `<script>` and
event handlers, and serving one from the login origin is stored XSS on the most
security-sensitive page in the product. Either rasterise to PNG/WebP on upload, or
serve logos from a separate asset origin with a restrictive CSP. Do not sanitise
in place and hope.

The tenant auth policy also decides which buttons appear at all. If Apple enforces
Workspace SSO, the passkey button should not be the primary call to action — that
is a per-tenant decision, not a global layout.

### The decision this reverses, stated plainly

`apps/web/src/lib/tenant.ts` and the tenant registry migration both argue, in
comments, that unknown and suspended tenants get a 404 rather than a redirect
because _"a redirect distinguishes 'no such tenant' from 'not found', which tells
someone probing slugs which companies are customers."_

**Putting Apple's logo on `apple.app.kithena.com/login` publishes that Apple is a
customer.** That is a deliberate reversal and should be made knowingly.

The honest assessment is that the reversal is smaller than it looks. Subdomain
tenancy already leaks membership: a valid tenant renders something and an invalid
one 404s, whatever is drawn on the page. Branding makes the leak _legible_, not
newly _possible_. The 404 rule still does its real job, which is refusing to
confirm guesses at slugs that are not customers.

Recommendation: **brand it by default, and make it a tenant policy flag.** Most
customers treat the relationship as a logo on your website. The ones who do not —
in an acquisition, or a regulated matter — get a neutral page by setting a flag,
rather than by nobody having thought about it.

### Vanity domains do not work, and it is worth knowing why now

The next request after branded login is always `hr.apple.com`. For passkeys,
**that cannot be delivered at scale**, and the reason is a hard number.

WebAuthn's answer to one credential across several domains is
[Related Origin Requests](https://web.dev/articles/webauthn-related-origin-requests):
publish `https://app.kithena.com/.well-known/webauthn` listing the origins allowed
to use the RP ID. Chrome shipped it in 128; Safari and Edge followed; Firefox
lagged.

But ROR is capped at **five unique registrable domains**, and no browser exceeds
that minimum. Five total — not five per tenant. The feature exists so one product
can span `example.com`, `example.co.uk` and `example.de`, not so a SaaS can host
hundreds of customer domains.

So the position to take, before sales promises otherwise:

- **Tenant subdomains under `app.kithena.com`: unlimited, passkeys work.**
- **Customer vanity domains: not supported with passkeys.** A tenant that insists
  can have SAML on a vanity domain, where the credential lives in their IdP and
  the RP ID is theirs, not ours.
- Reserve the five ROR slots for **our own** ccTLDs if EU or UK data residency
  ever needs a separate registrable domain. That is the one use they are for, and
  spending one on a customer forecloses it.

### Caching and challenge freshness

The login page is per-tenant and nearly static, so it is tempting to cache it. Do
— but **the WebAuthn challenge must not be in the cached HTML.** Challenges are
single-use, server-generated and short-lived; a cached one is a replay waiting to
happen.

Render the shell, fetch the challenge with a POST on button press. The page stays
cacheable per tenant, the challenge stays fresh, and the first paint is fast on
the low-end hardware this has to work on.

---

## Accounts are commissioned, never registered

### The three ways an account comes to exist

1. **The founding HR account**, created with the tenant, by the platform. One
   per tenant, and it is the only account nobody else commissions.
2. **By an event.** Identity consumes `people.person.hired` from Redpanda. It
   does not import the People module — it reads the contract, which is what the
   contract is for.
3. **By direct API**, for a customer running Time Off standalone against Workday
   with no People module present. `POST /accounts` on the identity service,
   authorized by OpenFGA, used by the module's provisioning screens.

Paths 2 and 3 converge on one internal command and one emitted event
(`platform.account.provisioned`). The distinction is who called it, and that
belongs in the actor field of the envelope, not in two write models.

### Commissioning is not the same as enrolment

An account can exist and be unusable. That is the point — it is what "HR hasn't
commissioned it yet" means, and it is what lets a hire be entered three weeks
before the start date.

```
provisioned ──enrolment sent──▶ invited ──credential registered──▶ active
     │                              │                                 │
     └──────────────────────────────┴──── suspended ◀─────────────────┘
                                              │
                                          terminated  (terminal, retains records)
```

`effectiveFrom` on the provisioning event decides when `invited → active` is
even permitted. Someone hired effective the 1st cannot log in on the 20th of the
previous month, however valid their passkey is. This falls straight out of the
effective-dating rule in `CLAUDE.md` and is the sort of thing bolt-on auth
products cannot express at all.

### The enrolment token is the weakest link, and NIST just made that official

Everything above is phishing-resistant except the moment a person first proves
who they are. That moment is a link in an email — and
[SP 800-63B-4](https://pages.nist.gov/800-63-4/sp800-63b.html) **deprecates email
OTP outright** and downgrades SMS. Emailing a link and calling it enrolment is no
longer merely weak; it is explicitly outside the standard the rest of this design
is built to.

So enrolment is a **two-channel** ceremony, always, with email as at most one of
the two:

- Single use, 72-hour TTL, invalidated by the first successful enrolment.
- Bound to the tenant host — a token for `acme` presented on `globex` is void.
- Consumed only from the auth origin, over a POST with an `Origin` check.
- **Paired with a second factor the employer already knows** and the attacker
  does not: an HR-set code handed over in person or on the offer letter, or a
  known-value challenge (date of birth, last four of a national ID). Not
  optional, not a tenant toggle — it is what keeps the enrolment step at the same
  assurance level as everything it bootstraps.
- Every use emits an audit event visible to HR.

The in-person variant is the good one, and an HRIS is unusually well placed to
use it: a new hire has a first day, and somebody is already handing them a laptop.

---

## Google Workspace

### Verify `hd`, never the email domain

An `@acme.com` address in the `email` claim proves nothing about who administers
that mailbox. Google is explicit that the email domain is insufficient to show an
account is managed by an organisation; the `hd` claim is what carries that, and
it is inside the signature.

So: **`hd` must equal one of the tenant's verified domains, or it is not a
login.** Not the email domain. Not a substring. Exact match against a list.

### The domain must be verified by us, not typed by HR

If HR can type `acme.com` into a settings box and thereby accept any Google
identity in that Workspace, then whoever controls that Workspace controls the
tenant. Domain ownership is proved the same way every other product proves it: a
DNS TXT record containing a per-tenant nonce, re-checked on a schedule.

Re-checking matters more here than usual. Truffle Security's 2025 finding on
Google OAuth was that buying a defunct company's domain inherits its `hd` claims.
A domain verified once in 2026 and never re-checked is a standing takeover of
every employment record that company ever held. Re-verify monthly; on failure,
suspend federated login for that domain and notify HR — do not silently keep
trusting it, and do not lock everyone out, because passkeys still work.

### `sub`, not `email`, is the identifier

Emails get reassigned when people leave. `sub` is stable and opaque. Store `sub`
in `platform.credential`; treat `email` as a hint used once, at the moment an
enrolment is matched to an account, and never again.

### What we deliberately do not do

**No just-in-time provisioning by default.** A valid Google identity in a verified
domain with no Kithena account gets a refusal, not an account. This is the
brief's requirement and it is also the right default: JIT provisioning means the
Workspace admin, not HR, decides who is an employee in the HRIS.

It should be a per-tenant toggle, off by default, because some enterprise buyers
will require it.

---

## Passkeys

### Shape

- **Discoverable credentials** (`residentKey: required`), so the flow is "tap" and
  not "type your email, then tap".
- **`userVerification: required`.** Biometric or PIN. Without it a passkey is
  single-factor and the compliance story evaporates.
- **`userHandle` is `platform.identity.id`** — an opaque UUID. Never an email,
  never an employee number. The handle is stored in plain text on the
  authenticator and syncs to the vendor's cloud; putting a work email there
  leaks the employment relationship to anyone who dumps a synced keychain.
- **Attestation `none` by default.** `direct`, checked against the FIDO Metadata
  Service, only for tenants that turn on a "hardware-bound authenticators only"
  policy — defence contractors and regulated finance will ask; nobody else wants
  the enrolment friction.
- **Nudge hard for a second passkey.** One passkey on one laptop is one lost
  laptop away from the recovery flow, which is the expensive path for everyone.
  Prompt at first login, again at day 7, and show a persistent (dismissible)
  banner while the count is 1.
- Store the AAGUID. It is how you answer "which authenticator did this session
  come from" in the session list, and how a tenant policy can exclude a specific
  vendor after a disclosure.

### Cross-device

Hybrid transport (the QR-code flow) covers the shared-terminal case without a
company phone being enrolled: the worker scans with their own phone, the
credential never leaves it, and the terminal gets a session. This is the piece
that makes deskless viable, and it needs the terminal-side UX designed for it
rather than treated as a fallback.

---

## Recovery is the actual differentiator

Everyone's passkey story ends the same way: lose the device, get an email, click
the link, you are back in. Which means the real authenticator was the mailbox all
along, and an attacker who owns the mailbox owns the account. It is the single
largest hole in the current market's passwordless deployments.

**An HRIS is the only product that can close it,** because it is the system of
record for who your HR department is and who your manager is. Those are verified,
in-band relationships, not self-asserted contacts.

Proposed: **HR-mediated recovery.**

```
Employee loses device
   └─▶ requests recovery on the auth origin
         └─▶ appears in HR's queue with the org-chart context
               └─▶ HR verifies out of band (they can walk over, or call the
                   number on file, or check with the manager the org chart names)
                     └─▶ HR issues a single-use enrolment token
                           └─▶ 15-minute delay + notification to every existing
                               session and to the manager
                                 └─▶ employee enrols a new passkey
```

Properties worth stating explicitly:

- **No self-service reset path exists.** There is nothing to phish.
- The delay-and-notify window means a compromised HR admin cannot silently take
  over an account; the victim and their manager both find out.
- Every step is an audit event with an actor, which is what an auditor will ask
  for and what none of the incumbents can produce for a password reset.

**Break-glass for the HR admin's own account** is the case that has to be solved
or the whole thing is theatre:

- A tenant must have **at least two** accounts holding the HR-admin relation. The
  domain layer refuses to remove the second-to-last one — the same shape as the
  last-owner protection every serious platform has.
- HR admin recovery requires **another** HR admin, and emits a high-severity audit
  event.
- Platform-operated break-glass (us) is a time-boxed, dual-controlled,
  loudly-logged path, using the `impersonatedBy` field that already exists in
  `Principal`. It should be rare enough that every use is reviewed.

---

## Sessions

### Why opaque, not a JWT in the cookie

You cannot enforce "four sessions" with a stateless token — you would have to
count something, and counting means a server-side registry. Once the registry
exists, a self-contained cookie only buys you the ability to _not_ check it,
which is the same thing as not being able to revoke it. Given requirement 2
(deprovisioning is a legal event), that trade is unavailable.

So: an opaque identifier in the cookie, a record in Postgres, a hot copy in
Valkey (already in the compose file). Revocation is a `DELETE`.

JWTs still exist — as short-lived tokens minted _by the app, per render_, for the
Cosmo Router and the subgraphs. 120-second TTL, signed by a key published at
`AUTH_JWKS_URL`, carrying exactly the existing `Principal` shape. Modules verify
signatures and never call identity. Revocation latency is bounded by the TTL, and
for the cases where 120 seconds is too long (termination, session revocation) the
router additionally consults a revocation set in Valkey.

### The four-session cap, enforced by a constraint

`CLAUDE.md`: where a race is possible, the invariant is also enforced by a
Postgres constraint. Counting rows and then inserting is exactly such a race, and
`CHECK` constraints cannot count rows.

So the cap is expressed as a **slot**:

```
platform.session (
  account_id  …,
  slot        smallint  CHECK (slot BETWEEN 1 AND 4),
  …,
  UNIQUE (account_id, slot)
)
```

A login picks the lowest free slot. Two logins racing for the same slot mean one
of them violates the unique index and retries. The cap is not a policy the
application remembers to apply — it is arithmetic the database cannot be talked
out of.

The limit itself is per `(identity, tenant)`, not per identity. A contractor at
three companies gets four sessions at each. It is tenant-configurable with a
default of 4; regulated customers will want 2, and a company issuing shared
terminals will want more.

### When the fifth device arrives

**Evict the least-recently-used and tell them**, rather than refuse. Refusing
strands the person whose four slots are on a laptop that died, a phone they sold
and two browsers they cleared — and support cannot distinguish that from an
attack, so support will just raise the limit, and the control is gone.

Eviction and insertion happen in one transaction. The evicted device's next
request gets a specific, honest message and a link to the session list, not a
silent bounce to login.

The session list is a first-class screen, not a settings afterthought: device,
authenticator (from the AAGUID), approximate location, last seen, and a revoke
button per row plus a "revoke everything else". This is also the screen that makes
a session cap defensible instead of infuriating.

### Idle and absolute limits

|                   | Default   | Notes                                     |
| ----------------- | --------- | ----------------------------------------- |
| Idle timeout      | 8 hours   | one working day; tenant-configurable      |
| Absolute lifetime | 30 days   | not extendable by activity                |
| Step-up freshness | 5 minutes | already in `requiresStepUp` in `auth-kit` |

Step-up applies to compensation, bank details, national IDs, right-to-work
documents, and anything classified `special-category`. The classification
registry already knows which fields those are — so **the step-up requirement can
be generated from the same walk that emits the redaction paths**, rather than
being a list someone maintains by hand in resolvers. That is the pattern the
codebase already uses for four other artifacts; this is a fifth.

### What is stored, and its classification

Every column here is personal data and needs a `FieldPolicy` or `pnpm codegen`
will (correctly) fail:

| Field                     | Classification                                                 |
| ------------------------- | -------------------------------------------------------------- |
| `ip`                      | `internal` / `contact` — truncate to /24 and /48 after 30 days |
| `user_agent`              | `internal` / `contact`                                         |
| `aaguid`                  | `internal` / `none`                                            |
| `amr`, `authenticated_at` | `internal` / `none`                                            |
| approximate location      | `internal` / `contact`, derived, never stored precisely        |

Truncation rather than hashing: forensics genuinely needs the prefix, and a hashed
IPv4 is trivially reversible anyway, so hashing here is ceremony rather than a
control.

---

## SSR and rehydration

`apps/web` is Next 16 App Router with an existing proxy that resolves the tenant
from the Host header. Auth extends that shape rather than replacing it.

### Reading the session

**Not in the proxy.** The proxy runs on every request including assets and is the
wrong place for a session lookup. Instead a server-only `getPrincipal()` wrapped
in React `cache()`, so one render pass costs one Valkey read regardless of how
many Server Components ask.

The existing proxy discipline carries over unchanged and is worth restating,
because it is the pattern that keeps this safe: **the proxy deletes inbound
`x-tenant-id` before any branch that might return early.** Any principal header
gets the same treatment. Identity is never read from a header a client could have
written.

### What crosses to the client

The hydration payload is enumerated, not spread:

```
{ displayName, avatarUrl, tenantSlug, locale, entitlements[], permissionsVersion }
```

No token. No email. No employee ID. No role names. `permissionsVersion` is a
stamp the client sends back so a stale precomputed permission set can be
invalidated without a round trip per check.

And because the classification registry exists: **codegen should emit the set of
fields legal to appear in a hydration payload**, and a test should assert the
payload contains nothing outside it. Confidential data reaching the RSC payload is
confidential data in the HTML source of a page, which is a viewable, cacheable,
screenshot-able artifact. That failure is exactly the class the registry was built
to prevent, and it currently has no gate.

### Caching

Authenticated routes are `private, no-store`. If Cache Components / PPR are used,
the prerendered shell must contain nothing tenant-specific — no company name, no
logo, no locale — because one shell is shared across every tenant on the
deployment. Worth a test that renders the shell for two tenants and diffs it.

### CSRF

`SameSite=Lax` plus an `Origin` header check on every mutating request. The
callback POST additionally carries the PKCE verifier, which is state the attacker
does not have. No token-in-a-hidden-field scheme is needed on top of that.

---

## Deprovisioning

The half of HRIS authentication that incumbents do worst, and the half that
matters most legally.

```
people.person.terminated  (effectiveFrom = last working day)
        │
        ▼  Redpanda
platform.identity consumer
        │
        ├─▶ at effectiveFrom, end of day, in the person's own timezone:
        │     revoke every session for (identity, tenant)
        │     push the session ids into the router's revocation set
        │     set account status → terminated
        │     revoke federated links for this tenant
        │
        └─▶ credentials belonging to platform.identity are NOT deleted —
              other tenants may still be using them
```

Two details that are easy to get wrong:

- **The person's own timezone.** A last working day is a calendar date, not an
  instant. Terminating at UTC midnight logs Californians out mid-afternoon and
  gives Sydney an extra day. The `CalendarDate` primitive already encodes this
  distinction; the consumer has to honour it.
- **The account persists.** Employment records outlive employment, and
  `migrations/…tenant_registry.sql` already makes exactly this argument about
  tenants. A terminated account is a tombstone that cannot log in, not a `DELETE`.

Suspension is the same machinery with a different terminal state, and covers
garden leave, investigations, and unpaid invoices.

---

## How this compares to what is already out there

### Feature by feature

|                            | Kithena (proposed)        | BambooHR                    | Workday          | Rippling            | HiBob     | Personio  |
| -------------------------- | ------------------------- | --------------------------- | ---------------- | ------------------- | --------- | --------- |
| Tenant addressing          | subdomain                 | subdomain                   | tenant path      | subdomain           | subdomain | subdomain |
| SAML 2.0                   | **gap — see below**       | ✅                          | ✅               | ✅                  | ✅        | ✅        |
| OIDC                       | ✅                        | ✅                          | ✅               | ✅                  | ✅        | ✅        |
| SCIM inbound               | **gap — see below**       | ✅                          | ✅               | ✅ (is an IdP)      | ✅        | ✅        |
| Passkeys                   | ✅ primary factor         | ✅ (Nov 2025, not with SSO) | partial, via IdP | ✅ (after password) | via IdP   | via IdP   |
| Passwordless _by default_  | ✅                        | ✗                           | ✗                | ✗                   | ✗         | ✗         |
| Concurrent session cap     | ✅ 4, constraint-enforced | ✗                           | ✗                | ✗                   | ✗         | ✗         |
| Self-service session list  | ✅                        | partial                     | partial          | ✅                  | ✗         | ✗         |
| Recovery without email     | ✅ HR-mediated            | ✗                           | ✗                | ✗                   | ✗         | ✗         |
| No self-signup             | ✅ structural             | ✅                          | ✅               | ✅                  | ✅        | ✅        |
| Deskless / no-email login  | ✅ designed for           | weak                        | weak             | weak                | weak      | weak      |
| Termination → session kill | ✅ event-driven           | manual-ish                  | ✅               | ✅                  | ✅        | partial   |
| Impersonation, audited     | ✅ time-boxed             | ✅                          | ✅               | ✅                  | ✅        | ✅        |

Two rows are worth reading carefully. BambooHR's passkeys **do not appear at all
for companies using SSO exclusively** — passkeys and SSO are alternatives there,
not layers. And Rippling's passkey sits _after_ email and password, so it is a
second factor rather than a replacement. Neither product treats the passkey as the
primary trust anchor. That gap, plus recovery, is the whole opportunity.

### What the incumbents have that this plan was missing

Reviewing the brief against the market turned up five real gaps. Three are
required, two are worth arguing about.

**SAML 2.0 is required, not optional.** Every enterprise buyer's Okta/Entra/Ping
estate is SAML-first, and "we only do OIDC" loses deals without a conversation.
It is not architecturally interesting — a second credential type in
`platform.credential` and a different assertion parser — but it is a hard
requirement and it should be in the plan, not discovered during a procurement
call. Timebox it and do not let it contaminate the core model.

**SCIM 2.0 inbound provisioning is required.** This is the piece that makes the
brief's own requirement work at scale. HR commissioning accounts by hand is right
for 50 people and unworkable at 5,000, and every buyer above that size expects
their IdP to push the roster. Architecturally, SCIM is _another writer of the same
provisioning command_ — a third path converging on `platform.account.provisioned`
— so if paths 2 and 3 are built with that in mind, SCIM is an adapter rather than
a rewrite.

**Delegated administration.** BambooHR calls them access levels, Workday calls
them security groups; every buyer expects "site admins can do these six things in
their location and nothing else". This maps onto OpenFGA cleanly — it is the
reason the org chart is a graph — but it needs to be in the model from the start,
because retrofitting scoped admin onto a boolean `isHrAdmin` is a migration
nobody enjoys.

**Rehire.** A person leaves in 2026 and comes back in 2028. Same human, same
passkey, new employment. If `platform.account` has a unique index on
`(tenant, work_email)` and the terminated row still holds it, the rehire fails —
or worse, succeeds by creating a second identity, and now one person has two
tombstones and no history. The identity/account split above handles this correctly
provided the uniqueness constraint is **partial**, on active accounts only. Cheap
to get right now, expensive later.

**Employees without company email.** The brief assumes Google Workspace with a
company address. In retail, hospitality, care and logistics most of the headcount
has neither. Third-party vendors exist specifically to plug this gap in
incumbents' products, which is evidence both that the need is real and that nobody
solves it natively. The answer here is the passkey path with an employee number
plus HR-issued enrolment — which this design already supports, but only if the
enrolment flow is built for a QR code on a shared terminal rather than as a
degraded email flow. It should be a named requirement, not an emergent one.

---

## Build or buy

The question is not "build auth or buy auth". It is **which layer**, and the
answer inverts the usual advice — because for this product the identity plane is
where the differentiation and the legal exposure both sit, while the enterprise
connector layer is undifferentiated protocol grind.

### Why the obvious buys do not fit

|                        | Verdict             | Reason                                                                                                                                                     |
| ---------------------- | ------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **WorkOS**             | ✗ as identity plane | [US data residency only](https://workos.com/blog/data-residency-for-enterprise-saas). No EMEA region                                                       |
| **Clerk**              | ✗                   | [No EU hosting selector for the auth plane](https://guptadeepak.com/ciam-compass/guides/data-residency-and-sovereignty/); B2C-shaped `Organizations` model |
| **Auth0**              | ~                   | Has EU tenants. Expensive, and per-org enterprise-connection pricing bites exactly where an HRIS lives                                                     |
| **Zitadel / Keycloak** | ~                   | Self-hostable in the EU, genuinely good. See below                                                                                                         |

The data-residency row is not a nitpick. `packages/contracts/src/classification.ts`
already declares `statutoryFloor: 'es-labour' | 'de-labour' | 'eu-payroll'`. This
is, by its own contracts, a European product holding
[GDPR Article 9](https://gdpr-info.eu/art-9-gdpr/) data. Putting the authentication
plane — emails, IPs, device identifiers, login times for every employee at every
customer — in a US-only SaaS is a subprocessor conversation with a German works
council that you do not want to have, and it is a conversation that arrives
during procurement, not after.

### Why the differentiators cannot be bought

Every feature that makes this design worth building lives in the _lifecycle_, and
the lifecycle is HR data that no identity vendor has:

| Feature                    | Why no vendor can supply it                                                 |
| -------------------------- | --------------------------------------------------------------------------- |
| HR-mediated recovery       | Needs the verified org chart. That is People-module data                    |
| Effective-dated activation | No IdP models "this account becomes valid on the 1st"                       |
| Termination → session kill | Driven by a Redpanda event carrying a `CalendarDate` and a timezone         |
| Four-session slot cap      | It is a Postgres unique index. There is nothing to integrate                |
| Entitlements               | "Did this company buy this module" is a Kithena question                    |
| Impersonation              | `Principal.impersonatedBy` already exists and is audited against HR records |

Buy the identity plane and you do not get these later — you get them never,
because the vendor's data model has no place to put them.

### What "build" actually costs here, which is less than it sounds

"Build your own auth" is normally terrible advice. It is defensible here
specifically because two decisions above delete most of the work:

**No passwords** removes hashing, rotation, reset flows, breach-corpus checks and
strength meters. **No self-signup** removes email verification, bot detection,
abuse throttling and account-farming defence. What remains:

| Piece                                      | How                                                                     | Rough size                               |
| ------------------------------------------ | ----------------------------------------------------------------------- | ---------------------------------------- |
| WebAuthn ceremonies                        | `@simplewebauthn/server`                                                | days                                     |
| Google / Microsoft OIDC                    | `openid-client` + `jose` (`jose` is already a dependency of `auth-kit`) | days                                     |
| OAuth 2.1 code + PKCE authorization server | library-assisted                                                        | ~1 week                                  |
| Session table, slots, step-up              | Postgres + Valkey. Already designed above                               | ~1 week                                  |
| Lifecycle, recovery, audit                 | the actual product                                                      | as long as it takes, and it is the point |

That is weeks, not the year the usual warning is about — and the warning is about
building password auth, which this explicitly is not.

### What to buy

**SAML 2.0 and SCIM.** This is where the advice flips, and firmly. SAML is XML
signature wrapping, canonicalisation edge cases and a different set of quirks per
IdP vendor; it is a swamp with a long history of critical bypasses in
hand-rolled implementations. SCIM is a spec whose interesting parts are all
vendor deviations from it.

Both are **connectors**, not the identity plane. They terminate at the edge of
`platform/identity` and hand it an assertion; they never own an account, a session
or a credential. That containment is what makes buying them safe, and it is why
they are Phase 8 — the model must be settled first, or the vendor's shape leaks
into it.

WorkOS is genuinely the best-in-class option _for this narrow job_, and its US
residency matters much less when what crosses is a SAML assertion at login rather
than the whole identity plane. SSOReady and BoxyHQ are self-hostable alternatives
if even that is unacceptable to a given customer.

### The middle path, and why it is not recommended

Self-host **Zitadel** (Swiss, Go, WebAuthn first-class, real B2B multi-tenancy) or
**Keycloak** (mature SAML and LDAP) as the credential store, with Kithena owning
lifecycle on top.

This is a reasonable architecture and worth revisiting if SAML and LDAP become
urgent, because you get both for free. It is not the recommendation today because
it adds a stateful service and a second database while removing none of the work
that matters — the lifecycle logic still has to be written, and now it has to be
written _across_ a boundary.

### Recommendation

**Own the identity plane. Buy the enterprise connectors. Revisit Zitadel if and
only if SAML and LDAP arrive together and early.**

---

## Microfrontends

You asked for many hosts and remote entries. The first version of this section
rejected Module Federation partly on evidence and partly on an architectural
objection that does not survive contact with your proposal. Both halves are
corrected below.

### Where the earlier objection was wrong

I argued that federated remotes must share a React runtime and so reintroduce the
coupling the module boundary removes. On a general monorepo that holds. **On this
one it does not**, because `.syncpackrc.json` already pins versions across the
workspace. Singleton React is a constraint the repo enforces anyway. That
objection was worth dropping.

I also leaned on React Server Components. `CLAUDE.md` never asks for RSC — it asks
for SSR and rehydration, and streaming SSR delivers those. That argument was
heavier than it deserved to be.

### Modern.js is the right suggestion

`@module-federation/nextjs-mf` is deprecated with App Router never supported. What
I did not say is what replaced it: the **Module Federation core team now
recommends Modern.js as the primary supported framework for federation-based
architectures**, and Thoughtworks put Modern.js in
**[Trial](https://www.thoughtworks.com/en-us/radar/languages-and-frameworks/modern-js)**
in April 2026 (Volume 34) specifically for teams with Module Federation
micro-frontend requirements, concluding that investment is justified because "no
better-supported alternative currently exists."

Modern.js is from the same team as Rspack and Module Federation itself, runs
thousands of projects in production inside ByteDance, and is the one React
framework where federation and SSR are designed together rather than bolted
together.

So: **yes. Modern.js + Module Federation 2.0, and now is the cheapest moment it
will ever be** — `apps/web` is three files and a proxy, and `src/lib/tenant.ts`
was deliberately written to do no I/O, so it ports unchanged.

### The three constraints that shape the architecture

These are not reasons to avoid it. They are the design, and getting them wrong
late is expensive.

**1. Component-level federation only.** Modern.js
[documents](https://modernjs.dev/guides/topic-detail/module-federation/ssr) that
application-level modules — `createBridgeComponent`, `createRemoteAppComponent` —
**do not support SSR**. `@module-federation/bridge-react` is not Node-compatible.
With SSR you federate _components_, not _apps_.

This has a consequence worth being explicit about: **the host owns routing.**
Adding a route to Time Off is a host deploy. That is a genuine dent in
independent deployability, and the mitigation is to make the host's route table
generic — a manifest of `path → remote → component`, so adding a screen is a
data change rather than a code change, and the manifest can be fetched at
runtime rather than baked into the bundle.

**2. Streaming SSR only.** Not a limitation; it is the good mode. It is what
keeps time-to-first-paint sane on the low-end Android hardware the deskless case
depends on.

**3. The SSR data-fetching path is experimental.** `[name].data.ts` is marked, in
Modern.js's own docs, as "experimental and has not been fully practiced. Please
use it with caution." For a system holding Article 9 data, that is not a sentence
to build a data layer on.

**And you do not have to** — which is the piece that makes this whole thing fit
together. This repo already has federated GraphQL. **The host fetches through the
Cosmo Router and passes data down as props.** Remote components stay
presentational. The experimental path is never touched, remotes get simpler, and
the server-side composition happens where it already happens today.

That also resolves the tension the earlier draft left hanging: federated GraphQL
and Module Federation are not competing answers to one question. GraphQL
federates the **data**, Module Federation federates the **UI**, and each is doing
the job it is good at.

### About "more packages in the turborepo"

One caution, because it decides whether any of this pays off.

**Module Federation's value is runtime loading of independently _deployed_
bundles.** If the remotes are packages in one turborepo that build and ship
together, you get MF's costs — remote-entry failures, version alignment, a
harder debugging story — and none of its benefit. That configuration is strictly
worse than an ordinary import.

The distinction is not packaging, it is the pipeline:

|                                        | Packaged separately | Deployed separately |
| -------------------------------------- | ------------------- | ------------------- |
| Own directory in the monorepo          | ✅                  | ✅                  |
| Own `turbo` build target               | ✅                  | ✅                  |
| Own container and deploy pipeline      | ✗                   | ✅                  |
| Own `remoteEntry.js` at its own URL    | ✗                   | ✅                  |
| Ship a fix without rebuilding the host | ✗                   | ✅                  |
| **Module Federation earns its keep**   | **✗**               | **✅**              |

A monorepo is entirely compatible with independent deployment — turbo builds and
ships each app on its own. It just is not automatic, and it is the part people
skip. If Time Off cannot ship a fix without rebuilding the host, the federation
is decoration.

### The recommended shape

```
                    acme.app.kithena.com                auth.app.kithena.com
                              │                                  │
                         ┌────┴────┐                        ┌────┴────┐
                         │ ingress │                        │  auth   │
                         └────┬────┘                        └─────────┘
                              │                          plain Modern.js app
                    ┌─────────┴─────────┐                not a remote, not
                    │   host (shell)    │                federated, own origin
                    │  routing • layout │
                    │  session • GraphQL│
                    └─────────┬─────────┘
                              │  remoteEntry.js, loaded at runtime
        ┌───────────┬─────────┼─────────┬────────────┐
   ┌────┴───┐  ┌────┴───┐ ┌───┴────┐ ┌──┴─────┐ ┌────┴────┐
   │ people │  │ timeoff│ │  docs  │ │ perf   │ │   …     │
   └────────┘  └────────┘ └────────┘ └────────┘ └─────────┘
     own container, own pipeline, own remoteEntry URL, each
```

- **Host** owns routing, layout, the session, and every GraphQL call.
- **Remotes** export components. They receive data as props. They hold no session
  logic and never call the router directly.
- **Auth is not a remote.** It is a separate origin and a separate ordinary app,
  because passkeys are pinned to the origin that created them and cookies do not
  cross origins. Federating the login screen would break both.
- `@reach/ui` stays a normal workspace dependency compiled by each consumer,
  exactly as it is compiled by Next and Vite today. It is shared as an MF
  singleton so one copy is loaded at runtime.

### TanStack Start, evaluated

You lean this way, so it gets a fair hearing. It has real advantages here, and
one disqualifying problem for the specific thing you want it for.

**What it has going for it, and it is not a short list:**

- Best-in-class type-safe routing, which matters unusually much in a repo whose
  merge gate is an authoritative TypeScript pass.
- Vite — the same bundler that already compiles `@reach/ui` directly for
  Storybook. One bundler across the repo instead of Rspack alongside Vite.
- A far healthier ecosystem, English documentation and community than Modern.js.
- **TanStack is already in the dependency tree.** `packages/ui` depends on
  `@tanstack/react-table` and `@tanstack/react-virtual` today.
- TanStack Query pairs naturally with a federated GraphQL layer.

**The problem is Module Federation specifically.**
[TanStack/router#7032](https://github.com/TanStack/router/issues/7032) is titled
"Adding @module-federation/vite breaks vanilla @tanstack start project". The
mechanism is precise: Module Federation installs `resolve.alias` entries whose
custom resolver redirects `react` and `react-dom` to `loadShare(...)` virtual
modules, and **under SSR `loadShare` returns undefined and the app crashes.**

It is fixable. The community reference repo
[`tanstack-start-with-module-federation`](https://github.com/alexandre-marchina/tanstack-start-with-module-federation)
documents the workarounds, which amount to hooking `configResolved`, detecting
the SSR environment, and skipping the plugin's own aliases. That is patching a
build plugin's internals from your application config.

Two things make that worse than it sounds:

1. **It has regressed before.**
   [TanStack/router#4516](https://github.com/TanStack/router/issues/4516) — "TanStack
   router 1.121 breaks @module-federation/vite". A workaround that reaches into
   another plugin's resolver is exactly the kind that breaks silently on a minor
   version bump.
2. **Client-only remotes do not avoid it.** The aliases are installed globally,
   so the SSR environment still sees them. You need the patch either way.

The Module Federation ecosystem's own guidance is that `@module-federation/vite`
is designed primarily for CSR, and that "for most teams, client-only remotes
inside an otherwise server-rendered host is the lower-risk choice."

### So: three coherent options, and one incoherent one

|                               | **A. Modern.js + MF** | **B. TanStack Start, no MF** | **C. TanStack Start + MF**  |
| ----------------------------- | --------------------- | ---------------------------- | --------------------------- |
| Runtime remote entries        | ✅                    | ✗ (route-level splitting)    | ⚠️ with a plugin patch      |
| SSR of remote components      | ✅                    | n/a                          | ✗ crashes without the patch |
| Independent deploy            | ✅                    | ✅ via zones                 | ✅                          |
| Type-safe routing             | ordinary              | **best in class**            | best in class               |
| Bundler matches Storybook     | ✗ Rspack              | ✅ Vite                      | ✅ Vite                     |
| Ecosystem, docs, community    | thin                  | **strong**                   | strong                      |
| Survives a minor version bump | ✅                    | ✅                           | ⚠️ has not, twice           |
| Officially supported          | ✅ by the MF team     | ✅ by TanStack               | ✗ by neither                |

**C is the incoherent one.** It takes TanStack Start's best property — a
well-supported, well-documented, type-safe stack — and immediately puts it on an
unsupported build path that both upstreams have broken. You end up owning the
integration between two projects, neither of which has agreed to keep it working.

**Recommendation, in order:**

1. **If runtime Module Federation is the requirement, take Modern.js (A).** It is
   the only stack where this is supported rather than worked around, and the MF
   core team maintains both halves.
2. **If TanStack Start is the requirement, take it without Module Federation
   (B)** — zones plus route-level code splitting. You keep independent deploys;
   you lose runtime remote loading and soft navigation across module boundaries.
3. **Do not take C.**

### One correction to my own earlier argument

I said SSR was essential because deskless staff are on low-end Android. That is
right about **first paint of the shell** and about the login screen, and the host
renders both either way in every option above.

It is weaker about module screens than I implied. This is an authenticated HRIS:
nothing is indexable, the user has already waited through a login, and the screens
are data-heavy tables. Client-rendered module content behind an SSR'd shell is a
smaller loss than the earlier draft suggested.

That refinement matters, because it means **B is a genuinely viable choice and not
a consolation prize.** If TanStack Start's typed routing and healthy ecosystem are
worth more to you than soft navigation between modules — and for a team of this
size they plausibly are — B is defensible on the merits.

### What this costs

Honest accounting, since Modern.js is Trial and not Adopt:

| Cost                                                     | Size                                                            |
| -------------------------------------------------------- | --------------------------------------------------------------- |
| Rewrite `apps/web`                                       | Small. Three files. `lib/tenant.ts` ports unchanged             |
| Rewrite `proxy.ts` as Modern.js middleware               | Small, but it is isolation-critical code — port the tests first |
| Lose `next/image`, `typedRoutes`, App Router conventions | Real, minor, replaceable                                        |
| Thinner documentation, smaller community                 | Real. Expect to read Modern.js source occasionally              |
| Framework in Trial rather than Adopt                     | Accepted deliberately; the alternative is deprecated            |

**None of this touches the auth design.** Origins, cookies, RP IDs, session slots
and the lifecycle are browser and database concerns. They are identical under
Next, Modern.js, or anything else.

---

## Execution

Each phase ends green on the gates the repo already has: `just check-strict`,
`pnpm lint`, `pnpm boundaries`, `pnpm codegen`, `just standalone <module>`, the
RLS integration test, and axe over every story.

### Phase 0 — scaffolding

Add `platform/*` to the workspace, add the two dependency-cruiser rules, create
`svc_identity`, fix the port collision. Stand up the ingress and prove one zone
routes through it. Nothing user-visible.

### Phase 1 — contracts first

`packages/contracts/src/events/identity.ts`: `account.provisioned`,
`account.invited`, `account.enrolled`, `account.suspended`, `account.terminated`,
`session.started`, `session.revoked`, `credential.registered`,
`credential.removed`, `recovery.requested`, `recovery.approved`.

Every field classified. `pnpm codegen` is the gate, and it fails on the first
unclassified one. Doing this before any implementation means the redaction paths,
the DSAR manifest and the AI deny list are right by construction rather than
retrofitted.

### Phase 2 — the domain, test-first

`platform/identity/src/domain/`. Pure, `Clock` injected, `Result`-returning, and
per the working style: **failing test before implementation, without exception**,
because this is the layer where the bugs are the ones that matter.

What lives here: the account state machine, the session slot invariant, enrolment
token validity, step-up freshness, the last-two-admins rule, the effective-dating
rule that stops a future hire logging in early.

### Phase 3 — persistence and isolation

Migrations (expand-contract, no down migrations). RLS policies with `FORCE` and
the `NULLIF` form. The partial unique index for rehire. Integration tests against
a real Postgres, extending the pattern in
`packages/db-kit/src/tenant.integration.test.ts`, including the one that asserts
the session cap holds under **concurrent** inserts — that test is the reason the
slot design exists and it is the one that must not be skipped.

### Phase 4 — the auth origin

`apps/auth`: Next app on `auth.app.kithena.com`. Passkey registration and
assertion, the enrolment flow, the OAuth authorization and token endpoints.
Rate limiting in Valkey, per IP and per account, before a session exists.

Screens come from `@reach/ui` and nothing else. The design system must not learn
what an account is — that boundary is already enforced.

### Phase 5 — the tenant side

Callback handler, session cookie, `getPrincipal()`, the JWT minter, JWKS
publication. The proxy learns to distinguish "no tenant" (404, already built)
from "no session" (302 to the auth origin).

### Phase 6 — Google Workspace

OIDC against Google, `hd` verified against the tenant's verified domain list, DNS
TXT verification with scheduled re-checks, `sub` as the identifier. The refusal
path — valid credential, no account — gets its own test, because it is the one
that protects the commissioning requirement.

### Phase 7 — the loop closes

The `people.person.terminated` consumer, timezone-correct. The session list
screen. HR-mediated recovery with the delay-and-notify window. Impersonation with
its banner, its time box and its audit stream.

Only at this point is the thing coherent: **Phase 7 is what makes Phase 2 mean
anything.** An auth system that can create accounts but not reliably destroy
access is not half-built, it is a liability, and it should not reach a customer
tenant in that state.

### Phase 7.5 — headless

The `IdentitySource` port, the token-exchange endpoint, `platform.tenant_issuer`
and the claim mapper. Then `just standalone-external` into the CI matrix, which
is the part that makes it stay true.

Deliberately after Phase 7 rather than before: the port should be extracted from
a working implementation, not guessed at ahead of one.

### Phase 8 — enterprise surface, bought rather than built

SAML 2.0 and SCIM 2.0 inbound, as connectors terminating at the edge of
`platform/identity`. Deliberately last: both are adapters onto a model that is by
then settled, and integrating them earlier would let a vendor's shape leak into
the core.

---

## Decisions

Answered from the research above where the evidence settled it; open where it
genuinely is.

### Settled

| #   | Decision                            | Answer                                                        | Grounds                                                                                                                           |
| --- | ----------------------------------- | ------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| 1   | tRPC in `services/*` / `platform/*` | **No**                                                        | `CLAUDE.md` + `.dependency-cruiser.cjs`. Flagged, not worked around                                                               |
| 2   | Frontend framework                  | **Modern.js if MF is required; TanStack Start if not**        | `nextjs-mf` is deprecated. MF+SSR is supported only on Modern.js; on TanStack Start it needs a plugin patch that has broken twice |
| 3   | Frontend split                      | **Module Federation, component-level, one remote per module** | SSR forbids application-level modules. Host owns routing and all data fetching; remotes stay presentational                       |
| 4   | Hosting                             | **Containers behind one ingress**                             | The cookie and WebAuthn design needs an ingress that owns the origin. Costs `#10`/`#12`                                           |
| 5   | Identity plane                      | **Build**                                                     | WorkOS and Clerk are US-only; the differentiators are all HR-lifecycle data no vendor holds                                       |
| 6   | SAML 2.0 and SCIM                   | **Buy**, as connectors, Phase 8                               | Undifferentiated protocol grind with a bad security history when hand-rolled                                                      |
| 7   | Passwords                           | **None, ever**                                                | SP 800-63B-4 makes FIDO2 the standard, deprecates email OTP, downgrades SMS                                                       |
| 8   | Deskless enrolment                  | **In scope for v1**                                           | Nearly free once passkey-first — hybrid transport is a QR code. No incumbent does it natively                                     |
| 9   | Platform tier                       | **New `platform/*` tier**                                     | Identity has no entitlement and nobody buys it                                                                                    |
| 10  | Session cap semantics               | **Per `(identity, tenant)`, evict LRU, notify**               | Refusing gets the limit raised by support, which is worse than no limit                                                           |
| 11  | Headless / bring-your-own-identity  | **Supported, via RFC 8693 token exchange**                    | Same anti-sticky rule as `requiresPeopleSource`. Gated by `just standalone-external`                                              |

### Still open

| #   | Decision                                                                            | Notes                                                                                                              |
| --- | ----------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| A   | When do SAML and SCIM become urgent?                                                | Determines whether Zitadel/Keycloak beats build-plus-connector. Answer is a sales question, not an engineering one |
| B   | Which ingress — Traefik, Envoy, or a managed k8s Ingress?                           | Affects nothing above; all three do path rewriting and origin ownership                                            |
| F   | Is the route manifest static or fetched at runtime?                                 | Static is simpler; runtime is what makes a remote genuinely shippable without a host deploy                        |
| C   | Do we keep Vercel for `apps/docs` and `apps/storybook`?                             | Recommend yes. They are static, public, and have none of the cookie constraints                                    |
| D   | Attestation policy — offer hardware-bound-only as a tenant setting in v1, or defer? | Only regulated buyers ask. Defer unless one is already in the pipeline                                             |
| E   | IP retention window before truncation                                               | 30 days proposed. A DPO question more than an engineering one                                                      |
| G   | Is tenant branding on the login page opt-in or opt-out?                             | Recommend opt-out (branded by default). It publishes the customer relationship                                     |
| H   | Rasterise tenant logos on upload, or serve from a separate asset origin?            | Rasterising is simpler and closes the SVG-XSS path outright                                                        |

---

## Sources

- [NIST SP 800-63B-4, Digital Identity Guidelines](https://pages.nist.gov/800-63-4/sp800-63b.html) — FIDO2 as the standard, email OTP deprecated, AAL2 must offer a phishing-resistant option
- [Module Federation — Next.js integration](https://module-federation.io/integrations/framework/nextjs/) — deprecation notice, App Router not supported
- [module-federation/core#3153](https://github.com/module-federation/core/issues/3153) — the wind-down
- [BambooHR passkeys](https://www.bamboohr.com/product-updates/bamboohr-passkeys) — November 2025; absent for SSO-only companies
- [Rippling passkey troubleshooting](https://help.rippling.com/s/article/11506693330) — passkey after email and password
- [Google: verify the ID token](https://developers.google.com/identity/gsi/web/guides/verify-google-id-token) — the email domain is insufficient; use `hd`
- [Truffle Security: Google OAuth flaw](https://trufflesecurity.com/blog/millions-at-risk-due-to-google-s-oauth-flaw) — defunct-domain takeover inherits `hd` claims
- [WorkOS on data residency](https://workos.com/blog/data-residency-for-enterprise-saas) and [AuthKit passkeys](https://workos.com/docs/authkit/passkeys)
- [CIAM Compass: data residency and sovereignty](https://guptadeepak.com/ciam-compass/guides/data-residency-and-sovereignty/) — Clerk has no EU auth-plane hosting selector
- [Open-source CIAM comparison, 2026](https://guptadeepak.com/ciam-compass/alternatives/open-source-ciam/) — Zitadel and Keycloak for self-hosted EU
- [Modern.js on the Thoughtworks Technology Radar](https://www.thoughtworks.com/en-us/radar/languages-and-frameworks/modern-js) — Trial, Vol 34, April 2026
- [Modern.js: Module Federation with SSR](https://modernjs.dev/guides/topic-detail/module-federation/ssr) — streaming only, component-level only, experimental data fetching
- [TanStack/router#7032](https://github.com/TanStack/router/issues/7032) — `@module-federation/vite` breaks a vanilla TanStack Start project
- [TanStack/router#4516](https://github.com/TanStack/router/issues/4516) — router 1.121 broke `@module-federation/vite`
- [tanstack-start-with-module-federation](https://github.com/alexandre-marchina/tanstack-start-with-module-federation) — the documented workarounds
- [WorkOS: Google OAuth's strict redirect URI matching](https://workos.com/blog/google-oauths-strict-redirect-uri-matching) — no wildcards, ~100 URIs, no management API
- [web.dev: Related Origin Requests](https://web.dev/articles/webauthn-related-origin-requests) and [passkeys.dev](https://passkeys.dev/docs/advanced/related-origins/) — the five-registrable-domain cap
