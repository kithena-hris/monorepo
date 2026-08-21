# Privacy engineering

How this system handles personal data, and where that handling is enforced
rather than promised.

This is an engineering document. It describes mechanisms in the codebase, not a
privacy notice for data subjects, and it is not legal advice.

## The one idea

**A data classification lives on the schema, not in a wiki.**

Every field of every event contract is registered with a policy in
`packages/contracts/src/classification.ts`. `pnpm codegen` walks that registry
and derives, from the single declaration:

- the Pino redaction paths, so a classified value cannot reach a log
- the AI gateway deny list, so it cannot reach a model
- the DSAR export manifest, so a subject access request is complete
- retention job targets

**A field with no policy fails CI.** That is the whole design. Unclassified data
is how one value ends up in a log, an export and a model prompt on the same
afternoon, and the only reliable moment to catch it is the moment the field is
added.

## The vocabulary

Each field declares five things:

| Property | Meaning |
| --- | --- |
| `classification` | `public`, `internal`, `confidential`, or `special-category` (GDPR Article 9) |
| `piiKind` | What kind of person-data it is: identity, contact, financial, health, none |
| `exportable` | Whether it belongs in a subject access request package |
| `aiEligible` | Whether it may be sent to a model. **Never true for special-category data.** |
| `retention` | How long it may be kept |

Helpers exist so the common cases are one call and are consistent:
`asPublic()`, `asContact()`, `asIdentity()`, `asFinancial()`, and the
special-category constructor.

## What follows from a classification

**Logging.** `confidential` and `special-category` fields become redaction paths
in `packages/telemetry/src/generated/redaction.ts`, which `logger.ts` hands to
Pino. That file is generated. Editing it by hand is pointless — the next
`codegen` overwrites it — and to change what is redacted you change the field's
policy in the contract.

**Models.** `aiEligible: false` puts the path on the gateway deny list. Health
data and disciplinary records never become prompt context.

**Export.** `exportable: true` puts the path in the DSAR manifest. Under GDPR
Article 15 a subject access request has to be complete, and completeness is only
achievable if the list is derived rather than remembered.

**Retention.** The policy names the job that deletes it.

## Isolation

- **Tenant isolation is row-level security in Postgres**, plus a schema per
  module. It is enforced by the database, not by a `WHERE` clause that a future
  query might omit. `packages/db-kit/src/tenant.integration.test.ts` holds that
  claim to a real Postgres: a tenant sees only its own rows, an unscoped query
  sees nothing rather than everything, a write aimed at another tenant is
  refused, and the tenant does not survive on a pooled connection into the next
  request. That last one is the leak no single-request test can find. See
  [SECURITY.md](./SECURITY.md#writing-a-row-level-security-policy) for the two
  details that decide whether such a policy enforces anything at all.
- **Authorization is a graph** (OpenFGA), not a role column, because an org
  chart is a graph and "my manager's manager can see this" is a traversal.
- **Authorization is enforced in the domain and application layers**, never only
  in a resolver. GraphQL is one transport of four — REST, SCIM, webhooks and
  workers are the others — and a rule in a resolver is a rule the other three
  ignore.

## Correctness that is also a privacy property

- **Effective dating.** `occurredAt` is when it was recorded, `effectiveFrom` is
  when it takes effect. Corrections are typed events carrying `supersedes`,
  never silent updates, so the record of what was believed when survives. An
  audit trail that can be edited is not one.
- **Calendar dates are dates.** A hire date is not an instant. Someone hired on
  the 1st in Barcelona was not hired on the 31st in Los Angeles, and getting
  this wrong misstates employment periods in a legal record.
- **Money is never a float.** `numeric(19,4)` in Postgres, minor units in
  transport, `decimal.js` in application code.

## The known gap

The AI gateway deny list and the DSAR export manifest are **computed and printed
by `pnpm codegen` but not yet written to a file**, unlike the redaction paths.
Nothing consumes them today. Wiring them into their consumers is outstanding
work; until then, treat the manifest as a report rather than an enforced
control.

This is stated here rather than left to be discovered, because the difference
between a derived artifact and one that merely could be derived is exactly the
difference this document claims matters.

## Reporting

Privacy concerns go to the address in [SECURITY.md](./SECURITY.md), and are
handled the same way.
