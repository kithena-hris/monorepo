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

### Identity, on Fly

`platform/identity/Dockerfile` builds it and `fly.toml` describes where it runs.
Fly rather than Vercel for one reason that is not preference: the service holds
a Postgres pool and a Valkey connection across requests, and a
function-per-request runtime takes both away. Every request would open a new
connection and Postgres would run out long before the traffic justified it.

    fly launch --no-deploy --copy-config --dockerfile platform/identity/Dockerfile
    fly secrets set \
      IDENTITY_DATABASE_URL='postgres://…'   # the app role, not the owner
      VALKEY_URL='rediss://…'                 \
      INTERNAL_API_TOKEN='…'                  \
      AUTH_SIGNING_KEY='{"kty":"EC",…}'       # a private JWK, ES256
    fly deploy

`AUTH_SIGNING_KEY` is required rather than defaulted, and the service refuses to
start without it when `NODE_ENV=production`. A key generated at boot would look
like intermittent logouts rather than like a missing setting, which is a much
longer afternoon. Generate one with `jose`:

    node -e "import('jose').then(async j => {
      const { privateKey } = await j.generateKeyPair('ES256', { extractable: true });
      console.log(JSON.stringify(await j.exportJWK(privateKey)));
    })"

`min_machines_running = 1` and `auto_stop_machines = "off"`, deliberately. A cold
start here is a cold start on the login page, and the session read path runs
through it — scaling to nothing saves a few pounds and spends them on the first
person to sign in each morning.

Valkey needs a host too. Losing it logs nobody out, because every session is
also a row in Postgres, so a managed Redis on a free tier is an acceptable
starting point.

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

### Secrets

Per GitHub Environment, never repository-wide, so a job cannot read the other
environment's database by accident:

| Secret          | Staging                                        | Production         |
| --------------- | ---------------------------------------------- | ------------------ |
| `DATABASE_URL`  | Neon `staging` branch                          | Neon `main` branch |
| `ATLAS_DEV_URL` | a throwaway database Atlas drops and recreates | same               |

`ATLAS_DEV_URL` must never point at the database being migrated. Atlas drops
everything in it to compute a diff.

## Local

`just dev` brings up the whole compose stack. Tenants resolve at
`<company>.app.localhost`, which most browsers send to `127.0.0.1` without a
hosts entry. `TENANT_HOST_SUFFIX` in `.env.example` is already set to match.
