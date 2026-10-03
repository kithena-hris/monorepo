# Audit

One activity log for a company: who did what, and when, across every module it
has. **Settings › Activity** (`/settings/activity`) reads it.

A profile's effective-dated History stays where it is. That is the record's
history — what a value was on which day — and it is People's. This is the log of
acts: somebody changed a setting, exported people, read an identifier in full,
Kithena support signed in.

---

## The short version

**`platform/audit` is a platform service, not a module.** Nobody buys it, every
tenant has it, and `ModuleKey` does not list it — the argument
`docs/messaging.md` makes for messaging. Its own schema, `audit`, row-level
security by tenant, `svc_audit` `NOBYPASSRLS`.

**It is fed by events and by nothing else.** No module imports it and it reads no
module's schema. It consumes the topics modules already publish to, the way
People consumes identity's, and a fact the log needs that was not yet an event
became one.

**An entry never holds a value.** What was changed and by whom, in words — never
a salary, an identifier or a field's contents — so the log cannot show a viewer
what the record would not.

**It decides who reads it.** People administrators and HR, checked by this
service against OpenFGA, never only in the UI.

**It keeps everything.** No retention period is decided (PEO-129).
`AUDIT_RETENTION_DAYS` is the one place a period will go.

---

## The event flow

```
People  settings command ──▶ people.settings_activity + people.outbox   (one transaction)
        import, export, full values, identifier reveal ──▶ people.outbox
identity support sign-in, administrator named/removed  ──▶ platform.outbox
                 │
                 ▼  Debezium (relay-people, relay-identity), `docs/environments.md`
Redpanda   kithena.people.v1   kithena.identity.v1
                 │
                 ▼  consumer group `audit`, from the beginning
platform/audit   parse against the contract ─▶ map to an entry ─▶ audit.entry
                                                  (unique on the source event id)
```

Locally it is the same path: `docker-compose.yml`'s `relay` tails both outboxes
into the compose Redpanda, and `pnpm dev` runs the audit service beside the rest.

**People's settings changes were not events.** The Settings activity log was
written by People's REST router into `people.settings_activity` and nowhere
else. They are now `people.settings.activity_recorded`, written to People's
outbox in the same transaction as the `settings_activity` row, only when that
row is new, so a retried command is one entry. The event's id is the row's id.

That transaction is the log's own, as it always was: the router appends the row
after the command has committed ("a log that cannot be written is said in the
service's own log and the command still stands", `http/rest.ts`). Making the
entry atomic with every settings command would thread the outbox through each
of them; the row and its event cannot disagree, which is the dual write this
rules out.

**The events it reads:**

| Event                                         | Area              | Says                                          |
| --------------------------------------------- | ----------------- | --------------------------------------------- |
| `people.settings.activity_recorded`           | the row's own     | the settings log's own words                  |
| `people.import.completed`                     | imports & exports | Imported people, with the counts              |
| `people.import.failed`                        | imports & exports | Import failed, the reason and what was done   |
| `people.export.completed`                     | imports & exports | Exported people, the format and the reason    |
| `people.export.full_values_*` (five)          | sensitive access  | Asked for, decided, issued, downloaded, lapsed |
| `people.person.identifier_revealed`           | sensitive access  | Read an identifier in full, whose             |
| `identity.support.session_started`            | sign-in & support | Kithena support signed in, with the reason    |
| `identity.tenant.administrator_named/removed` | roles             | Kithena support named or removed an admin     |
| `identity.view_as.started` / `.ended`         | sensitive access  | Started or stopped viewing as an employee, with the reason and whether special-category data was visible |

Anything else on those topics is ignored. A module a company lacks publishes
nothing, so it contributes no areas.

**A support sign-in was not an event either.** Identity recorded it in
`platform.support_access` alone. It now raises
`identity.support.session_started` in the same transaction as that row: the
session, the support account, the operator and their work address, the expiry
and the reason. The
reason has to travel this way — the router builds People's principal by string
concatenation, so free text never reaches People, and People's own entries for
the session carry the operator but no reason.

**Viewing as an employee** (`docs/auth-administration.md`) is two events of
identity's: `identity.view_as.started`, in the transaction that creates the
session, and `identity.view_as.ended`, once, when it is signed out or found
over. Both name the administrator as the actor and the employee's account as
the subject, carry the reason, and say whether special-category data was
visible — the one path by which an administrator reads what only the employee
may. The screens visited while viewing are not logged one by one.

**Ordinary sign-ins are not logged.** `identity.session.started` is one per
person per device per day; in the log it would bury the three settings changes
somebody came to find. The area is for support, and a person's sign-ins stay
identity's to answer.

**Backfill.** `20260929160100_people_settings_activity_event.sql` writes one
`people.settings.activity_recorded` into `people.outbox` for every row already
in `people.settings_activity`, with the row's id as the event id — the live
path's rule, so a row is never two entries. The relays publish new outbox rows,
and a migration's inserts are new rows, so the backfill travels the same road as
everything else. Rows a People older than this change records between the
migration and its own deploy are the one gap; deploy order (migrations first,
then People) makes it seconds.

---

## An entry

| Column             | What                                                                                         |
| ------------------ | -------------------------------------------------------------------------------------------- |
| `tenant_id`        | whose. RLS is keyed on it.                                                                   |
| `id`               | the entry's own.                                                                             |
| `source_event_id`  | the event it came from. Unique per tenant: a redelivery is not a second entry.               |
| `occurred_at`      | when it happened (the envelope's `occurredAt`).                                              |
| `recorded_at`      | when the module recorded it (the envelope's `recordedAt`).                                   |
| `module`           | `people`, `identity`.                                                                        |
| `area`             | one of the areas below.                                                                      |
| `action`           | one plain sentence, as the settings log words it: "Added a field".                           |
| `detail`           | one more sentence, or null: "Seen by: HR → HR and their manager."                            |
| `actor_kind`       | `person`, `support`, `system`, `integration`.                                                |
| `actor_account_id` | the account that acted; for support, the account whose rights were used. Null for system.    |
| `on_behalf_of`     | the support operator, when Kithena support acted.                                            |
| `operator_label`   | how the log names that operator: their work address, from the support sign-in.              |
| `subject_kind`     | `person`, `account`, `setting`, `export`, `import`, `request`, or null.                      |
| `subject_id`       | its id, when it has one.                                                                     |
| `subject_label`    | its name at the time, in words: a field's label, a location's name. Never a person's value. |
| `reason`           | what the actor gave as the reason, when there was one.                                       |

A few settings commands name a field or section by its key in their path
(`/attributes/manager_id/assistant`). People's router says the key's label
before it records the entry (`subjectKey`, `http/activity.ts`), and the
backfill does the same for the entries written before it, so the log reads
"Manager", not `manager_id`.

**Never a value.** The payloads it reads were built not to carry one (the
contracts refuse a special-category or encrypted value, and these events carry
keys, counts and words), and the mapping takes only words from them. A person
subject is an id; their name is read at display time, through People, as the
viewer may read it.

**Areas:** `fields` (employee fields), `organisation`, `roles`, `integrations`
— People's settings, as its log had them — plus `imports_exports`,
`sensitive_access` and `sign_in` (sign-in and support: support's sign-ins).

**Actors.** The envelope's `actor` decides it: a `user` is a `person`; a `user`
with `onBehalfOf` is `support`, the operator in `on_behalf_of`; an
`integration` and a `system` are themselves. An administrator the back office
named is `support`, the operator in `on_behalf_of`, when the event names the
operator; otherwise whoever the envelope says.

**Which sign-in an action came from.** An entry by support is linked, when it
is read, to the support sign-in it happened in: the latest one by the same
operator at the same company that started at or before it, within the hour a
support session lasts (identity's CHECK constraint). Order-independent, so it
does not matter which topic arrived first, and the action shows that sign-in's
reason, and names the operator as it did: "Kithena support (jane@kithena.com)". People never learns the session id, which is why it is the operator and
the hour rather than the session.

---

## Who may read it

People administrators and HR, as the People settings log allowed, and Kithena
support, which is a full administrator at the company it signed in to (the
principal's `impersonatedBy`, set by the router from the token's `act.sub`). The audit
service asks OpenFGA itself — `user:<account> people_admin tenant:<id>` or
`hr` — in People's store (by name, or `OPENFGA_STORE_ID`), read-only: People
owns the model and the tuples. Without `OPENFGA_URL` it refuses every read;
failing open would publish the log to everyone.

A company without People has nobody holding either relation, and so nobody
reading the log. That is right for now: all it could show is support's sign-ins
and the administrators the back office named.

---

## How the tenant app reads it

**A subgraph, behind the router.** `platform/audit` serves `auditActivity` on
`/graphql`, composed into the supergraph like People's. The router verifies
identity's token and sets `x-kithena-principal` (with `impersonatedBy`) and
`x-internal-token` (`AUDIT_API_TOKEN`) for it exactly as it does for People, so the tenant app
reaches it the one way it reaches anything — a persisted operation, with the
signed-in person's token — and holds no audit secret.

Chosen over internal HTTP from the Next server, which would put a second
internal token in the tenant app and make it build a principal the router
exists to build (`apps/web/src/lib/people.ts`).

**Names and faces come from People.** An entry holds account and person ids.
The page asks People for the names and photos of the ones on it
(`peopleNames`), as the viewer may read them, in a second router read. Where
People cannot name somebody they are "Someone at your company"; Kithena support
and the system are named by kind, never looked up.

**Filters**, all in the address: area (several: `?area=fields,roles`), who
(`?actor=<account>` for a person, `?by=person|support|system|integration`), whose
record (`?subject=<id>`), a date range (`?from=`, `?to=`, calendar dates, the
viewer's zone, which the page adds as `?tz=`), and search (`?q=`, over the
action, detail, subject and reason). Newest
first, 50 a page, `?before=<entry>` for older.

**Where it is linked from.** Settings has it as its own card, and `G L` goes there. People's
"Activity log" tile opens it filtered to People's four settings areas; Import &
export keeps its history table (downloads live there) and gains "See all
activity", filtered to imports and exports. People's own settings-log read
(`peopleSettingsActivity`, `GET /v1/views/settings/activity`) and its screen
are gone: People records the entries and publishes them, and this reads them.

---

## Retention

One place and one policy: `AUDIT_RETENTION_DAYS` on this service. Unset — today —
nothing is ever removed. Set, a daily sweep calls `audit.purge_before`, the one
function that may delete, removing entries older than the period for every
tenant; `svc_audit` has no `DELETE` of its own. Deciding the period is PEO-129's,
with counsel; the log is where it will be enforced.

---

## Configuration

| Variable               | Notes                                                                                   |
| ---------------------- | --------------------------------------------------------------------------------------- |
| `AUDIT_DATABASE_URL`   | as `svc_audit`. Absent in production: nothing is served or consumed, and it says so. In development it defaults to the compose Postgres as `svc_audit`. |
| `KAFKA_BROKERS`, `KAFKA_*` | as People's (`packages/db-kit/src/kafka.ts`). Absent: nothing is consumed.          |
| `AUDIT_API_TOKEN`      | what the router presents (the router's own `AUDIT_API_TOKEN`). Absent in production: every read is refused. In development it falls back to `INTERNAL_API_TOKEN`, then `dev-only-key`, as `apps/gateway/scripts/dev.sh` does. |
| `OPENFGA_URL`, `OPENFGA_STORE_ID` | People's store. Absent: every read is refused.                               |
| `AUDIT_RETENTION_DAYS` | absent: keep everything (PEO-129).                                                      |
| `PORT`                 | 4103.                                                                                   |

Locally: `svc_audit` has LOGIN, password `kithena`, on a database made from
`tools/scripts/init-db.sql`. A volume older than that has the role `NOLOGIN`
from the migration; `ALTER ROLE svc_audit LOGIN PASSWORD 'kithena'` once.

---

## Deploying

The audit service is a container beside People on the VM, like Slack's: it
holds a Kafka consumer group, which a function that stops between requests
cannot. No new infrastructure: the same EC2 VM, its Postgres (the `audit`
schema in People's database, as `svc_audit`), its Redpanda and its OpenFGA.

What ships it, all in this repository:

- `platform/audit/Dockerfile` (port 4103), built, booted and pushed as
  `ghcr.io/<owner>/kithena-audit:<sha>` by `vercel-staging.yml` and
  `vercel-production.yml`, when `tools/scripts/src/affected-targets.ts` says
  the `audit` target changed;
- the `audit` service in `deploy/vm/compose.yaml`, and
  `deploy.sh <env> audit <image>`, which starts it and proves `/health` and
  its database; `deploy.sh <env> migrate` gives `svc_audit` its login;
- `audit` in the deployed graph (`http://audit:4103/graphql`), so the router
  image serves `auditActivity`; the router's `config.yaml` forwards the
  principal and `AUDIT_API_TOKEN` to it;
- a production rollback of the audit image like Slack's.

### Checklist

1. **`AUDIT_API_TOKEN`** — the router–audit pair's secret. **Already set**, as
   a GitHub *environment* secret in both `Production` and `staging`. The
   workflows write it into `audit.env` (the service) and `router.env` (the
   router) on the VM from that one secret, so the two cannot drift. To rotate
   it:

   ```bash
   openssl rand -hex 32 | gh secret set AUDIT_API_TOKEN --env Production
   openssl rand -hex 32 | gh secret set AUDIT_API_TOKEN --env staging
   ```

   then redeploy `audit` and `router` together (`targets: audit,router`).
2. **`svc_audit`'s password** — nothing to set. `deploy.sh` generates
   `AUDIT_DB_PASSWORD` into the VM's `state.env` on first run, as it does
   Slack's, and applies it in `migrate`.
3. **Nothing else.** `KAFKA_BROKERS`, `OPENFGA_URL` and the database URL are
   the VM's own addresses, set in `compose.yaml`.

### While it is not there

Settings › Activity says **"The activity log isn't available yet"** — never an
error — whenever the log cannot be read for any reason other than the reader
not being allowed: the router has no audit subgraph, the service is down, or
the token is missing. No other page asks the audit service anything, so none
can break because of it. Nothing is lost meanwhile: People's and identity's
events wait in Redpanda, and the consumer reads from where its group left off
(from the beginning, the first time).
