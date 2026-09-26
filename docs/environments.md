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

## What a deploy ships

Only what changed. Vercel Hobby allows 100 deployments a day across every
project, and shipping all eight on every merge, every staged pull request
push and every preview spent that before the day was out.

**Targets.** Each deploy workflow knows these, one gated group of steps each:

| Target          | Ships                         | Affected by                                                               |
| --------------- | ----------------------------- | ------------------------------------------------------------------------- |
| `shell`         | `apps/web` (tenant app)       | `@kithena/web` or anything it depends on                                  |
| `auth`          | `apps/auth/shell`             | `@kithena/auth-shell` …                                                   |
| `admin`         | `apps/admin`                  | `@kithena/admin` …                                                        |
| `identity`      | `platform/identity`           | `@kithena/identity` …                                                     |
| `messaging`     | `platform/messaging`          | `@kithena/messaging` …                                                    |
| `docs`          | `apps/docs`                   | `@reach/docs` … (production and previews only)                            |
| `storybook`     | `apps/storybook`              | `@reach/storybook` … (production and previews only)                       |
| `people-remote` | `apps/web/people`             | `@kithena/web-people` … (not previewed)                                   |
| `people`        | People's image, on the VM     | `@kithena/people` …, `deploy/vm/**`                                       |
| `router`        | the router's image, on the VM | `@kithena/gateway` … (config, persisted operations), `services/people/schemas/**`, `deploy/vm/**` |
| `migrations`    | Atlas, Neon and the VM        | `migrations/**`, `atlas.hcl`                                              |

"…" is turbo's graph: a change to `packages/ui` reaches `shell`, `auth`,
`admin`, `docs`, `storybook` and `people-remote`; one to `packages/contracts`
reaches every app and service importing it. On top of that, every target but
`migrations` ships when `pnpm-lock.yaml`, the root `package.json`,
`pnpm-workspace.yaml`, `turbo.json`, `.npmrc`, `tsconfig.base.json` or
`patches/` changes, and every target of a workflow ships when that workflow
file or `tools/scripts/src/affected-targets.ts` changes. The mapping lives in
that one script, with its tests beside it.

**Measured against what is running, not against the previous commit.** After a
target deploys and passes its checks, the `mark` job moves a lightweight tag
`deployed/<env>/<target>` (`production` or `staging`) to that commit. The next
run diffs its commit against each target's tag, both trees, so:

- a deploy that failed, or was rolled back, moves no tag, and the next run
  ships that target again;
- a target skipped for a run keeps its older tag, so a change it has not
  shipped yet is still in the next diff;
- a target with no tag has never been deployed, and deploys.

Staging diffs the same way even though its commits come from different pull
request branches: going back from another branch's change is a change.
Previews diff against the pull request's merge base instead of a tag.

Nothing listens for these tags and a tag moved by `GITHUB_TOKEN` starts no
workflow. List them with `git ls-remote origin 'refs/tags/deployed/*'`.
Deleting one forces that target's next deploy.

**Forcing a deploy.** A secret or a variable changes nothing in git, so a
change there needs asking for:

```bash
gh workflow run vercel-production.yml -f targets=identity,messaging
gh workflow run vercel-production.yml -f targets=all
gh workflow run vercel-staging.yml --ref <branch> -f targets=shell
```

The named targets ship on top of whatever has changed; an empty `targets`
ships only what changed, which is how to retry. Production runs from `main`
only, and still needs the environment's approval. The first run after this
landed has no tags and ships everything once.

**What a merge costs.** Over the 40 merges to `main` before this change, every
one shipped all eight Vercel projects: 320 deployments. Measured with the
script, the same merges ship 203 — a People or identity change ships one, a
`packages/ui` change six. The rest of the 203 is the two things that still
ship everything: a change to `vercel-production.yml` (six of the 40) and a
dependency bump through the lockfile or root `package.json` (nine). A merge
touching only `docs/` or a root Markdown file ships nothing.

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

### Hosting: People, the router and the remote

Both deploy workflows ship three more things, in this order, between the
migration and the tenant app:

```
migrate ──▶ People (VM) ──▶ Cosmo Router (VM) ──▶ People remote (Vercel) ──▶ shell (apps/web)
```

Schema, then service, then client, one layer further out each time. Production
rolls all of them back when a smoke test fails — clients first, then the
router, then People — and never the database.

**AWS is the only backend host.** People and the router run on one EC2
`c7i-flex.large` (2 vCPU, 4 GB, amd64, Ubuntu 24.04) in `us-east-1`, under
Docker Compose, stopped whenever nobody is using it ("The AWS host" below).
People holds three things a function-per-request runtime takes away: Kafka
consumer groups, the hourly and daily jobs in `infrastructure/background.ts`,
and the SIGTERM drain that lets a message in hand and a job in flight finish
(PEO-118). The Cosmo Router is a Go binary with no serverless build at all. So
they need a process, and the process lives on an instance that also runs what
they lean on. The frontends stay on Vercel Hobby, and identity and messaging
stay Vercel functions. Every object People stores — browser uploads, export
files, reports — and the nightly backups are in Amazon S3.

```
                         Cloudflare edge (TLS, DNS)
    browser / shell ──▶  api.kithena.com
       │                      │  Cloudflare Tunnel (outbound from the VM; no inbound port)
       │  presigned PUT  ┌─ EC2 c7i-flex.large, us-east-1 (sleeps when idle) ───────────┐
       │                 │  compose project kithena-production                          │
       │                 │   cloudflared ──▶ router :4000 ──▶ people :4001 ──┬─▶ redpanda │
       │                 │        └──── /v1/exports/files/* ─────────▶┘      ├─▶ temporal │
       │                 │                                                    ├─▶ openfga  │
       │                 │                                                    ├─▶ valkey   │
       │                 │                                                    └─▶ postgres │
       │                 │  amazon-ssm-agent ◀── deploys, operator (SSM, dials out)       │
       │                 │  instance role kithena-vm (IMDSv2, hop limit 2)               │
       │                 └───────────────────────────────┬──────────────────────────────┘
       ▼                                                 ▼
    S3 kithena-<account>-uploads     S3 kithena-<account>-exports, -backups

    shell, back-office, auth origin, identity, messaging (Vercel, always on)
    identity ──▶ Neon Postgres (platform schema, svc_identity)
```

**People's data lives in the VM's Postgres; identity's stays on Neon.** Identity
is request-driven and Neon lets it sleep between requests. People is a
long-running process that polls its own tables every minute (due webhook
deliveries) and every five (reconciliation), which would keep a Neon Free
compute awake around the clock: ~182 CU-hours a month against Neon Free's 100,
and the compute suspended from about the 16th. On the VM it costs nothing
extra.

Only the router is public, as `api.<domain>`, plus the one People path a
browser has to open directly: the signed, expiring export links. Everything
else — People's GraphQL and REST, Temporal, OpenFGA, Redpanda, Valkey, the VM
Postgres — is reachable only on the Compose network. That includes People's
REST API and the published schema artifact (`PEOPLE_PUBLIC_URL/v1/schema/versions/N`,
§13.4): a customer integration reaching `/v1/*` needs its own tunnel route when
it is wanted, and deciding which paths are public is that change's job.

**SCIM (PEO-072) is the next public path, and it is not routed yet.** People
serves it at `/scim/v2/*` on its own port and authenticates it itself, with
each connection's bearer token — an identity provider holds no user token, so
the router cannot front it. The integrations screen shows the base URL as
`PEOPLE_SCIM_URL`, else `PEOPLE_PUBLIC_URL` + `/scim/v2`
(`https://api.kithena.com/scim/v2` in production). Until the route below
exists, a provider pointed at it reaches the router and gets its 401. To do,
by an operator, not by a deploy:

- [ ] Add the public hostname rule `api.kithena.com`, path `^/scim/v2/` →
      `http://people:4001`, **above** the router's catch-all, on
      `kithena-production` (and `api.staging.kithena.com` on
      `kithena-staging`). In the dashboard (step 5 below), or through
      Cloudflare's API for a remotely managed tunnel: read the current
      ingress with `GET /accounts/{account_id}/cfd_tunnel/{tunnel_id}/configurations`,
      insert the rule before the last entry, and `PUT` the whole
      `config.ingress` back — the PUT replaces the list, so the export-links
      rule and the catch-all must be in it.
- [ ] Check it from outside: `curl -i https://api.kithena.com/scim/v2/Users`
      answers `401` with `content-type: application/scim+json` (People's),
      not the router's.
- [ ] Know that the VM sleeps (below). A provider that pushes while it is
      stopped gets Cloudflare's 530 and retries on its own schedule — Okta
      and Entra both do — but nothing wakes the VM for it. If a tenant needs
      provisioning to land within minutes at any hour, the VM has to stay
      up, which is a cost decision, not a code change.

Companies without a recorded module list (PEO-114) are refused SCIM unless
People's own environment carries `KITHENA_ENTITLEMENTS` (the same JSON array
the router has); a SCIM request carries no forwarded list to fall back on.

#### What ships, and how

- **Images** — a job on a native runner of the VM's architecture, chosen by the
  `VM_PLATFORM` repository variable (`linux/amd64`, the default and what the
  EC2 `c7i-flex.large` is, on `ubuntu-24.04`; `linux/arm64` on
  `ubuntu-24.04-arm` stays an option for a Graviton instance; both runners
  free for a public repository, and no QEMU) builds both images and proves them before anything is
  pushed. The router image is `apps/gateway/Dockerfile` with the supergraph
  composed against `http://people:4001` — People's name on the Compose
  network, the same in every environment, so one router image serves both —
  and `apps/gateway/scripts/smoke.ts` starts it: a persisted operation must
  pass, an unknown hash must be refused, a request without a token must get
  401. People's image (`services/people/Dockerfile`, `node:24-bookworm-slim`)
  must boot and answer `/health`, which is where a native module built for the
  wrong architecture dies. Both are pushed to GHCR as
  `ghcr.io/<owner>/kithena-{people,router}:<sha>`.
- **Onto the VM** — the deploy job assumes `kithena-deploy-wake` through
  GitHub's OIDC token, starts the instance, waits for its SSM agent to be
  `Online`, and SSHes in as `deploy` through a Session Manager tunnel
  (`AWS-StartSSHSession`) with the environment's `VM_DEPLOY_SSH_KEY`. It
  copies `deploy/vm/` to `~deploy/kithena`, writes the settings
  from the GitHub environment into root-only 0600 files on stdin, logs the VM
  into GHCR with the job's own token (expires with the job) and runs
  `deploy.sh <env> migrate`, then `deploy.sh <env> people <image>`, then
  `deploy.sh <env> router <image>`.
- **People's migrations** — the repository has one migration directory, one
  `atlas.sum` and one revision table, not a directory per module, and People's
  migrations lean on objects outside `people` (`platform.touch_updated_at()`
  on every `updated_at` trigger; a guarded check of `messaging.delivery`). So
  the split is by database, not by file: the workflow's existing step lints and
  applies the whole directory to Neon, where identity reads `platform`, and
  `deploy.sh migrate` applies the same directory to the VM's `kithena`
  database, where People reads `people`. Each database carries schemas nobody
  there uses, empty. `deploy.sh migrate` makes sure the database and its roles
  exist — `migrator` (owner, runs migrations, `CREATEROLE BYPASSRLS`, not a
  superuser: the same powers Neon's owner has), the service roles NOLOGIN as
  the "atlas dev roles" step creates them — then runs Atlas 0.37.0 (the version
  the Neon step pins, as a digest-pinned container) with `atlas.hcl`'s `vm`
  environment, then gives `svc_people` its login. `svc_people` stays
  `NOBYPASSRLS` and every `people` table `FORCE ROW LEVEL SECURITY`, as the
  migrations make it. Expand-contract still: a rollback never runs it.
  `deploy.sh` records the image it replaces, pulls, starts the service, waits
  for its healthcheck and then checks it properly: People must serve
  `/v1/openapi.json` (only mounted once `PEOPLE_DATABASE_URL` is set, where
  `/health` would pass without it) and then query `people.tenant` through its
  own URL as `svc_people` — the pool connects lazily, and a wrong password
  was shown to fail here and nowhere earlier; the router must answer
  `/health/ready`.
- **The router, from outside** — `ROUTER_URL/health/ready` through the tunnel,
  and a request without a token must get 401. The safelist was proven on the
  image; the live router refuses anything without a token identity minted for
  a signed-in session, which a workflow must never hold.
- **Rollback (production)** — the same `deploy.sh` call with the image the
  deploy printed as `previous=`. The VM keeps every image an environment is on
  or would roll back to, so a rollback never depends on the registry.
- **The People remote** — built and **signed in the job** with the environment's
  `PEOPLE_REMOTE_SSR_SIGNING_KEY`, then `apps/web/people/dist` is uploaded to
  Vercel as static files with the committed `vercel.json` headers. Vercel
  never builds it and never holds the key. Smoke
  (`apps/web/people/scripts/smoke-deploy.mjs`): the files are served
  `no-cache`, `nosniff` and with CORS for a tenant origin, and the manifest
  verifies under the public key the shell is about to be given.
- **The shell** gets `PEOPLE_REMOTE_URL`, `PEOPLE_REMOTE_SSR_PUBLIC_KEY` and
  `ROUTER_URL` as `--env` on its deploy, each only when set.

People and the router are skipped with a warning while `ROUTER_URL_<ENV>` is
unset, and the remote while its project variable is, so the workflows run green
before any of this exists.

**Staging is opt-in.** It is a second Compose project on the same VM
(`kithena-staging`, `compose.staging.yaml`, its own tunnel and volumes) and it
only deploys once `ROUTER_URL_STAGING` is set. On a 4 GB VM leave it unset:
staging runs at production's limits, and the two together are 5.3 GB of
limits. It needs an 8 GB instance for both (`m7i-flex.large`), or a second
instance of its own.

#### Memory budget

Sized for 4 GB. The limits add up to 2.66 GB, leaving the kernel, Docker,
containerd, the SSM agent and the page cache (which Postgres leans on) about a
gigabyte. `bootstrap.sh` adds 4 GB of swap as headroom, at swappiness 10. They
are limits, not reservations, and they were set from measurement: the stack
run locally from these files through `deploy.sh` (arm64, cgroup v2), idle
after boot, then under a light load — every persisted operation through the
router ten times over, two imports through the GraphQL flow the People screens
use (2,000 and 1,600 rows: upload, dry run, commit) and two exports, the
second over 2,000 rows so it went through the BullMQ queue. Peak is the
highest `docker stats` reading across two such runs.

| Container | Idle | Light load, peak | Limit | Knobs |
| --- | --- | --- | --- | --- |
| people | 233 MB | 566 MB | **768 MB** | `NODE_OPTIONS=--max-old-space-size=384` |
| postgres (People's data, Temporal, OpenFGA) | 99 MB | 247 MB | **512 MB** | `shared_buffers=128MB`, `effective_cache_size=512MB`, `work_mem=4MB`, `maintenance_work_mem=32MB`, `max_connections=80` |
| redpanda | 78 MB | 100 MB | **512 MB** | `--memory 320M`, `--smp 1`, dev-container mode (overprovisioned, no reserved memory) |
| temporal (auto-setup) | 138 MB | 303 MB | **448 MB** | `GOMEMLIMIT=320MiB`; pools `SQL_MAX_CONNS=5`, `SQL_VIS_MAX_CONNS=2` |
| router | 28 MB | 52 MB | **128 MB** | `GOMEMLIMIT=100MiB` |
| openfga | 16 MB | 57 MB | **128 MB** | `GOMEMLIMIT=100MiB`; `MAX_OPEN_CONNS=10` |
| valkey | 7 MB | 15 MB | **128 MB** | `maxmemory 64mb`, `noeviction` (BullMQ); limit twice that for the AOF rewrite's fork |
| cloudflared | 20 MB | 46 MB | **96 MB** | — |
| **Total** | **0.6 GB** | **1.4 GB** | **2.66 GB** | |

Nothing was OOM-killed and nothing restarted except `cloudflared`, which had
a dummy token and no tunnel to reach, so its figure is the binary retrying, not
carrying traffic. People is the one that moves: its peak was a 2,000-row
commit, and a much larger import is the first thing to watch
(`docker stats`); the heap cap turns a runaway into a heap error rather than
the OOM killer taking the consumers and the workers down with it. Postgres
connections at rest were 40 of 80 — Temporal's four services each open their
own pools, which at the image's defaults (30 each) would exceed Postgres' 100
on their own. CPU limits are caps on 2 vCPUs, deliberately oversubscribed.

Staging (`compose.staging.yaml`) overrides nothing: it runs at these sizes,
so it wants a VM of its own or an 8 GB one shared.

#### The AWS host

**Production runs on one EC2 `c7i-flex.large` in `us-east-1`, in an account on
AWS's Free plan, and the instance is stopped whenever nobody is using it.** A
stopped instance bills no compute and no public IPv4 address; only its 30 GB
volume is charged. The VM stops itself when idle and the People pages start it
again, so the credits pay for the hours somebody works rather than for every
hour. `deploy/aws/provision.sh` makes all of it — the instance, its role, the
three buckets, the wake roles and the budget — and prints every change before
it makes one.

**Architecture.** Four places, each doing the one thing it is cheapest at:

| Piece | Where | Always on? |
| --- | --- | --- |
| Tenant app (shell), People remote, back-office, auth origin, Reach docs | Vercel Hobby | Yes |
| Identity and messaging | Vercel functions; identity's data on Neon Free | Yes (Neon's compute sleeps between requests) |
| People, the router, Redpanda, Temporal, OpenFGA, Valkey, People's Postgres | One EC2 `c7i-flex.large`, reached only through Cloudflare Tunnel (public) and AWS Systems Manager Session Manager (deploys, SSH); no inbound port | No: sleeps when idle, wakes on demand |
| Uploads, exports, reports, backups | Amazon S3, three private buckets in the same region | Yes |

**The Free plan** (accounts opened since July 2025): up to $200 of credits —
$100 at sign-up and up to $100 more for trying services — spent against normal
usage, for 6 months or until the credits run out, whichever comes first.
Within it only some instance types may be launched: `t3.micro`, `t3.small`,
`t4g.micro`, `t4g.small`, `c7i-flex.large` and `m7i-flex.large`.
**`c7i-flex.large` is the one that fits**: 2 vCPU and 4 GB, which is what the
memory budget above was measured for; the `t3`/`t4g` types are 1–2 GB and
cannot hold the stack. `m7i-flex.large` (8 GB, ~13% more an hour) is the step
up when staging should share the VM.

**What it costs a month** (us-east-1 on-demand):

| | Always on (730 h) | Stopped when idle (~4 h each weekday, ~90 h) |
| --- | --- | --- |
| `c7i-flex.large`, ~$0.085/h | ~$62 | ~$7.60 |
| Public IPv4, $0.005/h while running | ~$3.65 | ~$0.45 |
| 30 GB gp3, $0.08/GB-month, running or not | $2.40 | $2.40 |
| S3: a few GB at $0.023/GB-month, a few thousand requests | < $0.25 | < $0.25 |
| Data out: inside AWS's 100 GB a month free | $0 | $0 |
| EventBridge Scheduler, Budgets, IAM, Session Manager | $0 | $0 |
| **AWS, a month** | **~$68** | **~$11** |
| Vercel Hobby, Neon Free, Cloudflare (DNS, Tunnel), Resend Free, GHCR, GitHub Actions | $0 | $0 |

Always on, $200 of credits last under three months; stopped when idle, they
cover the whole six. S3's transfer from the instance is free in the same
region, and People's buckets hold little: an upload lives a day, an export
file two, a report eight, and backups thirty.

**Storage and credentials.** People writes to `kithena-<account>-uploads` and
`-exports`, and `backup.sh` to `-backups`, all as the instance role
`kithena-vm` through the SDK's (or the CLI's) default credential chain: no
access key exists anywhere. IMDSv2 is required, and its hop limit is 2, because
People runs in a container one network hop further from the metadata service
than the host; at 1, the container's token request dies on the way back and
the SDK finds no credentials. The role's whole policy:

```json
{ "Statement": [
  { "Sid": "ListTheThreeBuckets", "Effect": "Allow", "Action": "s3:ListBucket",
    "Resource": ["arn:aws:s3:::kithena-<account>-uploads",
                 "arn:aws:s3:::kithena-<account>-exports",
                 "arn:aws:s3:::kithena-<account>-backups"] },
  { "Sid": "UploadsAndExports", "Effect": "Allow",
    "Action": ["s3:GetObject", "s3:PutObject", "s3:DeleteObject"],
    "Resource": ["arn:aws:s3:::kithena-<account>-uploads/*",
                 "arn:aws:s3:::kithena-<account>-exports/*"] },
  { "Sid": "BackupsWithoutDelete", "Effect": "Allow",
    "Action": ["s3:GetObject", "s3:PutObject", "s3:AbortMultipartUpload"],
    "Resource": "arn:aws:s3:::kithena-<account>-backups/*" } ] }
```

The backups bucket has no delete: a compromised VM can add a backup but cannot
remove the good ones; its lifecycle rule deletes after 30 days. "Object
storage" below has the buckets' rules.

**While it is stopped:**

- **Identity works.** Signing in, the back-office, email: all Vercel and Neon,
  always on.
- **The People pages wait.** A request through the tunnel finds nobody
  (Cloudflare answers 530, error 1033), and the shell shows "Your workspace is
  asleep — Starting… (usually about 90 s)" instead of the screen
  (`components/workspace-asleep.tsx`). It asks `POST /api/workspace` once to
  start the instance, polls `GET /api/workspace` until EC2 says running and the
  router answers `/health/ready` through the tunnel, then reloads the view.
  Both routes want a signed-in person at a company that bought People; start
  is idempotent and sent at most once a minute per function instance.
- **S3 is untouched.** The buckets do not sleep; their lifecycle rules keep
  deleting on time, and an upload URL signed before the stop still works for
  its five minutes.
- **Jobs catch up.** Nothing is lost by stopping: Kafka offsets, BullMQ's
  queue (Valkey's append-only file) and Temporal's timers are on the volume.
  Hourly and daily jobs run at their next tick after boot, the nightly backup
  runs at boot if it was missed (`Persistent=true`), and a full-values request
  whose week ran out while asleep expires when Temporal next runs.
- **A backup is taken before every stop.** `idle-stop.sh` runs `backup.sh`,
  retries once, and refuses to stop after two failures unless the last good
  backup (`/etc/kithena/.last-backup`) is under 24 hours old.
- **A deploy wakes it.** Both deploy workflows assume `kithena-deploy-wake`
  (the deploy role; the name is older than its SSM half) through GitHub's OIDC
  token, start the instance, and wait until Systems Manager reports its agent
  `Online` before copying anything. A deploy counts as activity.

**What idle means** (`deploy/vm/idle-stop.sh`, every 5 minutes from
`kithena-idle-stop.timer`, every decision in `journalctl -u kithena-idle-stop`):
for `IDLE_STOP_MINUTES` (30 by default) no authenticated `/graphql` request in
the router's access log — the router logs only `/graphql`, never `/health`,
and a request without a valid token is a 401, which is the internet knocking,
not a person — no kithena container started and nothing deployed, nobody
logged in and no Session Manager session open, no export job queued, running or retrying in BullMQ, no pending
Temporal activity on `people-full-values`, and the VM up for more than 15
minutes. Then `backup.sh`, `docker compose stop` (People drains on SIGTERM) and
`shutdown -h now`, which `InstanceInitiatedShutdownBehavior=stop` turns into a
stop rather than a terminate. `compose stop` leaves `unless-stopped`
containers stopped, so `kithena-start.service` starts each project at boot.

**Waking needs no AWS key anywhere.** The tenant app's functions carry a Vercel
OIDC token, which `@vercel/oidc-aws-credentials-provider` exchanges for the
`kithena-workspace-wake` role through the IAM identity provider
`oidc.vercel.com/<team>`, trusted only for `sub =
owner:<team>:project:kithena-web-production:environment:production`. The role:

```json
{ "Statement": [
  { "Effect": "Allow", "Action": "ec2:StartInstances",
    "Resource": "arn:aws:ec2:<region>:<account>:instance/<id>" },
  { "Effect": "Allow", "Action": ["ec2:DescribeInstances", "ec2:DescribeInstanceStatus"],
    "Resource": "*" } ] }
```

`Describe*` cannot be narrower: EC2 has no resource-level permissions for
describe calls. It reveals instance metadata in the account, which holds
nothing else. No stop permission: only the VM stops itself. The volume is
encrypted with the account's `aws/ebs` key, whose key policy already lets EC2
use it on behalf of any principal in the account, so starting needs no KMS
grant. With `WORKSPACE_INSTANCE_ID`, `AWS_ROLE_ARN` or `AWS_REGION` unset the
routes answer 404 and the page shows People's error as before, which is how
local dev runs.

**Getting in: Session Manager, no open port.** The security group has no
inbound rule and ufw denies everything inbound. The SSM agent (a snap on
Canonical's image, registered through `AmazonSSMManagedInstanceCore` on the
instance role) dials out to Systems Manager, and every way in rides that:
IAM decides who, CloudTrail records each `StartSession`, and there is no
third-party account and no VPN.

```bash
aws sso login
aws ssm start-session --target <instance id>          # a shell, as ssm-user (sudo)

# SSH and scp, through the same tunnel (~/.ssh/config):
Host i-*
  User ubuntu
  ProxyCommand aws ssm start-session --target %h --document-name AWS-StartSSHSession --parameters portNumber=%p
```

`ssh i-…` then works as `ubuntu` with the key pair named by `--key-name`, and
`scp file i-…:` too. An open session keeps the VM awake (`idle-stop.sh`
counts it). The deploy workflows get narrower rights than the operator: the
deploy role's policy is

```json
{ "Statement": [
  { "Sid": "StartThisInstance", "Effect": "Allow", "Action": "ec2:StartInstances",
    "Resource": "arn:aws:ec2:<region>:<account>:instance/<id>" },
  { "Sid": "DescribeHasNoResourceLevelPermissions", "Effect": "Allow",
    "Action": ["ec2:DescribeInstances", "ec2:DescribeInstanceStatus",
               "ssm:DescribeInstanceInformation"], "Resource": "*" },
  { "Sid": "SshSessionToThisInstanceOnly", "Effect": "Allow", "Action": "ssm:StartSession",
    "Resource": ["arn:aws:ec2:<region>:<account>:instance/<id>",
                 "arn:aws:ssm:<region>::document/AWS-StartSSHSession"],
    "Condition": { "BoolIfExists": { "ssm:SessionDocumentAccessCheck": "true" } } },
  { "Sid": "OwnSessionsOnly", "Effect": "Allow",
    "Action": ["ssm:TerminateSession", "ssm:ResumeSession"],
    "Resource": "arn:aws:ssm:<region>:<account>:session/*",
    "Condition": { "StringLike": {
      "ssm:resourceTag/aws:ssmmessages:session-id": "${aws:userid}*" } } },
  { "Sid": "SessionDataChannel", "Effect": "Allow", "Action": "ssmmessages:OpenDataChannel",
    "Resource": "arn:aws:ssm:<region>:<account>:session/*" } ] }
```

trusted for `repo:<repo>:environment:staging` and `…:production` only. The
document check means a session without `AWS-StartSSHSession` is refused, so
the role cannot open a plain shell; SSH then wants the `deploy` key as well.
`DescribeInstanceInformation`, like EC2's describes, has no resource-level
permissions. Session ids of an assumed role begin with the role session name,
so AWS's `session/${aws:userid}-*` resource would never match; the tag Session
Manager puts on each session carries the caller instead.

#### The checklist: from an empty account to the first deploy

In order. Every step is once; rerunning a script is how a later change to it
lands.

1. **AWS account.** Sign up on the **Free plan**. Give the root user MFA and
   no access keys. Turn on **IAM Identity Center** in `us-east-1` with one
   user and the `AdministratorAccess` permission set, then on the laptop
   `aws configure sso` and `aws sso login`: the CLI signs in with short-lived
   credentials and no access key is ever created. Install the Session Manager
   plugin (`brew install --cask session-manager-plugin`, or AWS's package).
2. **Provision.** Create or import an EC2 key pair for the `ubuntu` user
   (`kithena-operator`), then `deploy/aws/provision.sh --vercel-team <team
   slug> --budget-email <you> --key-name kithena-operator` and read the plan it
   prints; then the same with `--apply`. It makes, in this order: the security
   group (no inbound rule at all); the three buckets; the `kithena-vm` role
   (with `AmazonSSMManagedInstanceCore`) and instance profile; the instance (Canonical's
   Ubuntu 24.04 amd64 AMI through the SSM parameter, 30 GB gp3 encrypted,
   IMDSv2 only with hop limit 2, the instance profile, termination
   protection, `InstanceInitiatedShutdownBehavior=stop`, a public IPv4
   released while stopped); the Vercel and GitHub OIDC providers with the
   wake role and the deploy role; and a $50 monthly budget alerting at $1, $10 and $50 of usage
   before credits. Add `--start-hour 8 --stop-hour 20 --timezone <tz>` for an
   EventBridge Scheduler pair that starts it on weekday mornings and stops it
   nightly. Keep what it prints under "settings". Wait for
   `aws ssm describe-instance-information` to list the instance `Online`.
3. **The deploy key.** One ed25519 key pair, generated locally and never on
   the VM: `ssh-keygen -t ed25519 -N '' -C kithena-deploy -f kithena-deploy`.
   The private half, `kithena-deploy`, becomes the `VM_DEPLOY_SSH_KEY`
   environment secret in both `staging` and `production`; the public half goes
   to the bootstrap. Delete both files once they are stored.
4. **Bootstrap**, over SSH through Session Manager — port 22 is never opened:
   ```bash
   ssh -o ProxyCommand='aws ssm start-session --target %h --document-name AWS-StartSSHSession --parameters portNumber=%p' \
     -i kithena-operator.pem ubuntu@<instance id> \
     "sudo DEPLOY_SSH_PUBLIC_KEY='$(cat kithena-deploy.pub)' IDLE_STOP_MINUTES=30 bash -s" \
     < deploy/vm/bootstrap.sh
   ```
   It makes sure the SSM agent is running, installs Docker and Compose,
   unattended upgrades with a 04:30 reboot, 4 GB swap (swappiness 10), then
   SSH key-only with root login off, ufw (nothing inbound at all), the
   `deploy` user with that public key, the backup timer and the idle stop.
   Check `ssh deploy@<instance id>` through the same ProxyCommand with the
   deploy key works. The end state is **zero inbound rules** on the security
   group; if `--operator-ip` ever opened 22 as a fallback, close it:
   `provision.sh … --close-ssh --apply`. Nothing reaches the VM except
   through Session Manager (which dials out) and nothing is served except
   through the tunnel. Backups need nothing more: `backup.sh` finds its
   bucket from the instance and writes with its role. An instance
   bootstrapped before SSM keeps its old VPN client until removed by hand
   (`sudo tailscale logout && sudo apt-get purge -y tailscale`).
5. **Cloudflare Tunnel.** Zero Trust → Networks → Tunnels → Create
   (`cloudflared`), one per environment (`kithena-production`, and
   `kithena-staging` if wanted). Copy the token. Public hostnames, in this
   order:
   - `api.kithena.com`, path `^/v1/exports/files/` → `http://people:4001`
   - `api.kithena.com`, path `^/scim/v2/` → `http://people:4001` (SCIM,
     PEO-072; not yet added — see the checklist above)
   - `api.kithena.com` (no path) → `http://router:4000`

   (Staging: `api.staging.kithena.com`.) Cloudflare adds the DNS record.
6. **Vercel project for the People remote**, staging and production: Framework
   **Other**, Root Directory **empty**, no build command. **Do not connect the
   Git repository**: a Git build is unsigned. Add a custom domain to each. Ids
   go in `VERCEL_PROJECT_ID_PEOPLE_REMOTE_*`.
7. **Waking.** On the tenant app's Vercel project, enable OIDC (Settings →
   Security → Secure backend access, team issuer mode).
8. **An Ed25519 key pair per environment**, private half to the environment
   secret, public half to the repository variable:
   ```bash
   node -e "const k=require('node:crypto').generateKeyPairSync('ed25519');
   console.log('private', k.privateKey.export({format:'der',type:'pkcs8'}).toString('base64'));
   console.log('public ', k.publicKey.export({format:'der',type:'spki'}).toString('base64'))"
   ```
9. **GitHub.** The environment secrets and repository variables below —
   `PEOPLE_ENV` with the bucket names `provision.sh` printed, and
   `VM_DEPLOY_SSH_KEY` in both environments, `WORKSPACE_INSTANCE_ID_PRODUCTION`,
   `WORKSPACE_INSTANCE_ID_STAGING`, `AWS_ROLE_ARN_PRODUCTION`,
   `AWS_DEPLOY_ROLE_ARN`, `AWS_REGION=us-east-1`, `VM_PLATFORM=linux/amd64`.
   The production deploy passes the first two and the region to the shell as
   `WORKSPACE_INSTANCE_ID`, `AWS_ROLE_ARN` and `AWS_REGION`.
10. **GHCR** — nothing to create: the first run publishes both packages and
    links them to the repository. Optionally set each package public
    (Package settings → Change visibility).
11. **Deploy.** Run the production workflow. Then open an import and an export
    on the People pages (the upload proves CORS and the role's `PutObject`;
    the export proves the exports bucket), leave it alone for 45 minutes,
    check `journalctl -u kithena-idle-stop` said `stop:`, the console says
    stopped and `aws s3 ls s3://kithena-<account>-backups/production/` has
    today's dump; open `/people` and watch it wake.

**Leaving the Free plan.** Before the six months or the credits end, upgrade
the account to the Paid plan in the billing console: nothing is recreated, the
same instance keeps running, the buckets stay, and the budget alerts start
meaning real money. A Free plan account that is not upgraded is closed when
the plan ends, and its resources — the buckets and the backups in them
included — go with it.

#### The bill of materials

| Piece | Service, plan | Limits that matter here |
| --- | --- | --- |
| People, router, Redpanda, Temporal, OpenFGA, Valkey | **One EC2 `c7i-flex.large`**, `us-east-1` (above) | ~$11 a month stopped when idle, paid from Free-plan credits. 30 GB of disk holds the images, the volumes and the swapfile; People's image is ~520 MB. Staging does not fit beside production (see "Memory budget"). |
| Uploads, exports, reports, backups | **Amazon S3**, three buckets | Cents a month; SSE-S3, private, lifecycle rules as below. |
| Public HTTPS for the router | **Cloudflare Tunnel** (Zero Trust Free) | Free, no bandwidth charge; the VM opens no inbound port. |
| People's database | **The VM's Postgres** | Inside the instance's disk and memory; no separate bill. No point-in-time restore — see "Backups". |
| Identity's database | **Neon Free** (unchanged) | 100 CU-hours per project a month, 0.5 GB storage, 5 GB egress; scale-to-zero after 5 minutes. Identity is request-driven and sleeps, so it sits well inside the hours. |
| Frontends, identity, messaging | **Vercel Hobby** | 100 deployments a day — every PR run spends several, one per project. **No deployment protection on production or a custom domain** (the API refuses `ssoProtection` there), which is why the back-office's own check is its only door. Hobby is non-commercial use only: the first paying customer is the trigger for Pro. |
| Email | **Resend Free** | 3,000 emails a month, 100 a day, one domain. |
| Images | **GHCR** | Container registry storage and bandwidth are currently free; the published Packages allowance on GitHub Free is 500 MB storage and 1 GB/month transfer for private packages, if that ever applies. Measured: People's image is ~520 MB uncompressed, most of it one layer that changes every commit; the router's per-commit layers are under 1 MB. Five versions of each are kept (`delete-package-versions`). Pulls by Actions are free. **Making both packages public** (the repository is public and the images hold no secret) takes them out of any quota for good. |
| CI | **GitHub Actions**, public repository | Standard runners free. |
| Private access | **AWS Systems Manager Session Manager** | Free for EC2 instances. IAM decides who, CloudTrail records every session; no inbound port, no third-party account. |

#### Why Session Manager for deploys

The deploy has to reach the VM without the VM listening on the internet. The
SSM agent dials out, so SSH through `AWS-StartSSHSession` needs no open port,
and the job's right to open that tunnel is the same OIDC-assumed role that
wakes the instance: no extra account, no OAuth client, and every session in
CloudTrail. The one secret is the `deploy` SSH key, which alone opens nothing
without the role. The alternative, SSH through Cloudflare Access, would route
deploys through the `cloudflared` container that the deploy itself manages —
a broken stack would lock out the fix. The agent runs on the host, beside
Docker rather than inside it.

#### GitHub: environment secrets (Settings → Environments → `staging` / `production`)

Same names in both environments, different values.

| Secret | Holds |
| --- | --- |
| `VM_DEPLOY_SSH_KEY` | The `deploy` user's ed25519 private key, OpenSSH format (checklist step 3). The same key in both environments while they share the VM. |
| `CLOUDFLARE_TUNNEL_TOKEN` | That environment's tunnel token (step 5). |
| `PEOPLE_API_TOKEN` | The token the router sends People as `x-internal-token`. Written to both on every deploy, so the two cannot disagree. Random, 32+ bytes. |
| `PEOPLE_ENV` | Every other People setting, as a dotenv file (below). Written to `/etc/kithena/<env>/people.env`, 0600, on every deploy. |
| `PEOPLE_REMOTE_SSR_SIGNING_KEY` | The Ed25519 private key, base64 PKCS#8 DER. Never put in Vercel. |

`PEOPLE_ENV` — one multi-line secret, so a setting People gains later (the
Kafka SASL/TLS settings, the uploads bucket) is a secret edit, not a workflow
change. What each does is in `.env.example`. `KAFKA_BROKERS`,
`TEMPORAL_ADDRESS`, `OPENFGA_URL`, `VALKEY_URL` and `PEOPLE_DATABASE_URL` are
**not** in it: they are the Compose network's addresses, set in
`compose.yaml`, and the database password is generated on the VM by
`deploy.sh` and never leaves it.

```dotenv
PEOPLE_SECRET_KEYS=k1:<base64 32 bytes>
IDENTITY_URL=https://identity.kithena.com
PEOPLE_IDENTITY_TOKEN=…
MESSAGING_URL=https://messaging.kithena.com
MESSAGING_PEOPLE_TOKEN=…
TENANT_APP_BASE=https://{slug}.app.kithena.com
PEOPLE_PUBLIC_URL=https://api.kithena.com
# Exports: S3, through the instance role. No endpoint, no keys.
PEOPLE_EXPORT_BUCKET=kithena-<account>-exports
PEOPLE_EXPORT_S3_REGION=us-east-1
PEOPLE_EXPORT_LINK_BASE=https://api.kithena.com/v1/exports/files
PEOPLE_EXPORT_ENCRYPTION_KEY=<base64 32 bytes>
PEOPLE_EXPORT_SIGNING_KEY=<base64 32 bytes>
# Uploads: S3, written by the browser with a presigned PUT People signs as the
# instance role.
PEOPLE_UPLOAD_BUCKET=kithena-<account>-uploads
PEOPLE_UPLOAD_S3_REGION=us-east-1
```

`PEOPLE_EXPORT_SSE` and `PEOPLE_UPLOAD_SSE` are left at their default,
`AES256`, which S3 honours. There is no `_S3_ENDPOINT` and no
`_ACCESS_KEY_ID`: unset, People talks to Amazon S3 and takes the instance
role from the default credential chain. `PEOPLE_UPLOAD_CORS_ORIGINS` is only
for `pnpm --filter @kithena/people upload-bucket`, which production does not
need — `provision.sh` sets the CORS. Leave the plain `S3_*` out.

Export links are People's own signed URLs, never the bucket's: People reads
the object and decrypts it on `GET /v1/exports/files/…`, which is why that one
path is routed through the tunnel and the bucket stays private. Nothing
presigns a GET.

#### GitHub: repository variables (Settings → Secrets and variables → Actions → Variables)

| Variable | Holds |
| --- | --- |
| `VM_PLATFORM` | The VM's platform: `linux/amd64` (unset means this), which the EC2 `c7i-flex.large` is; `linux/arm64` only for a Graviton instance. Picks the native runner the images are built on; anything else fails the images job. |
| `WORKSPACE_INSTANCE_ID_PRODUCTION`, `AWS_ROLE_ARN_PRODUCTION`, `AWS_REGION` | The EC2 instance id, the `kithena-workspace-wake` role and its region, all printed by `deploy/aws/provision.sh`. Passed to the shell, which then wakes the VM from the People pages. Any unset: waking is off. |
| `WORKSPACE_INSTANCE_ID_STAGING` | The instance staging deploys to, which is production's while they share it. Both ids are also the SSH target: the deploy connects to `deploy@<id>` through Session Manager. |
| `AWS_DEPLOY_ROLE_ARN` | `kithena-deploy-wake`, the deploy role both deploys assume to start the VM, wait for its SSM agent and open the SSH tunnel. Required with `ROUTER_URL_*`. |
| `ROUTER_URL_STAGING`, `ROUTER_URL_PRODUCTION` | `https://api.staging.kithena.com`, `https://api.kithena.com`. Unset: People and the router are skipped for that environment. Also the shell's `ROUTER_URL`. |
| `AUTH_TOKEN_AUDIENCE_STAGING`, `AUTH_TOKEN_AUDIENCE_PRODUCTION` | Exactly identity's `AUTH_TOKEN_AUDIENCE` in that environment (`kithena-router` locally). A mismatch refuses every token. |
| `KITHENA_ENTITLEMENTS_STAGING`, `KITHENA_ENTITLEMENTS_PRODUCTION` | Exactly identity's `KITHENA_ENTITLEMENTS`, a JSON array, e.g. `["module.people"]`. |
| `VERCEL_PROJECT_ID_PEOPLE_REMOTE_STAGING`, `VERCEL_PROJECT_ID_PEOPLE_REMOTE_PRODUCTION` | The remote's Vercel project id (`prj_…`). Unset: the remote is skipped. |
| `PEOPLE_REMOTE_URL_STAGING`, `PEOPLE_REMOTE_URL_PRODUCTION` | The remote's custom domain, `https://…`, no trailing slash. |
| `PEOPLE_REMOTE_SSR_PUBLIC_KEY_STAGING`, `PEOPLE_REMOTE_SSR_PUBLIC_KEY_PRODUCTION` | The Ed25519 public key, base64 SPKI DER. |

The router's `AUTH_JWKS_URL` is identity's own domain and is written in the
workflow.

#### Backups and restore

`kithena-backup.timer` runs `backup.sh` at 03:30 UTC for every environment on
the VM:

- `<env>/<date>/people.dump` — `pg_dump -Fc` of People's database: every
  tenant's employee records, with its owner, grants, policies and Atlas's
  revision table.
- `<env>/<date>/postgres.sql.gz` — `pg_dumpall` of everything else: the roles,
  Temporal's workflows, OpenFGA's tuples.
- `<env>/<date>/topics.txt.gz` — every `kithena.*` topic, one record per line
  (`topic key value`, key and value base64; headers are not kept).

They go to `kithena-<account>-backups` through the instance role; no key is
stored on the VM. Retention is the bucket's 30-day lifecycle rule, and the
role cannot delete. `journalctl -u kithena-backup` has the
last run. Identity's data is not in it: it is Neon's, which keeps its own
history.

**There is no point-in-time restore for People's data.** The recovery point is
the last nightly dump: a disk lost at 03:00 loses almost a day of HR changes.
That is the price of one small instance and is acceptable while the founder
is the only user. It stops being acceptable with the first customer, and the
fix is the move in "Scaling later": RDS, which has point-in-time restore.
The move is a `pg_dump` from here and a `pg_restore` there, then
`PEOPLE_DATABASE_URL` pointed at the new host (as `svc_people`, the direct
endpoint rather than a pooler — People keeps a pool of its own and prepares
statements) and the workflow's migrate step pointed at it instead of the VM.

Restore, on the VM, as root. First the helper:

```bash
env=production; day=2026-09-24; p=kithena-$env
# The instance role, through IMDSv2; the bucket is provision.sh's name for it.
aws() { docker run --rm -i -e AWS_REGION=us-east-1 amazon/aws-cli:2.31.0 "$@"; }
bucket=kithena-<account>-backups

# People's database. Roles must exist: on a fresh volume, restore
# postgres.sql.gz (below) first, or run `deploy.sh $env migrate` once.
docker compose -p $p stop people
docker exec $p-postgres-1 psql -q -U kithena -d postgres \
  -c 'DROP DATABASE IF EXISTS kithena WITH (FORCE)' -c 'CREATE DATABASE kithena OWNER migrator'
aws s3 cp "s3://$bucket/$env/$day/people.dump" - \
  | docker exec -i $p-postgres-1 pg_restore -U kithena -d kithena --exit-on-error
docker compose -p $p start people

# The rest of the VM Postgres: roles, Temporal and OpenFGA.
docker compose -p $p stop people temporal openfga
aws s3 cp "s3://$bucket/$env/$day/postgres.sql.gz" - \
  | gunzip | docker exec -i $p-postgres-1 psql -q -U kithena -d postgres
# The topics: create them, then produce every record back.
aws s3 cp "s3://$bucket/$env/$day/topics.txt.gz" - | gunzip > /tmp/topics.txt
cut -d' ' -f1 /tmp/topics.txt | sort -u | xargs docker exec $p-redpanda-1 rpk topic create
docker exec -i $p-redpanda-1 rpk topic produce -f '%t %k{base64} %v{base64}\n' < /tmp/topics.txt
```

Then `deploy.sh` the current images again (or re-run the workflow) to bring
everything back up. All three were exercised locally: People's database
wiped and restored from the dump with its rows, its 43 revisions, `migrator`
as owner and FORCE'd RLS on all 30 tables, then People healthy on it and
`deploy.sh migrate` a no-op; the rest restored into an empty Postgres with
OpenFGA's store and Temporal's namespaces intact; and records round-tripped
through the line format.

**Postgres 17 to 18.** 18 cannot open a 17 data directory, so `compose.yaml`
gives it a new volume, `postgres18` (mounted at `/var/lib/postgresql`, where
18's image keeps `18/docker`), and the first `deploy.sh` of any service on a
VM whose `postgres` volume still holds a 17 cluster moves the data before
anything starts: `backup.sh <env>` to S3 (the upgrade stops, having changed
nothing, if that fails), every other service stopped, `pg_dumpall` of the old
cluster to `/etc/kithena/<env>/`, 18 started on the new volume, the dump
restored, the roles with their password hashes and the row count of every
table compared side by side, and only then a marker written on the new volume
and the stopped services started again. The marker makes every later deploy a
no-op; a run that failed part way leaves no marker, and the next one discards
the half-made volume and starts over. The old volume is never removed:
`docker volume rm kithena-<env>_postgres` once 18 has run long enough to
trust. A retry always dumps from 17 on the old volume, never from the
half-restored 18. Rehearsed locally against a 17 volume holding People's
migrated schema, roles and rows: a failed backup changed nothing, a restore cut
short left 18 stopped and unmarked, the retry restored everything with every
password login working, and a second run did nothing.

#### Scaling later

Everything above is a set of containers, S3 buckets and URLs, so each move is a
host or a setting, not a rewrite.

| Move | When | What changes |
| --- | --- | --- |
| `c7i-flex.large` → `m7i-flex.large` (8 GB), then `m7i.xlarge` | People's peak nears its 768 MB, the swap is being used, or staging is wanted beside production | Stop, change the instance type, start (the volume, role and instance id stay), then raise the limits in `compose.yaml`. |
| People and router → ECS on Fargate | A second instance is needed (availability, or load one VM cannot carry), or a customer asks for an SLA | Same images (from GHCR, or pushed to ECR); `compose.yaml`'s environment becomes the task definition, the `kithena-vm` policy becomes the task role, the tunnel becomes an ALB. The buckets do not move. Waking and idle-stop go away. |
| Redpanda → Amazon MSK or Redpanda Cloud | Real event volume, or People running more than one replica | `KAFKA_BROKERS` and the SASL/TLS settings in `PEOPLE_ENV`, the `redpanda` service deleted. |
| Temporal → Temporal Cloud | Long-running workflows start to matter to customers, or auto-setup's single binary becomes the thing that pages | `TEMPORAL_ADDRESS`, `TEMPORAL_NAMESPACE`, mTLS settings; the `temporal` service deleted. |
| People's database: VM Postgres → Amazon RDS for PostgreSQL | The first customer (for point-in-time restore), or data or load the VM's disk and memory cannot carry | `pg_dump` here, `pg_restore` there; `PEOPLE_DATABASE_URL` in `PEOPLE_ENV` (and out of `compose.yaml`); the migrate step pointed at the new host. |
| Valkey → ElastiCache | Export queue durability matters beyond one disk | `VALKEY_URL`. |
| OpenFGA → a managed OpenFGA | Tuple volume or availability outgrows one container | `OPENFGA_URL`, `OPENFGA_STORE_ID` and credentials. |
| `us-east-1` → an EU region (`eu-central-1` or `eu-west-1`) | **Before the first real customer's data.** Employee records of EU staff belong in the EU for GDPR, and moving is cheap only while nothing real is stored | `provision.sh --region eu-…` makes a new instance and new buckets beside the old; restore the last backup there, point `PEOPLE_ENV`'s regions and bucket names and the wake variables at the new ones, deploy, then delete the old. Move Neon's project to the matching region at the same time. |
| Identity's database: Neon Free → Launch/Scale | 0.5 GB of data, the CU-hour ceiling, or the first customer | The plan. Same connection string. |
| Vercel Hobby → Pro | The first paying customer (Hobby is non-commercial), or production needs deployment protection | The plan. |

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
  outbox rows are written and nothing publishes them. It would be one more
  container on this VM.

### Object storage

Everything People stores, and the VM's backups, is in Amazon S3: three
private buckets in the instance's region, made by `deploy/aws/provision.sh`.
People keeps two stores, each its own bucket and settings, because they are
different trust boundaries:

| Bucket | Written by | Holds | Variables |
| --- | --- | --- | --- |
| `kithena-<account>-uploads` | the browser, with a presigned PUT People signs | an import's file, for its import (≤ 24 h) | `PEOPLE_UPLOAD_BUCKET`, `PEOPLE_UPLOAD_S3_*`, `PEOPLE_UPLOAD_SSE` |
| `kithena-<account>-exports` | People only | export files, import reports and dry-run reports, all sealed by People (AES-256-GCM) | `PEOPLE_EXPORT_BUCKET`, `PEOPLE_EXPORT_S3_*`, `PEOPLE_EXPORT_SSE` |
| `kithena-<account>-backups` | `backup.sh` only | `<env>/<date>/…` dumps | none: derived on the instance |

`PEOPLE_<STORE>_S3_ENDPOINT`, `_REGION`, `_ACCESS_KEY_ID` and
`_SECRET_ACCESS_KEY` each fall back to the plain `S3_*`, which is how one local
object store serves both on a laptop. **In production only the region is
set**: no endpoint means Amazon S3 (virtual-hosted URLs), and no keys means the
SDK's default credential chain, which on the instance is the `kithena-vm` role
through IMDSv2. The two keys go together or not at all; half a pair stops
People at boot. Keys remain for a store that is not on this instance, such as
a laptop's SeaweedFS.

**Every bucket:** Block Public Access (all four settings), default encryption
SSE-S3 (`AES256`), Object Ownership `BucketOwnerEnforced` (ACLs off),
versioning off, a policy that denies any request not over TLS, and a
lifecycle rule that also aborts a multipart upload left unfinished for a day.

**Server-side encryption, per store: `PEOPLE_UPLOAD_SSE`, `PEOPLE_EXPORT_SSE`**
— `AES256` (the default) or `none`. `AES256` asks for SSE-S3 on every write
(`x-amz-server-side-encryption: AES256`; for uploads it is signed into the
presigned PUT, so the browser must send it). S3 honours it, and the bucket's
default encryption would apply it anyway; asking makes an unencrypted write
impossible to sign. `none` sends no header, for a store that refuses it.

**Object keys, and the lifecycle rules that match them.** S3 lifecycle filters
are prefixes, not globs, so each key starts with how long it lives:

| Bucket | Key | Written by | People deletes it | Lifecycle rule (backstop) |
| --- | --- | --- | --- | --- |
| uploads | `<tenant>/import/<upload id>` | the browser | on commit, on the next upload, on a failed check, or after 24 h (hourly sweep) | whole bucket: 1 day |
| exports | `exports/<tenant>/<export id>/<file>` | an export | after its link's 24 h (hourly sweep) | prefix `exports/`: 2 days |
| exports | `dry-runs/<tenant>/<upload id>/blocked-rows.csv` | a dry run | after 24 h | prefix `dry-runs/`: 2 days |
| exports | `imports/<tenant>/<checksum>/blocked-rows.csv` | a commit | after 7 days, or at once on an erasure | prefix `imports/`: 8 days |
| backups | `<env>/<date>/{people.dump,postgres.sql.gz,topics.txt.gz}` | `backup.sh` | never (the role cannot delete) | whole bucket: 30 days |

The sweep's own rule is `lifetimeOf` in
`services/people/src/application/export/object-store.ts`; the key builders are
`keyFor` (`export/job.ts`), `dryRunReportKey` (`screens/operations.ts`) and
`reportKey` (`import/commit.ts`).

**CORS, uploads only** — only the tenant app may PUT, only the headers the URL
signs, and nothing is exposed (People reads the object itself; the browser
needs no ETag). S3 allows one `*` in an origin and matches it as text, so
`https://*.app.kithena.com` is every tenant (and, since `*` spans dots, every
staging tenant too). A port cannot be a wildcard, so each local port is listed.

```json
[
  {
    "AllowedOrigins": ["https://*.app.kithena.com", "https://*.staging.app.kithena.com"],
    "AllowedMethods": ["PUT"],
    "AllowedHeaders": ["content-type", "if-none-match", "x-amz-server-side-encryption"],
    "MaxAgeSeconds": 3600
  }
]
```

`pnpm --filter @kithena/people upload-bucket` sets the same CORS and the
one-day rule over the S3 API from People's own variables
(`PEOPLE_UPLOAD_BUCKET`, `PEOPLE_UPLOAD_S3_*`, `PEOPLE_UPLOAD_CORS_ORIGINS`);
`just dev` runs it against SeaweedFS, and it works against S3 with an
administrator's credentials. `services/people/src/infrastructure/upload-bucket.ts`
holds the rules.

**What the bucket enforces, and what People checks.** The presigned PUT signs
the key (chosen by People, under the tenant), `content-length` (exactly the
declared size, at most 100 MB), `content-type: application/octet-stream`,
`if-none-match: *` (written once) and, unless `PEOPLE_UPLOAD_SSE=none`,
`x-amz-server-side-encryption: AES256`, for five minutes. Signed with the
instance role's temporary credentials, the URL carries their session token
and stops working when either expires. It carries no checksum: AWS SDK v3
would otherwise presign a CRC32 of an empty body, which S3 refuses
(`BadDigest`); the client is built with `requestChecksumCalculation` and
`responseChecksumValidation` at `WHEN_REQUIRED`, and a unit test holds it.
People then reads the object back and checks its size and SHA-256 before
anything is parsed, and again at the dry run and the commit. PRD §14.2 has the
table.

#### Locally

`docker compose` runs one SeaweedFS at `http://localhost:9000`; `S3_*` in
`.env.example` point both stores at it, and `just dev` runs `upload-bucket`
for `PEOPLE_UPLOAD_BUCKET`, which creates it and sets its CORS
(`PEOPLE_UPLOAD_CORS_ORIGINS`) and lifecycle. SeaweedFS implements bucket CORS
and answers the preflight as S3 does — the allowed origin passes, another is
refused — so the local browser upload is held to the same rule as
production. Only the S3 API is used.

## Local

`just dev` brings up the whole compose stack. Tenants resolve at
`<company>.app.localhost`, which most browsers send to `127.0.0.1` without a
hosts entry. `TENANT_HOST_SUFFIX` in `.env.example` is already set to match.

### The local S3

Production stores objects in Amazon S3 (uploads, exports, backups). Locally
and in the
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
