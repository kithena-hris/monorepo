# Environments

Two environments, and one rule that shapes everything else.

## Staging never holds real customer data

Not a copy, not a subset, not "just to reproduce this one bug". This is an HRIS:
the data is legal name, home address, salary, bank details, sickness and
parental leave, and some of it is [GDPR Article
9](https://gdpr-info.eu/art-9-gdpr/) special-category data.

Staging gets synthetic data from `tools/scripts/seed-staging.ts`. If production
data is ever genuinely needed to reproduce something, it is anonymised first by
a script that lives in this repository and is reviewed like any other change —
not by an ad-hoc dump on somebody's laptop.

Separate databases, separate credentials and separate Vercel projects exist to
make the wrong thing hard rather than merely forbidden.

## What they are

|             | Staging                              | Production                   |
| ----------- | ------------------------------------ | ---------------------------- |
| Deployed    | from a pull request, once `ci` green | from `main`, once `ci` green |
| Approval    | none                                 | required, on the environment |
| Tenants     | `<company>.staging.app.kithena.com`  | `<company>.app.kithena.com`  |
| Back-office | `admin.staging.kithena.com`          | `admin.kithena.com`          |
| Database    | Neon `staging` branch                | Neon `main` branch           |
| Data        | synthetic only                       | real customers               |
| Customers   | test                                 | real                         |

## Promotion

```
PR opened / pushed
   └─ ci (14 checks) ──green──▶ migrate staging ──▶ deploy ──▶ smoke test
                                                              └─ url on the PR
merge to main
   └─ ci (14 checks) ──green──▶ approval ──▶ migrate production ──▶ deploy
                                                              └─ smoke test
                                                                 └─ fails? roll back
```

Both halves trigger on `workflow_run` after `ci` and refuse anything whose
conclusion is not `success`. A separate workflow cannot use `needs:`, and
without that guard either would deploy a commit whose tests failed.

**Migrations run before the deploy, never after.** Expand-contract means the new
schema is readable by the old code, so migrating first is safe. Migrating second
leaves a window where new code reads columns that do not exist yet.

## Rolling back

Production promotes the previous deployment when its smoke test fails. That is
seconds, where a revert-and-redeploy is minutes.

**The database is not rolled back with it, and there are no down migrations.**
The previous build reads the new schema perfectly well — that is what
expand-contract buys. Undoing the migration is what would break it. A bad
migration is fixed forward, by another migration, reviewed like anything else.

## One-time setup

### DNS, at Cloudflare

Cloudflare holds the zone and issues the wildcard certificate. Vercel cannot
issue one without controlling DNS, and moving DNS to Vercel would mean
recreating these same records there instead.

**Recreate these five before changing nameservers.** They carry
`info@kithena.com`, and the domain is where mail delivery is decided. Verify a
real message arrives before switching, not after.

| Type | Name                   | Value                                                |
| ---- | ---------------------- | ---------------------------------------------------- |
| MX   | `@`                    | `mx1.spacemail.com` (priority 0)                     |
| MX   | `@`                    | `mx2.spacemail.com` (priority 0)                     |
| TXT  | `@`                    | `v=spf1 include:spf.spacemail.com ~all`              |
| TXT  | `spacemail._domainkey` | `v=DKIM1;k=rsa;p=MIIBIjANBgkq…` (see below)          |
| SRV  | `_autodiscover._tcp`   | `autoconfig.spacemail.com:443`, priority 0, weight 0 |

The DKIM value is long and must be copied whole; a truncated key fails
silently, in the sense that mail still sends and quietly starts failing
authentication. Read it back from the registrar rather than retyping it.

Two records also currently point the documentation sites at Vercel and need to
come across:

| Type | Name        | Value         |
| ---- | ----------- | ------------- |
| A    | `design`    | `76.76.21.21` |
| A    | `storybook` | `76.76.21.21` |

The back-office needs two more. It is deliberately **not** under
`*.app.kithena.com`: a browser will not offer an employee's passkey to a
relying party it does not match, so putting the back-office on its own
registrable domain means an operator's credential and an employee's cannot be
confused for one another. That isolation costs two DNS records and nothing else.

| Type  | Name            | Value                             |
| ----- | --------------- | --------------------------------- |
| CNAME | `admin`         | the Vercel project's alias target |
| CNAME | `admin.staging` | the Vercel project's alias target |

Then add the wildcards:

| Type  | Name            | Value                             |
| ----- | --------------- | --------------------------------- |
| CNAME | `*.app`         | the Vercel project's alias target |
| CNAME | `*.staging.app` | the Vercel project's alias target |

### Postgres, at Neon

One project, two branches: `main` for production and `staging` for staging. The
staging branch is a copy-on-write fork, which is what makes resetting it cheap
enough to actually do.

**The application must not connect as `neondb_owner`.** Neon's default role is
not a superuser, but it carries `BYPASSRLS`, which has the same effect: it reads
every tenant's rows regardless of any policy.

Measured on this project rather than assumed, on the staging branch, against a
table with `ENABLE` and `FORCE ROW LEVEL SECURITY` and a policy that matches
nothing when no tenant is set:

| Connected as   | `BYPASSRLS` | Rows visible with no tenant scope |
| -------------- | ----------- | --------------------------------- |
| `neondb_owner` | yes         | **2 — both tenants**              |
| `app_runtime`  | no          | 0                                 |

Scoped to one tenant, `app_runtime` sees that tenant's row and no other. So the
application connects as a role created `NOBYPASSRLS`; migrations may run as the
owner, because they are supposed to see everything.

Checking the attribute is one query, and worth doing after any role change:

```sql
SELECT rolname, rolsuper, rolbypassrls FROM pg_roles WHERE rolcanlogin;
```

The earlier version of this file said "must not be a superuser". That was the
right instinct and the wrong test — `neondb_owner` passes it and leaks anyway.

See [SECURITY.md](../SECURITY.md#writing-a-row-level-security-policy) for the two
details every policy needs.

### Why the back-office does not rebuild on every push

`apps/admin/vercel.json` sets an ignore command:

    npx --yes turbo-ignore @kithena/admin

`vercel.json` takes no comments, so the reason is here. Vercel's Git
integration builds a project on every push to every branch, and on 2026-08-22
that hit the Hobby plan's daily build limit — thirteen of the last twenty
deployments were Dependabot branches touching packages the back-office does not
depend on. The check on the open pull request then failed with
`upgradeToPro=build-rate-limit`, which looks exactly like a broken build and is
not one.

`turbo-ignore` asks turbo whether anything in `@kithena/admin`'s dependency
graph actually changed since the last deployment, and exits 0 to skip when
nothing did. A Dependabot bump to Storybook no longer spends a build; a change
to `packages/contracts` still does, because the back-office imports it.

This is a quota workaround. It is also just correct — a build that cannot
produce a different artifact is a build worth skipping — so it stays whatever
plan this ends up on.

### The auth origin's server

`apps/auth/shell` pins `typescript` to 6 while the rest of the repository uses
7. Modern.js compiles `server/` with the TypeScript programmatic API —
`TypescriptLoader({ appDirectory }).load()`, resolving from the app directory —
and `CLAUDE.md` already records that 7.0 ships no programmatic API. Concretely,
`require('typescript').sys` is `undefined` on 7.0.2 and the build dies in
`getFormatHost`. The pin is on that one package, so nothing else slows down.

Two things that do *not* fix it, both tried: a `pnpm.overrides` entry keyed
`@modern-js/server-utils>typescript`, which cannot work because typescript is
only a devDependency there and no edge exists to override; and a
`packageExtensions` entry, which does place TS6 inside server-utils but is
resolved from the wrong place — the loader looks in the app directory, not its
own.

`apps/auth/shell/server/modern.server.ts` is a Modern.js custom Web Server. It
injects the internal token identity requires, and turns the session id identity
returns into an `HttpOnly`, `Secure`, `SameSite=Strict`, `__Host-` cookie —
removing it from the response body on the way.

It replaces a `tools.devServer.proxy` entry with two faults. The proxy passed
the body through untouched, so the session id arrived as JSON any script on the
origin could read; and `tools.devServer` only runs under `modern dev`, so a
built auth origin had no credential injection at all.

An earlier attempt at this concluded the feature was broken on 3.8.2 — that
middlewares never ran and that a type-only import panicked Rspack. Both
findings were wrong. Three stale `modern dev` processes were holding port 3100,
so every measurement was taken against a server running different code. The
symptom to recognise is `Port 3100 is in use. using port 3101.` in the startup
output: after that line, nothing you curl on 3100 is the server you started.

### A note on where this repository lives

`~/Desktop/workspace/claude/kithena`, with iCloud "Desktop & Documents" sync
turned on. That combination produces conflict copies — `composition 2.ts`,
`src/routes 2`, `oxlint 12` — because iCloud makes one whenever it sees
concurrent writes, and a build tool writes thousands of files in seconds.

1,531 were cleared from a single checkout on 2026-08-22, and thirteen copies of
real source files reached `main` on an earlier occasion. `.gitignore` now
matches directories and two-digit copies as well as the obvious
`name 2.ext` case, but that is a net rather than a cure: the repository wants
moving somewhere iCloud does not watch.

### Identity, on Vercel

`platform/identity/api/[...path].ts` is the whole of the deployment surface: a
Vercel Node function that awaits the same `compose()` router `src/main.ts` puts
behind `node:http`. A Node function receives `VercelRequest` and
`VercelResponse`, which extend `IncomingMessage` and `ServerResponse`, so every
route moved across unchanged and so did its tests.

This ran on Fly until 2026-08-22. The reason it did was real at the time — the
service held a Postgres pool *and a Valkey connection* across requests, and a
function-per-request runtime takes both away. Valkey is gone: challenges live
in Postgres, because a Valkey machine with no declared services could not be
autostarted by Fly's proxy and took a passkey enrolment down with it. What was
left was a Postgres pool, and Neon ships a pooler for exactly that.

So the argument had already dissolved before the platform was changed. What
finally decided it was operational: a trial organisation reaps idle machines,
refuses `fly deploy` for new Launch machines, and had left production with zero
machines for a day. Two platforms for one product, one of which could not
deploy.

Three things this depends on, none of them optional:

  * **The pooled Neon host.** `IDENTITY_DATABASE_URL` must be the `-pooler`
    endpoint. A serverless instance opening a direct connection each time is
    the objection that sent this to a container in the first place.
  * **`prepare: false` and `max: 1`** on the postgres client, set in
    `composition.ts`. Neon's pooler is PgBouncer in transaction mode, which
    hands a different server connection to each transaction — a prepared
    statement made on one is missing on the next. It fails as
    `prepared statement "s1" does not exist`, under concurrency and nowhere
    else.
  * **A custom domain.** `ssoProtection` is `all_except_custom_domains`, so
    every `*.vercel.app` host answers `302` to a login page. Only
    `identity.staging.kithena.com` and `identity.kithena.com` are reachable,
    which is also why the smoke tests name them rather than the deployment URL.

`Dockerfile` and `src/main.ts` stay, and are not dead weight. They are what
`just dev` runs, and they are the reason this is still an HTTP server that
happens to be deployed as a function rather than one that can only ever be a
function. Nothing under `src/` imports anything from Vercel.


### Until then, the back-office is a locked door

The workflows deploy `apps/admin`, and it will serve its sign-in page and
refuse everything else — every page but that one fails closed to a redirect.
It cannot sign anybody in until `INTERNAL_API_URL` points at a running identity
service, which is what the section above is for.

Deploying the back-office before identity is therefore safe and useless in equal
measure, and it is worth knowing which before pointing DNS at it.

**And on this plan there is nothing in front of that door.** Vercel's Hobby plan
offers no deployment protection: not password protection, not Vercel
Authentication, and the API refuses `ssoProtection` on production outright. The
same sentence already appears in `CLAUDE.md` about the Reach sites. It matters
more here, because this is the only surface that crosses tenants — so the
application's own `currentOperator()` check is the entirety of what stands
between the internet and every customer's account list. It is written to fail
closed, including when identity is unreachable, which is the state it will be in
on the day it first deploys.

### Origins

Every enrolment and recovery link is built from `AUTH_ORIGIN`, and two services
read it: identity mints the link, messaging refuses to send one that is not on
that origin. They must agree, and the value differs per environment.

| Setting        | Local                            | Staging                          | Production                |
| -------------- | -------------------------------- | -------------------------------- | ------------------------- |
| `AUTH_ORIGIN`  | `http://auth.app.localhost:3100` | `https://auth.staging.kithena.com` | `https://auth.kithena.com` |
| `ADMIN_ORIGIN` | `http://localhost:3001`          | `https://admin.staging.kithena.com` | `https://admin.kithena.com` |

Set on the identity, messaging and tenant-app projects alike. A deployment that
sets it on one of them has services disagreeing about which links are ours, and
the symptom is every invitation refused as `untrusted_link` — a message that
names neither the setting nor the mismatch.

Identity **refuses to start** in production without it. That is deliberate: the
fallback is a localhost address, and a service that quietly emails a new hire a
link to a machine that is not theirs fails in a way nothing downstream can
detect. A boot failure naming the variable is the cheaper outcome.

### Secrets

Per GitHub Environment, never repository-wide, so a job cannot read the other
environment's database by accident:

| Secret          | Staging                                        | Production         |
| --------------- | ---------------------------------------------- | ------------------ |
| `DATABASE_URL`  | Neon `staging` branch                          | Neon `main` branch |
| `ATLAS_DEV_URL` | a throwaway database Atlas drops and recreates | same               |

`ATLAS_DEV_URL` must never point at the database being migrated. Atlas drops
everything in it to compute a diff.

### People, the router and the remote

Both deploy workflows ship three more things, in this order, between the
migration and the tenant app:

```
migrate ──▶ People (Fly) ──▶ Cosmo Router (Fly) ──▶ People remote (Vercel) ──▶ shell (apps/web)
```

Schema, then service, then client, one layer further out each time. Production
rolls all of them back when a smoke test fails — clients first, then the
router, then People — and never the database.

**People runs on Fly.io, not as a Vercel function like identity and
messaging.** Identity moved to Vercel once it held nothing between requests.
People holds three things a function-per-request runtime takes away: Kafka
consumer groups, the hourly and daily jobs in `infrastructure/background.ts`,
and the SIGTERM drain that lets a message in hand and a job in flight finish
(PEO-118). A function has no process to keep in a group and no clock to tick.
The Cosmo Router is a Go binary with no serverless build at all. Fly is the
container host this repository already used for identity, and
`services/people/Dockerfile` follows identity's.

**It needs a paid Fly organisation.** Identity left Fly because a *trial*
organisation reaps idle machines and refused `fly deploy` for new machines,
which left production with none for a day. That was the plan, not the
platform, and a trial organisation would do the same to People.

How each piece is shipped:

- **People** — `flyctl deploy` with `services/people/fly.toml`, built on Fly's
  remote builder from the repository root. Never scaled to zero, SIGTERM with a
  30-second kill timeout so the drain finishes. Smoke: `/v1/openapi.json`,
  which is only mounted once `PEOPLE_DATABASE_URL` is set, so a machine that
  booted without its database fails it.
- **The router** — `apps/gateway/Dockerfile`: the router image pinned by
  version and digest, with `config.yaml`, `deploy.yaml` (a file execution
  config, telemetry off), the composed `supergraph.json` and the safelist at
  `/persisted`. The supergraph is composed in the job from
  `services/people/schemas/people.graphql`, routed to
  `http://<people app>.internal:4001` over Fly's private network — so both
  apps must be in the same Fly organisation. The image is started on the runner
  first (`apps/gateway/scripts/smoke.ts`): a persisted operation must pass and
  an unknown hash must be refused, or nothing is pushed. The live router is
  then checked for readiness and for refusing a request without a token; it
  cannot be asked about the safelist, because only a token identity minted for
  a signed-in session gets that far.
- **The People remote** — built and **signed in the job** with the environment's
  `PEOPLE_REMOTE_SSR_SIGNING_KEY`, then `apps/web/people/dist` is uploaded as
  static files with the committed `vercel.json` headers. Vercel never builds
  it and never holds the key: a build Vercel could sign is a build a
  compromise of Vercel could sign. Smoke (`apps/web/people/scripts/smoke-deploy.mjs`):
  `remoteEntry.js`, `routes.json`, `people.cjs` and the signed manifest are
  served `no-cache`, `nosniff` and with CORS for a tenant origin, and the
  manifest verifies under the public key the shell is about to be given.
- **The shell** gets `PEOPLE_REMOTE_URL`, `PEOPLE_REMOTE_SSR_PUBLIC_KEY` and
  `ROUTER_URL` (`https://<router app>.fly.dev`) as `--env` on its deploy, each
  only when set.

Each piece is skipped with a warning while its app or project variable is
unset, so the workflows run green before any of this exists.

#### Created by hand, once

| What | Where | Notes |
| --- | --- | --- |
| A paid Fly.io organisation | fly.io | Not a trial one; see above. |
| Fly app for People, staging and production | `fly apps create <name> --org <org>` | Names go in `FLY_APP_PEOPLE_*`. |
| Fly app for the router, staging and production | `fly apps create <name> --org <org>` | Same organisation as People, for `.internal`. Names go in `FLY_APP_ROUTER_*`. |
| Vercel project for the People remote, staging and production | Vercel, team `kithena` | Framework **Other**, Root Directory **empty**, no build command. **Do not connect the Git repository**: a Git build is unsigned. Add a custom domain to each — the `.vercel.app` host is behind SSO. Ids go in `VERCEL_PROJECT_ID_PEOPLE_REMOTE_*`. |
| An Ed25519 key pair per environment | locally, see below | Private half to the environment secret, public half to the repository variable. |
| A Kafka cluster (Redpanda) reachable from Fly | — | See "Not covered" below. |

The key pair, as base64 DER — PKCS#8 for the private half, SPKI for the public:

```bash
node -e "const k=require('node:crypto').generateKeyPairSync('ed25519');
console.log('private', k.privateKey.export({format:'der',type:'pkcs8'}).toString('base64'));
console.log('public ', k.publicKey.export({format:'der',type:'spki'}).toString('base64'))"
```

#### GitHub: environment secrets (Settings → Environments → `staging` / `production`)

Same names in both environments, different values.

| Secret | Holds |
| --- | --- |
| `FLY_API_TOKEN` | A Fly deploy token for the organisation (`fly tokens create org`). |
| `PEOPLE_API_TOKEN` | The token the router sends People as `x-internal-token`. Staged onto both Fly apps on every deploy, so the two cannot disagree. Random, 32+ bytes. |
| `PEOPLE_REMOTE_SSR_SIGNING_KEY` | The Ed25519 private key, base64 PKCS#8 DER. Never put in Vercel. |

#### GitHub: repository variables (Settings → Secrets and variables → Actions → Variables)

| Variable | Holds |
| --- | --- |
| `FLY_APP_PEOPLE_STAGING`, `FLY_APP_PEOPLE_PRODUCTION` | The Fly app name for People. Unset: People and the router are skipped. |
| `FLY_APP_ROUTER_STAGING`, `FLY_APP_ROUTER_PRODUCTION` | The Fly app name for the router. Also gives the shell its `ROUTER_URL`. |
| `AUTH_TOKEN_AUDIENCE_STAGING`, `AUTH_TOKEN_AUDIENCE_PRODUCTION` | Exactly identity's `AUTH_TOKEN_AUDIENCE` in that environment (`kithena-router` locally). A mismatch refuses every token. |
| `KITHENA_ENTITLEMENTS_STAGING`, `KITHENA_ENTITLEMENTS_PRODUCTION` | Exactly identity's `KITHENA_ENTITLEMENTS`, a JSON array, e.g. `["module.people"]`. |
| `VERCEL_PROJECT_ID_PEOPLE_REMOTE_STAGING`, `VERCEL_PROJECT_ID_PEOPLE_REMOTE_PRODUCTION` | The remote's Vercel project id (`prj_…`). Unset: the remote is skipped. |
| `PEOPLE_REMOTE_URL_STAGING`, `PEOPLE_REMOTE_URL_PRODUCTION` | The remote's custom domain, `https://…`, no trailing slash. The shell's `PEOPLE_REMOTE_URL`. |
| `PEOPLE_REMOTE_SSR_PUBLIC_KEY_STAGING`, `PEOPLE_REMOTE_SSR_PUBLIC_KEY_PRODUCTION` | The Ed25519 public key, base64 SPKI DER. The shell's `PEOPLE_REMOTE_SSR_PUBLIC_KEY`. |

The router's `AUTH_JWKS_URL` is identity's own domain
(`identity.staging.kithena.com`, `identity.kithena.com`) and is written in the
workflow, as the identity smoke tests already are.

#### Fly: People's own secrets (`fly secrets set --app <people app>`)

Set once by hand; the workflow stages only `PEOPLE_API_TOKEN`. What each does
is in `.env.example`.

- `PEOPLE_DATABASE_URL` — the Neon branch, connecting as `svc_people`, never
  `neondb_owner` (see "Postgres, at Neon"). The direct endpoint rather than
  `-pooler`: this is a long-lived process with its own pool, and it prepares
  statements.
- `KAFKA_BROKERS` — without it People serves the graph and consumes nothing.
  For a managed cluster add the `KAFKA_SASL_*` and `KAFKA_TLS*` settings in
  "Kafka: SASL and TLS" below.
- `IDENTITY_URL`, `PEOPLE_IDENTITY_TOKEN` — reconciliation against identity's
  account listing.
- `MESSAGING_URL`, `MESSAGING_PEOPLE_TOKEN`, `TENANT_APP_BASE` — reminder mail.
- `OPENFGA_URL`, `OPENFGA_STORE_ID` — authorisation.
- `TEMPORAL_ADDRESS`, `TEMPORAL_NAMESPACE` — the full-values export workflow.
- `PEOPLE_SECRET_KEYS` — the key ring for stored secrets.
- `PEOPLE_PUBLIC_URL`, `PEOPLE_EXPORT_LINK_BASE`, `PEOPLE_EXPORT_BUCKET`,
  `PEOPLE_EXPORT_ENCRYPTION_KEY`, `PEOPLE_EXPORT_SIGNING_KEY`, `S3_*`,
  `VALKEY_URL` — exports; all optional, in memory when unset.

#### Kafka: SASL and TLS

People and identity build their Kafka client from one helper,
`kafkaConfigFrom` in `packages/db-kit/src/kafka.ts`, so a broker that needs
credentials works for every consumer or for none. A broker on a private
network needs only `KAFKA_BROKERS`; a managed Redpanda needs SASL/SCRAM and
TLS as well:

| Setting | Holds |
| --- | --- |
| `KAFKA_BROKERS` | Comma-separated `host:port`. Unset: nothing consumes. |
| `KAFKA_SASL_MECHANISM` | `scram-sha-256` or `scram-sha-512`, as the cluster's user was created. |
| `KAFKA_SASL_USERNAME`, `KAFKA_SASL_PASSWORD` | The SCRAM user. A secret; never logged (kafkajs logs the broker only, and the password is not enumerable on the config object). |
| `KAFKA_TLS` | `true` or `false`. Unset: on when SASL is set, off otherwise. |
| `KAFKA_TLS_CA` | Optional PEM bundle for a broker with a private CA. Implies TLS. Certificate checks cannot be turned off. |

The three SASL settings go together or not at all. Half of them, an unknown
mechanism, an unreadable `KAFKA_TLS` or a `KAFKA_TLS_CA` that is not PEM stops
the process at boot rather than connecting without the credentials it was
meant to have; with `NODE_ENV=production`, SASL with `KAFKA_TLS=false` does as
well. The error names the setting, never its value.

#### Not covered here

- **The outbox relay.** Debezium is not deployed anywhere yet, so People's
  outbox rows are written and nothing publishes them.

## Local

`just dev` brings up the whole compose stack. Tenants resolve at
`<company>.app.localhost`, which most browsers send to `127.0.0.1` without a
hosts entry. `TENANT_HOST_SUFFIX` in `.env.example` is already set to match.

### The local S3

Production stores objects in Oracle Object Storage (exports, backups) and
Cloudflare R2 (browser uploads), both through the S3 API. Locally and in the
integration tests that is SeaweedFS, `weed mini`, pinned by digest in
`docker-compose.yml` and `packages/testing/src/containers.ts` — keep the two
the same. S3 is on `:9000` (`S3_ENDPOINT`), the admin UI on `:9001`, and the
buckets `kithena-dev` and `people-exports` are created on boot by `-bucket`.

It replaced MinIO in September 2026, when MinIO's images stopped being publicly
pullable. Each candidate was run against the same checks:

| Check | SeaweedFS 4.47 | RustFS 1.0.0 | Garage 2.4.1 |
| --- | --- | --- | --- |
| SigV4, wrong secret refused | yes | yes | yes |
| Several buckets | yes, created on boot | yes | yes, after a layout and key bootstrap |
| SSE-S3 (`AES256`) stored and reported | yes, no key to set | only with a master key set | accepted, not reported |
| Presigned GET; tampered URL refused | yes | yes | yes |
| Presigned PUT; a length other than the signed one refused | yes | yes | yes |
| Rejects a checksum that does not match the body, as S3 does | yes | no | yes |
| `PutBucketCors`; preflight allows the origin, refuses another | yes | yes | allows `*` to any origin |
| 100 MB multipart round trip, checksum intact | yes | yes | no, CRC32 mismatch on read |
| Ready from start | ~3 s | ~5 s | needs a CLI bootstrap |
| linux/amd64 and linux/arm64 | yes | yes | yes |
| Licence | Apache-2.0 | Apache-2.0 | AGPL-3.0 |

RustFS passed nearly as much, but it accepted a presigned PUT carrying a
checksum of the wrong body, which S3 refuses — a test against it would have
passed for an upload production rejects. That checksum is worth knowing about
for anyone presigning: AWS SDK v3 adds `x-amz-checksum-crc32` of an empty body
to a presigned `PutObject` unless the client is built with
`requestChecksumCalculation: 'WHEN_REQUIRED'`, and the browser's upload then
fails with `BadDigest`.
