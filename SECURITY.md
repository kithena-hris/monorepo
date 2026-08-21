# Security

## Reporting a vulnerability

**This repository is public.** Report privately, never in an issue or a pull
request: **info@kithena.com**. An issue describing a vulnerability publishes it
to everyone, including the people it would be useful to.

If a dedicated `security@kithena.com` alias is ever created, change it here and
nowhere else — this file is the one place the address is published, so a second
copy is a second thing to forget. A dedicated alias is worth having: a report
arriving in a general inbox competes with sales mail for attention, and the one
message you must not miss is the one telling you a credential is exposed.

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

| Control                                               | Where it is enforced                                                                                                                   |
| ----------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| Every contract field carries a data classification    | `pnpm codegen` exits non-zero on an unclassified field                                                                                 |
| Special-category data never reaches a model           | `services/*/src/contract/*.contract.test.ts` — codegen checks a policy _exists_, not that it is coherent                               |
| Log redaction paths are generated, never hand-written | `tools/codegen` emits `packages/telemetry/src/generated/redaction.ts`                                                                  |
| Tenant isolation                                      | Postgres row-level security, schema per module — asserted against a real database in `packages/db-kit/src/tenant.integration.test.ts`  |
| A write and its event commit together                 | Transactional outbox, `packages/db-kit/src/outbox.integration.test.ts`                                                                 |
| Authorization is a graph, not a role column           | OpenFGA; enforced in the domain and application layers, never only in a resolver                                                       |
| No cross-module imports                               | `.dependency-cruiser.cjs`, plus a standalone boot per module with its siblings made unresolvable                                       |
| Secrets never reach the repository                    | GitHub push protection rejects the push; `gitleaks` catches it earlier in a pre-commit hook, and again over the **full history** in CI |
| Nothing vulnerable ships                              | `pnpm audit --prod --audit-level low` in CI                                                                                            |

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

### The pre-commit hook

`pnpm install` points `core.hooksPath` at `.githooks`, so the hook is active
without anyone remembering to enable it. It runs `gitleaks protect --staged`
against the same `.gitleaks.toml` CI uses, and refuses a commit that stages
something shaped like a credential.

It is the earliest of the three layers, not a substitute for any of them. GitHub
push protection rejects the push, which is stronger; but a hook refuses the
_commit_, so the secret never enters local history either and there is nothing
to rewrite afterwards. CI is last and catches what predates both, at the cost of
the credential already being on the remote by then.

The binary is pinned to the version CI runs and installed with
`pnpm hooks:install`, into `.git/hooks-bin/` — outside the working tree, so it
can never be committed. The download is checksum-verified against the published
manifest; fetching a secret scanner and trusting whatever comes back would be
its own supply-chain hole.

**The hook fails when gitleaks is missing rather than passing quietly.** A
check that skips itself when its tool is absent reports success on every
commit, which is the one outcome worse than not having it.

`--no-verify` still bypasses it, as it bypasses any hook. That is not worth
defending against: the person typing it knows what they are doing, and CI runs
the same scan over the full history regardless.

### If a secret is ever committed

Rotate first. Deleting the commit does not invalidate the credential, and
rewriting history does not reach the clones and forks that already have it.

1. **Revoke and reissue the credential.** Before anything else.
2. Remove it from the working tree and land that on `main`.
3. Only then consider history rewriting, and treat it as cosmetic.

## Repository settings

These cannot be committed and have to be turned on in GitHub. **This repository
is public**, which is what makes most of them free — an earlier version of this
file said they were unavailable, and that was true while it was private.

**Enabled.**

- **Secret scanning**, and **push protection**. Push protection is the strongest
  secret control there is: it rejects the push rather than reporting the leak
  after it has landed. The [pre-commit hook](#the-pre-commit-hook) and the
  `security` workflow are now backstops behind it rather than substitutes for
  it — worth keeping, because a hook catches things before a commit exists and
  the workflow scans history that predates any of this.
- **Dependabot alerts and security updates.** Grouped upgrade pull requests
  weekly, per `.github/dependabot.yml`.
- **A ruleset on `main`.** A pull request is required; fourteen status checks
  must pass; history stays linear and squash is the only merge method; force
  pushes and branch deletion are blocked. One approving review from a code
  owner is required, and `.github/CODEOWNERS` routes it.

  This paragraph previously sat under "still to do", saying that `main` was
  directly pushable and every gate in `ci.yml` could be walked past. That
  stopped being true and the file did not notice, which is the failure mode
  documentation about controls has: nobody re-reads it, and the gap is only
  found by someone acting on what it says.

  **One consequence worth stating rather than discovering.** There is one
  committer, and GitHub does not let anyone approve their own pull request, so
  every merge today needs `--admin` to bypass the review requirement. That is
  a deliberate bypass of a control by the person who set it, which is
  defensible — and it is also indistinguishable in the log from the habit it
  could become. Either drop `required_approving_review_count` to zero while the
  team is one person and keep the status checks, which are the half that
  catches mistakes, or add a second reviewer. Leaving it as is means the first
  thing a new committer learns is how to skip the review.

**Still to do.**

- **Require two-factor authentication** for the organisation.
- **Non-provider patterns** and **validity checks** for secret scanning. Both
  are organisation-level settings rather than per-repository ones — the repo API
  accepts the change and silently keeps them disabled. They live under the
  organisation's Code security settings. Validity checks are the useful half:
  they answer whether a leaked credential is still live, which is the first
  thing you want to know.

Everything in this repository is world-readable, including the reasoning in
`CLAUDE.md`. That is a product decision rather than a security defect, but it
belongs in the same list, because it changes what "internal" means everywhere
else in these documents.

## Known advisories

At the time of writing `pnpm audit` reports around twenty advisories, one of
them critical. **None are reachable from anything this product serves.** Every
one arrives through
development tooling — `wgc` (the Cosmo Router CLI) and `syncpack` — which run on
a developer's machine and in CI and are absent from every deployed artifact.

`pnpm audit --prod` reports zero, and that is the number CI gates on.

They are still worth clearing. Dependabot proposes those upgrades weekly as
reviewable pull requests, which is the right place to judge a major version bump
of a build tool.
