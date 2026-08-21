# Security

## Reporting a vulnerability

Report privately, never in a public issue: **security@kithena.example** — replace
this with the real address before anyone outside the team can read this
repository.

Include what you did, what happened, and what you expected. A proof of concept
helps; a working exploit against production data is not required and please do
not build one. Expect an acknowledgement within two working days.

Please do not test against a customer tenant. Ask for a sandbox instead.

## What this system holds

An HRIS holds the most sensitive data most companies keep about a person: legal
name, home address, salary, bank details, sickness, parental leave, disciplinary
records, right-to-work documents. Some of it is
[GDPR Article 9](https://gdpr-info.eu/art-9-gdpr/) special-category data. That
shapes every decision below.

## Controls that are enforced, not documented

These are the ones the build fails on. A control nobody checks is a paragraph.

| Control                                               | Where it is enforced                                                                                                                  |
| ----------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| Every contract field carries a data classification    | `pnpm codegen` exits non-zero on an unclassified field                                                                                |
| Special-category data never reaches a model           | `services/*/src/contract/*.contract.test.ts` — codegen checks a policy _exists_, not that it is coherent                              |
| Log redaction paths are generated, never hand-written | `tools/codegen` emits `packages/telemetry/src/generated/redaction.ts`                                                                 |
| Tenant isolation                                      | Postgres row-level security, schema per module — asserted against a real database in `packages/db-kit/src/tenant.integration.test.ts` |
| A write and its event commit together                 | Transactional outbox, `packages/db-kit/src/outbox.integration.test.ts`                                                                |
| Authorization is a graph, not a role column           | OpenFGA; enforced in the domain and application layers, never only in a resolver                                                      |
| No cross-module imports                               | `.dependency-cruiser.cjs`, plus a standalone boot per module with its siblings made unresolvable                                      |
| Secrets never reach the repository                    | `gitleaks` over the **full history** on every push and pull request                                                                   |
| Nothing vulnerable ships                              | `pnpm audit --prod --audit-level low` in CI                                                                                           |

### Writing a row-level security policy

Two details decide whether such a policy enforces anything, and both are easy
to get wrong in a way that still looks correct:

**`FORCE ROW LEVEL SECURITY`, not just `ENABLE`.** A table's owner bypasses its
own policies by default, and a service connects as the role owning its schema.
And no policy of any kind constrains a **superuser** — neither `FORCE` nor
`NOBYPASSRLS` applies — which is why `tools/scripts/init-db.sql` creates
`svc_people` and `svc_timeoff` as ordinary login roles. A connection that must
be constrained cannot be a superuser's.

**`NULLIF`, because the setting comes back as an empty string.** `set_config`
is transaction-local, and at the end of the transaction the value returns to
`''` rather than to unset. The obvious form raises `22P02` on any query that
forgot `withTenant`:

```sql
-- Wrong: an unscoped query fails as a 500 from a cast, not as "no rows".
USING (tenant_id = current_setting('app.tenant_id', true)::uuid)

-- Right: fails closed, quietly.
USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
```

Include `WITH CHECK` as well as `USING`. Reading is half of isolation; without
it a tenant can insert a row it will then be unable to see.

The authorization point is worth restating: GraphQL is one transport of four
(REST, SCIM, webhooks, workers). A rule that lives in a resolver is a rule that
three other doors ignore.

## Secrets

**No credential belongs in this repository, in any commit, ever.** The history is
scanned in full on every push, because a secret that was committed and then
deleted is still in the pack file, still cloneable, and still valid until it is
rotated.

- `.env.example` holds only local development values that reach nothing outside
  a developer's own machine. If a value in it ever needs to be secret, the file
  is wrong.
- `.vercel/` and `.env.local` are ignored at the repository root and per app.
  `vercel link` writes an OIDC token next to the project id.
- CI reads exactly one secret, `VERCEL_TOKEN`. Project and organisation
  identifiers are not secrets and are in the workflow in plain sight.

### If a secret is ever committed

Rotate first. Deleting the commit does not invalidate the credential, and
rewriting history does not reach the clones and forks that already have it.

1. **Revoke and reissue the credential.** Before anything else.
2. Remove it from the working tree and land that on `main`.
3. Only then consider history rewriting, and treat it as cosmetic.

## Repository settings to enable

These cannot be committed and have to be turned on in GitHub:

- **Secret scanning with push protection.** The strongest control available: it
  rejects the push rather than reporting the leak afterwards. Settings →
  Code security.
- **Branch protection on `main`**: require the `ci` and `security` checks, require
  a pull request, disallow force pushes.
- **Require two-factor authentication** for the organisation.

## Known advisories

At the time of writing `pnpm audit` reports 22 advisories, one critical. **None
are reachable from anything this product serves.** Every one arrives through
development tooling — `wgc` (the Cosmo Router CLI) and `syncpack` — which run on
a developer's machine and in CI and are absent from every deployed artifact.

`pnpm audit --prod` reports zero, and that is the number CI gates on.

They are still worth clearing. Dependabot proposes those upgrades weekly as
reviewable pull requests, which is the right place to judge a major version bump
of a build tool.
