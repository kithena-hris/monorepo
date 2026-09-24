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

### Hosting: People, the router and the remote

Both deploy workflows ship three more things, in this order, between the
migration and the tenant app:

```
migrate ──▶ People (VM) ──▶ Cosmo Router (VM) ──▶ People remote (Vercel) ──▶ shell (apps/web)
```

Schema, then service, then client, one layer further out each time. Production
rolls all of them back when a smoke test fails — clients first, then the
router, then People — and never the database.

**People and the router run on one Oracle Cloud Always Free VM, under Docker
Compose, for $0.** People holds three things a function-per-request runtime
takes away: Kafka consumer groups, the hourly and daily jobs in
`infrastructure/background.ts`, and the SIGTERM drain that lets a message in
hand and a job in flight finish (PEO-118). The Cosmo Router is a Go binary with
no serverless build at all. So they need a process, and the process lives on a
VM that also runs what they lean on. The frontends stay on Vercel Hobby, and
identity and messaging stay Vercel functions.

```
                         Cloudflare edge (TLS, DNS)
    browser / shell ──▶  api.kithena.com
                              │  Cloudflare Tunnel (outbound from the VM; no inbound port)
┌─ Oracle A1 VM, arm64 ───────┼──────────────────────────────────────────────┐
│  compose project kithena-production                                        │
│   cloudflared ──▶ router :4000 ──▶ people :4001 ──┬─▶ redpanda :9092       │
│        └──── /v1/exports/files/* ─────────▶┘      ├─▶ temporal :7233 ─┐    │
│                                                    ├─▶ openfga  :8080 ─┤    │
│                                                    ├─▶ valkey   :6379  │    │
│                                                    └─▶ postgres :5432 ◀┘    │
│                                   (People's data as svc_people; Temporal;   │
│                                    OpenFGA — one server, three databases)   │
│  (kithena-staging: the same again, opt-in, smaller)                         │
│  tailscaled ◀── GitHub Actions deploys, founder SSH (tailnet only)         │
└──────────────────────────────────────┬──────────────────────────────────────┘
                                        ├─▶ Oracle Object Storage (exports, backups)
                                        └─▶ Cloudflare R2 (browser uploads)

    identity (Vercel function) ──▶ Neon Postgres (platform schema, svc_identity)
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
REST API, the published schema artifact (`PEOPLE_PUBLIC_URL/v1/schema/versions/N`,
§13.4) and, later, SCIM: a customer integration reaching `/v1/*` needs its own
tunnel route when it is wanted, and deciding which paths are public is that
change's job.

#### What ships, and how

- **Images** — a job on a native arm64 runner (`ubuntu-24.04-arm`, free for a
  public repository) builds both images and proves them before anything is
  pushed. The router image is `apps/gateway/Dockerfile` with the supergraph
  composed against `http://people:4001` — People's name on the Compose
  network, the same in every environment, so one router image serves both —
  and `apps/gateway/scripts/smoke.ts` starts it: a persisted operation must
  pass, an unknown hash must be refused, a request without a token must get
  401. People's image (`services/people/Dockerfile`, `node:24-bookworm-slim`)
  must boot and answer `/health`, which is where a native module built for the
  wrong architecture dies. Both are pushed to GHCR as
  `ghcr.io/<owner>/kithena-{people,router}:<sha>`.
- **Onto the VM** — the deploy job joins the tailnet as an ephemeral node
  (`tag:ci`), copies `deploy/vm/` to `~deploy/kithena`, writes the settings
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
only deploys once `ROUTER_URL_STAGING` is set. With one person testing, leaving
it unset is the default: it would take another 3.7 GB of the VM's 12.

#### Memory budget

Limits, not reservations: the stack measured about 0.8 GB resident per
environment with nothing to do. `bootstrap.sh` adds 4 GB of swap as headroom.

| Container | Production | Staging (opt-in) |
| --- | --- | --- |
| people | 1 GB | 768 MB |
| router | 384 MB | 256 MB |
| redpanda (`--memory 768M` / `512M`) | 1 GB | 768 MB |
| postgres (People's data, Temporal, OpenFGA) | 1.5 GB | 1 GB |
| temporal (auto-setup) | 768 MB | 512 MB |
| openfga | 256 MB | 192 MB |
| valkey (`maxmemory` 192 MB / 96 MB, `noeviction`) | 256 MB | 128 MB |
| cloudflared | 128 MB | 128 MB |
| **Total** | **5.3 GB** | **3.7 GB** |

9 GB for both against the VM's 12 GB, leaving the OS and Docker about three,
plus the swap. Measured idle, Postgres used 150 MB of its 1.5 GB with People's
schema migrated. CPU limits are caps on 2 OCPUs, deliberately oversubscribed.

#### The $0 bill of materials

| Piece | Service, plan | Free limits that matter here |
| --- | --- | --- |
| People, router, Redpanda, Temporal, OpenFGA, Valkey | **Oracle Cloud Always Free**, one `VM.Standard.A1.Flex` | 1,500 OCPU-hours and 9,000 GB-hours a month of A1 = **2 OCPU / 12 GB** (the current grant; older write-ups, and the plan this was first sized for, say 4 OCPU / 24 GB). 200 GB block storage in total, 10 TB/month egress. **Idle reclaim:** an Always Free instance whose CPU (95th percentile), network *and* memory all stay under 20% for 7 days may be stopped — this stack at rest is ~2 GB of 12, under the line. **Upgrading the account to Pay As You Go removes the reclaim** and is still billed $0 while usage stays inside the Always Free limits; do it, and set a budget alert at $1. |
| Public HTTPS for the router | **Cloudflare Tunnel** (Zero Trust Free) | Free, no bandwidth charge; the VM opens no inbound port. |
| People's database | **The VM's Postgres** | Inside the VM's disk and memory above; no separate bill. No point-in-time restore — see "Backups". |
| Identity's database | **Neon Free** (unchanged) | 100 CU-hours per project a month, 0.5 GB storage, 5 GB egress; scale-to-zero after 5 minutes. Identity is request-driven and sleeps, so it sits well inside the hours. |
| Export files, nightly backups | **Oracle Object Storage** (Always Free, same account) via its S3 Compatibility API | 20 GB across tiers (10 GB Standard on a PAYG account), 50,000 API requests a month, egress inside the 10 TB. |
| Browser uploads (imports, up to 100 MB) | **Cloudflare R2** Free | 10 GB-month storage, 1M Class A and 10M Class B operations a month, no egress fees. |
| Frontends, identity, messaging | **Vercel Hobby** | 100 deployments a day — every PR run spends several, one per project. **No deployment protection on production or a custom domain** (the API refuses `ssoProtection` there), which is why the back-office's own check is its only door. Hobby is non-commercial use only: the first paying customer is the trigger for Pro. |
| Email | **Resend Free** | 3,000 emails a month, 100 a day, one domain. |
| Images | **GHCR** | Container registry storage and bandwidth are currently free; the published Packages allowance on GitHub Free is 500 MB storage and 1 GB/month transfer for private packages, if that ever applies. Measured: People's image is ~520 MB uncompressed, most of it one layer that changes every commit; the router's per-commit layers are under 1 MB. Five versions of each are kept (`delete-package-versions`). Pulls by Actions are free. **Making both packages public** (the repository is public and the images hold no secret) takes them out of any quota for good. |
| CI | **GitHub Actions**, public repository | Standard runners, including `ubuntu-24.04-arm`, free. |
| Private access | **Tailscale Personal** | 3 users, 100 devices; CI joins as an ephemeral node per run. |

#### Why Tailscale for deploys

The deploy has to reach the VM without the VM listening on the internet. A
Tailscale ephemeral node in the job, with the tailnet policy allowing `tag:ci`
to SSH to `tag:vm` as `deploy` and nothing else, does that with no SSH key to
store and no public SSH hostname. The alternative, SSH through Cloudflare
Access, would route deploys through the `cloudflared` container that the
deploy itself manages — a broken stack would lock out the fix. Tailscale runs
on the host, beside Docker rather than inside it.

#### Created by hand, once

**Accounts** (all free): Oracle Cloud, Cloudflare (already has the DNS),
Tailscale, Neon (exists), Vercel (exists), Resend (exists).

1. **VM.** Oracle Console → Compute → Create instance: image Ubuntu 24.04
   (aarch64), shape `VM.Standard.A1.Flex`, **2 OCPU, 12 GB**, boot volume 100 GB.
   Region: the one nearest the Neon project's region (Neon console → project
   settings; `aws-eu-central-1` means `eu-frankfurt-1`). It becomes the home
   region, which is where Always Free compute lives. Your SSH public key.
   A1 capacity is often short in popular regions; retry, or try another
   availability domain. Then upgrade the account to **Pay As You Go** (Billing →
   Upgrade) and add a $1 budget alert.
2. **Tailscale.** Create a tailnet. In the access policy add tags and rules:
   ```json
   "tagOwners": { "tag:vm": ["autogroup:admin"], "tag:ci": ["autogroup:admin"] },
   "grants": [ { "src": ["tag:ci"], "dst": ["tag:vm"], "ip": ["22"] } ],
   "ssh": [
     { "action": "accept", "src": ["tag:ci"], "dst": ["tag:vm"], "users": ["deploy"] },
     { "action": "check",  "src": ["autogroup:admin"], "dst": ["tag:vm"], "users": ["deploy", "ubuntu"] }
   ]
   ```
   Generate an auth key tagged `tag:vm` (one-off), and an **OAuth client** with
   the `auth_keys` write scope and tag `tag:ci` for the workflows.
3. **Bootstrap.** From a checkout:
   `ssh ubuntu@<public ip> 'sudo TS_AUTHKEY=tskey-auth-… bash -s' < deploy/vm/bootstrap.sh`.
   It installs Docker and Compose, unattended upgrades with a 04:30 reboot,
   4 GB swap, SSH key-only, Tailscale (hostname `kithena-vm`), ufw (nothing in
   but the tailnet), the `deploy` user and the backup timer. Then in the
   Oracle console delete the **port 22 ingress rule** from the subnet's
   security list: from here on nothing reaches the VM except through Tailscale
   and nothing is served except through the tunnel. Rerunning the script is how
   a change to it reaches the VM.
4. **Tunnel.** Cloudflare Zero Trust → Networks → Tunnels → Create
   (`cloudflared`), one per environment (`kithena-production`, and
   `kithena-staging` if wanted). Copy the token. Public hostnames, in this
   order:
   - `api.kithena.com`, path `^/v1/exports/files/` → `http://people:4001`
   - `api.kithena.com` (no path) → `http://router:4000`

   (Staging: `api.staging.kithena.com`.) Cloudflare adds the DNS record.
5. **Buckets, Oracle** (Object Storage, same region, both **private**, no
   pre-authenticated requests):
   - `kithena-exports` — lifecycle rules: delete objects matching `*/exports/*`
     after **2 days** (a link lives 24 hours) and `*/imports/*` after **8 days**
     (a report lives 7). People sweeps by age too; the rules are the backstop.
   - `kithena-backups` — lifecycle rule: delete after **30 days**.
   - Identity → your user → **Customer Secret Keys** → generate. Two, if you
     want the backup key separate from People's. The S3 endpoint is
     `https://<namespace>.compat.objectstorage.<region>.oci.customer-oci.com`
     (the older `…oraclecloud.com` form also works); the namespace is on the
     tenancy page. Region is the VM's region identifier, e.g. `eu-frankfurt-1`.
6. **Bucket, Cloudflare R2** — `kithena-uploads`, private. CORS: `PUT` (and
   `GET`, `HEAD`) from `https://*.app.kithena.com` (staging:
   `https://*.staging.app.kithena.com`), header `content-type`, max age 3600.
   Lifecycle: delete objects after **1 day** (an upload is consumed by its
   import or abandoned). An R2 API token scoped to that bucket with Object
   Read & Write. Endpoint `https://<account id>.r2.cloudflarestorage.com`,
   region `auto`. Oracle's S3 API cannot hold a CORS rule at all, which is why
   uploads live here.
7. **Backups' credentials** — on the VM, once, as root:
   ```bash
   sudo install -m 600 /dev/stdin /etc/kithena/backup.env <<'EOF'
   BACKUP_S3_ENDPOINT=https://<namespace>.compat.objectstorage.<region>.oci.customer-oci.com
   BACKUP_S3_REGION=<region>
   BACKUP_S3_BUCKET=kithena-backups
   AWS_ACCESS_KEY_ID=<customer secret key id>
   AWS_SECRET_ACCESS_KEY=<customer secret key>
   EOF
   ```
8. **Vercel project for the People remote**, staging and production: Framework
   **Other**, Root Directory **empty**, no build command. **Do not connect the
   Git repository**: a Git build is unsigned. Add a custom domain to each. Ids
   go in `VERCEL_PROJECT_ID_PEOPLE_REMOTE_*`.
9. **An Ed25519 key pair per environment**, private half to the environment
   secret, public half to the repository variable:
   ```bash
   node -e "const k=require('node:crypto').generateKeyPairSync('ed25519');
   console.log('private', k.privateKey.export({format:'der',type:'pkcs8'}).toString('base64'));
   console.log('public ', k.publicKey.export({format:'der',type:'spki'}).toString('base64'))"
   ```
10. **GHCR** — nothing to create: the first run publishes both packages and
    links them to the repository. Optionally set each package public
    (Package settings → Change visibility).

#### GitHub: environment secrets (Settings → Environments → `staging` / `production`)

Same names in both environments, different values.

| Secret | Holds |
| --- | --- |
| `TS_OAUTH_CLIENT_ID`, `TS_OAUTH_SECRET` | The Tailscale OAuth client (step 2). |
| `CLOUDFLARE_TUNNEL_TOKEN` | That environment's tunnel token (step 4). |
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
# Exports: Oracle Object Storage
PEOPLE_EXPORT_BUCKET=kithena-exports
PEOPLE_EXPORT_LINK_BASE=https://api.kithena.com/v1/exports/files
PEOPLE_EXPORT_ENCRYPTION_KEY=<base64 32 bytes>
PEOPLE_EXPORT_SIGNING_KEY=<base64 32 bytes>
S3_ENDPOINT=https://<namespace>.compat.objectstorage.<region>.oci.customer-oci.com
S3_REGION=<region>
S3_ACCESS_KEY_ID=…
S3_SECRET_ACCESS_KEY=…
# Uploads: Cloudflare R2 — endpoint, region (auto), bucket, access key and
# secret, under the names the direct-uploads change gives them.
```

Export links are People's own signed URLs, never the bucket's: People reads
the object and decrypts it on `GET /v1/exports/files/…`, which is why that one
path is routed through the tunnel and the bucket stays private. Nothing
presigns against Oracle.

#### GitHub: repository variables (Settings → Secrets and variables → Actions → Variables)

| Variable | Holds |
| --- | --- |
| `VM_TAILSCALE_HOST` | The VM's tailnet name, `kithena-vm`. |
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

Retention is the bucket's 30-day rule. `journalctl -u kithena-backup` has the
last run. Identity's data is not in it: it is Neon's, which keeps its own
history.

**There is no point-in-time restore for People's data.** The recovery point is
the last nightly dump: a disk lost at 03:00 loses almost a day of HR changes.
That is the price of $0 and is acceptable while the founder is the only user.
It stops being acceptable with the first customer, and the fix is the move in
"Scaling later": Neon (paid) or RDS, both of which have point-in-time restore.
The move is a `pg_dump` from here and a `pg_restore` there, then
`PEOPLE_DATABASE_URL` pointed at the new host (as `svc_people`, the direct
endpoint rather than a pooler — People keeps a pool of its own and prepares
statements) and the workflow's migrate step pointed at it instead of the VM.

Restore, on the VM, as root. First the helper:

```bash
env=production; day=2026-09-24; p=kithena-$env
aws() { docker run --rm -i --env-file /etc/kithena/backup.env amazon/aws-cli:2.31.0 \
  --endpoint-url "$(sed -n 's/^BACKUP_S3_ENDPOINT=//p' /etc/kithena/backup.env)" "$@"; }

# People's database. Roles must exist: on a fresh volume, restore
# postgres.sql.gz (below) first, or run `deploy.sh $env migrate` once.
docker compose -p $p stop people
docker exec $p-postgres-1 psql -q -U kithena -d postgres \
  -c 'DROP DATABASE IF EXISTS kithena WITH (FORCE)' -c 'CREATE DATABASE kithena OWNER migrator'
aws s3 cp "s3://kithena-backups/$env/$day/people.dump" - \
  | docker exec -i $p-postgres-1 pg_restore -U kithena -d kithena --exit-on-error
docker compose -p $p start people

# The rest of the VM Postgres: roles, Temporal and OpenFGA.
docker compose -p $p stop people temporal openfga
aws s3 cp "s3://kithena-backups/$env/$day/postgres.sql.gz" - \
  | gunzip | docker exec -i $p-postgres-1 psql -q -U kithena -d postgres
# The topics: create them, then produce every record back.
aws s3 cp "s3://kithena-backups/$env/$day/topics.txt.gz" - | gunzip > /tmp/topics.txt
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

#### Scaling later

Everything above is a set of containers and S3 endpoints, so each move is a
host or a URL, not a rewrite.

| Move | When | What changes |
| --- | --- | --- |
| Oracle PAYG → paid A1 (more OCPU/GB) | The VM runs out of memory or CPU, or staging and production need to stop sharing | The shape. Same scripts. |
| People and router → ECS/Fargate or Kubernetes | A second instance is needed (availability, or load one VM cannot carry), or a customer asks for an SLA | Same images from GHCR (or pushed to ECR); `compose.yaml`'s environment becomes the task definition; the tunnel becomes a load balancer. |
| Redpanda → Redpanda Cloud (or MSK) | Real event volume, or People running more than one replica | `KAFKA_BROKERS` and the SASL/TLS settings in `PEOPLE_ENV`, the `redpanda` service deleted. |
| Temporal → Temporal Cloud | Long-running workflows start to matter to customers, or auto-setup's single binary becomes the thing that pages | `TEMPORAL_ADDRESS`, `TEMPORAL_NAMESPACE`, mTLS settings; the `temporal` service deleted. |
| OpenFGA → Okta FGA or a managed OpenFGA | Tuple volume or availability outgrows one container | `OPENFGA_URL`, `OPENFGA_STORE_ID` and credentials. |
| Valkey → managed (Upstash, ElastiCache, Aiven) | Export queue durability matters beyond one disk | `VALKEY_URL`. |
| People's database: VM Postgres → Neon (paid) or RDS | The first customer (for point-in-time restore), or data or load the VM's disk and memory cannot carry | `pg_dump` here, `pg_restore` there; `PEOPLE_DATABASE_URL` in `PEOPLE_ENV` (and out of `compose.yaml`); the migrate step pointed at the new host. Not Neon Free: People's polling would exhaust its hours. |
| Identity's database: Neon Free → Launch/Scale | 0.5 GB of data, the CU-hour ceiling, or the first customer | The plan. Same connection string. |
| Oracle Object Storage and R2 → AWS S3 | Egress to AWS workloads, a customer's region or compliance requirement, or one provider for both | The two sets of S3 settings: endpoint unset, AWS region, keys. Bucket CORS and lifecycle rules recreated on S3. |
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
- **Oracle and `x-amz-server-side-encryption`.** People asks for `AES256`
  server-side encryption on every export object (`infrastructure/s3-blobs.ts`).
  Oracle's S3 Compatibility API documents SSE-C and SSE-KMS and encrypts
  everything at rest regardless, but does not list that header; if the first
  export fails with `NotImplemented` or `InvalidArgument`, that header is the
  cause, and it needs to become optional in People. Not verifiable without an
  account.

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
