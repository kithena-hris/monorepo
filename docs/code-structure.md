# Code structure

Where files go, what they are called, and the three ideas that decide both.

`CLAUDE.md` owns the rules that fail the build. This file explains the shape
those rules are protecting, and fills in what it does not cover: the frontend
layout, and how SOLID, domain-driven design and vertical slicing apply here
specifically rather than in general.

---

## Folders

### The problem with `apps/*` today

`apps/` currently mixes two products. `apps/web` and `apps/admin` are **Kithena**.
`apps/docs` and `apps/storybook` are **Reach**, which `CLAUDE.md` says must never
learn Kithena exists. Flattening more frontends into the same folder makes that
boundary harder to see, not easier.

And there is going to be more than one shell. Three, in fact — one per origin.

### The layout

```
apps/
  web/                     acme.app.kithena.com      ← Kithena
    shell/                   host: routing, layout, session, data
    people/                  remote
    timeoff/                 remote
  auth/                    auth.app.kithena.com      ← Kithena
    shell/                   login, enrolment, recovery
  admin/                   admin.kithena.com         ← Kithena
    shell/                   host
    tenants/                 remote
  docs/                    design.kithena.com        ← Reach, unchanged
  storybook/               storybook.kithena.com     ← Reach, unchanged

platform/
  identity/                accounts, credentials, sessions, tenant registry

services/
  people/
  timeoff/

packages/                  unchanged
tools/                     unchanged
```

**One folder per origin.** That is the grouping that means something: an origin is
a cookie boundary, a WebAuthn RP boundary and a deploy boundary all at once. A
folder that groups by anything else groups by nothing enforceable.

`pnpm-workspace.yaml` gains one line:

```yaml
packages:
  - 'apps/*' # docs, storybook — directories without a package.json are ignored
  - 'apps/*/*' # shells and remotes
  - 'platform/*'
  - 'packages/*'
  - 'services/*'
  - 'tools/*'
```

### Naming

| Thing            | Folder             | Package name           |
| ---------------- | ------------------ | ---------------------- |
| Host             | `apps/web/shell`   | `@kithena/web-shell`   |
| Remote           | `apps/web/people`  | `@kithena/web-people`  |
| Auth host        | `apps/auth/shell`  | `@kithena/auth-shell`  |
| Back-office host | `apps/admin/shell` | `@kithena/admin-shell` |

`<origin>-<slice>`, always. `turbo run build --filter './apps/auth/*'` then means
"everything on the auth origin", which is the same set as "everything that
deploys together".

### `apps/auth` holds one app, deliberately

Auth is six screens with no team boundary and no shared state with any module.
Federating it into `auth-login`, `auth-enrolment` and `auth-recovery` would be
three deploy pipelines for something nobody is blocked on.

So `apps/auth/shell` is an ordinary Modern.js app, not a host. The folder exists
because it is an origin, and because splitting later should be a move rather than
a restructure. **Do not federate it just because the folder shape allows it.**

---

## Vertical slicing

### Slice first, layer inside

`CLAUDE.md` mandates four layers:

```
src/domain/  src/application/  src/infrastructure/  src/graphql/
```

Vertical slicing says organise by feature instead. These are usually presented as
alternatives. They are not — they compose, and the composition is the one worth
having:

```
platform/identity/src/
  enrolment/                       ← slice
    domain/          EnrolmentToken, its validity rules
    application/     EnrolAccount use case
    infrastructure/  token repository
    http/            POST /enrol
  session/                         ← slice
    domain/          Session, Slot, the four-device invariant
    application/     StartSession, RevokeSession, RevokeAllForAccount
    infrastructure/  Postgres repository, Valkey cache
    http/
  credential/
  account/
  shared/                          ← only what genuinely spans slices
```

A feature is one folder. Reviewing "how does enrolment work" means opening one
directory, not four. The layer rule still holds _inside_ each slice, so the
dependency direction is unchanged.

### The rule this quietly breaks

`.dependency-cruiser.cjs` currently says:

```js
name: 'no-domain-importing-infrastructure',
from: { path: '^services/[^/]+/src/domain/' },
to:   { path: '^services/[^/]+/src/(infrastructure|graphql|http)/' },
```

`^services/[^/]+/src/domain/` matches `services/people/src/domain/`. It does
**not** match `services/people/src/enrolment/domain/`.

So the moment a slice appears, this rule stops matching and stops failing.
Nothing breaks, nothing warns, and the guarantee is simply gone. That is the worst
failure mode a build gate has.

Fix it in the same change that introduces the first slice:

```js
from: { path: '^(services|platform)/[^/]+/src/(?:[^/]+/)?domain/' },
to:   { path: '^(services|platform)/[^/]+/src/(?:[^/]+/)?(infrastructure|graphql|http)/' },
```

Add a slice-isolation rule while you are there — a slice may not import another
slice's internals, only `shared/`. Same reasoning as no-cross-module-imports, one
level down.

### When not to slice

A slice per feature is right when features have their own vocabulary. It is
overhead when they do not. `services/timeoff` may well be one slice for a long
time, and forcing three empty layer folders inside a `leave-request/` slice that
contains four files is ceremony.

**Rule of thumb:** start flat, slice when a second feature arrives that shares
none of the first one's language.

---

## Domain-driven design

### Bounded contexts are already the module boundary

`services/people`, `services/timeoff`, `platform/identity`. Separate schemas,
separate roles, no imports between them, communication by events. That is a
bounded context with the boundary actually enforced, which is rarer than the
diagram suggests.

The **anti-corruption layer** is `src/integration/` — the folder
`.dependency-cruiser.cjs` already exempts from the orphan rule, describing it as
"the interfaces an external provider is adapted _to_". Workday's idea of a person
is translated there and nowhere else.

### Aggregates in identity

| Aggregate root | Contains       | Consistency boundary                             |
| -------------- | -------------- | ------------------------------------------------ |
| `Identity`     | `Credential[]` | one human's passkeys and linked accounts         |
| `Account`      | `Session[]`    | **one person at one company, and their devices** |

The second row is the interesting one, and it is not arbitrary.

**Sessions live inside the Account aggregate because the four-device rule spans
them.** An invariant that spans entities is the definition of an aggregate
boundary — you cannot enforce "at most four" by looking at one session. Account is
the thing that must be consistent, so Account is the root, so `Session` has no
repository of its own.

That is also _why_ the slot design works. The aggregate is the lock; the unique
index is the same rule expressed where a race cannot slip past it.

### And the tension that creates, handled honestly

Loading a whole Account aggregate on every HTTP request to answer "is this session
valid" would be absurd.

So the write side and the read side differ:

- **Writes** go through the aggregate. `StartSession`, `RevokeSession` load
  `Account`, enforce the invariant, save.
- **Reads** use a thin query against the session cache. No aggregate, no domain
  objects, no mutation. It answers one question and cannot change anything.

This is CQRS in its mild form, and it is worth naming rather than letting someone
discover a "shortcut" later and assume it was sloppiness.

### Ubiquitous language

These words mean one thing each. Using them loosely in code review is how a model
rots.

| Term           | Means                                       | Does not mean |
| -------------- | ------------------------------------------- | ------------- |
| **Identity**   | one human, globally, across all employers   | their account |
| **Account**    | one human at one company                    | their session |
| **Credential** | a passkey or a linked external login        | a password    |
| **Session**    | one signed-in device, occupying a slot      | a token       |
| **Principal**  | the verified claims a request carries       | the user      |
| **Commission** | HR creating an account                      | enrolment     |
| **Enrol**      | a person registering their first credential | logging in    |
| **Assert**     | proving possession of a credential          | enrolling     |
| **Revoke**     | ending a session                            | terminating   |
| **Terminate**  | ending employment, permanently              | suspending    |

`Principal` and `commission` are already used this way in `auth-kit` and in the
existing docs. The rest of the list exists so the next twenty files agree.

### Value objects, not primitives

`Slot`, `TenantId`, `PersonId`, `CalendarDate`, `Instant` — several already exist
as branded Zod types in `packages/contracts/src/primitives.ts`. A `slot: number`
that can hold `-3` is a bug the type system was willing to prevent and was not
asked to.

---

## SOLID, applied to this codebase

Generic SOLID is a lecture. Here is what each letter actually buys, in files that
exist or are about to.

### S — Single responsibility

The account state machine knows nothing about HTTP, Postgres or WebAuthn. It is
already enforced: `no-domain-importing-infrastructure` fails the build.

The practical test is not "is this class small" but **"how many reasons does this
file have to change?"** A use case that both decides policy and formats a
response has two.

### O — Open for extension

This is the letter that pays here, because HR gets to configure login methods.

Adding SMS OTP must not mean editing the sign-in use case:

```
AuthenticationMethod            ← port
  ├── PasskeyMethod
  ├── OidcMethod
  ├── PasswordMethod
  └── SmsOtpMethod              ← new file, nothing else changes
```

The use case asks the tenant policy which methods are enabled and dispatches. If
adding a method requires a `switch` to grow, the abstraction is wrong.

### L — Liskov substitution

**This letter is the headless requirement.** `IdentitySource` has two
implementations — our own provider, and an external issuer reached by token
exchange — and every caller must work with either without knowing which.

The moment something asks `if (source instanceof KithenaIdentity)`, mode 4 is
broken. `just standalone-external` is the test that catches it.

### I — Interface segregation

`PermissionCheck` in `auth-kit` already has three methods because there are three
genuinely different needs — `check`, `filter`, `listAccessible` — and a list
endpoint that only had `check` would become an N-query loop.

Follow the same instinct in identity. Not one `AuthService`, but:

```
CredentialVerifier   AccountRepository   SessionStore
TokenMinter          Clock               TenantPolicyReader
```

Small ports are also what make tests cheap, which is what makes the test-first
rule in `CLAUDE.md` survive contact with a deadline.

### D — Dependency inversion

Domain declares the port, infrastructure implements it. `Clock` in
`@kithena/domain-kit` is the existing example, and `CLAUDE.md` bans `new Date()`
in domain code for exactly this reason: effective-dated logic is untestable
otherwise.

Ports live with the slice that needs them, not in a shared `interfaces/` bucket.
A port in a shared folder is a port every slice is tempted to widen.

---

## Frontend structure

### Inside a remote

Same idea, one level down. A remote is sliced by screen:

```
apps/web/people/src/
  directory/
    DirectoryScreen.tsx
    DirectoryTable.tsx
    useDirectoryFilters.ts        ← display state only
  profile/
    ProfileScreen.tsx
  index.ts                        ← the only file federation exposes
```

`index.ts` is the public surface. Everything else is internal, and the build
should say so — deep imports across remotes are the frontend version of a
cross-module import.

### The rule that keeps remotes honest

**No business rules in a component.** `CLAUDE.md` already says authorization lives
in the domain and application layers and never only in a resolver, because GraphQL
is one transport of four. A React component is not even a transport — it is a
rendering of one.

So a remote may decide _how_ to show that a leave request is rejected. It may not
decide _whether_ it is.

Practically: remotes contain display logic, formatting, local UI state. They do
not contain eligibility rules, entitlement checks, or permission decisions. Those
arrive as data.

### The contract between shell and remote

The shell passes props. Those prop types must not be imported from the remote —
that would couple the host to a remote it is supposed to load blindly.

**Generate them from the GraphQL operations instead.** Both sides derive from the
supergraph, which CI already rejects breaking changes against. The schema is the
contract; neither side imports the other.

### Why the shell holds the session

One place reads the cookie. One place mints a token. One place talks to the
router. A remote that could read the session would be a remote that could be
loaded onto a page it was not designed for and still authenticate — and there is
no reason for it to have that power.

Single responsibility, but the reason is containment rather than tidiness.
