-- The person: typed columns for what every screen queries, JSONB for the rest,
-- history for the truth, and an outbox so no write leaves without its event.
--
-- ### Why the shape is split
--
-- Hire date, manager, salary, status and employee number are queried, joined,
-- sorted and constrained on every screen and every report. They get real
-- types, real foreign keys, real check constraints, and `numeric(19,4)` for
-- money because money is never a float. A JSONB-only design gives all of that
-- up for a uniformity nobody asked for.
--
-- Everything the tenant invented lives in `custom`, validated on write against
-- the published schema version stored on the row. An attribute marked
-- `indexed` is promoted to a generated column by a migration the tool in
-- PEO-023 writes — never by runtime DDL, which against a multi-tenant
-- production database is an outage with a settings screen in front of it.
--
-- ### History is the truth; the person row is a projection
--
-- Every change writes an append-only history row and an outbox row in the same
-- transaction. An `asOf` read replays history. If the row and the history
-- disagree, the history wins and the projection is rebuilt — which is also how
-- a migration to a new field shape happens without touching what was recorded.

-- ------------------------------------------------------------------ person --
CREATE TABLE people.person (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id           uuid NOT NULL,

  -- The identity account this record belongs to, when there is one.
  --
  -- Nullable because a record can exist before an account does — an import of
  -- four hundred people creates four hundred rows and no logins — and because
  -- identity is a separate service: there is no foreign key here, and there
  -- cannot be. A module that joined to `platform.account` would stop booting
  -- alone, which is the one thing every module must do.
  identity_account_id uuid,

  -- The lifecycle, which starts before employment and outlives it.
  status              text NOT NULL DEFAULT 'provisional',

  -- Typed core. Queried on every screen, so none of this is in `custom`.
  employee_number     text,
  legal_entity_id     uuid,
  given_name          text,
  family_name         text,
  preferred_name      text,
  work_email          text,

  -- Calendar dates, not timestamps. Somebody hired on the 1st in Barcelona was
  -- not hired on the 31st in Los Angeles.
  hire_date           date,
  seniority_date      date,
  last_working_day    date,

  -- Constrained to the same tenant by `person_manager_in_same_tenant` below.
  manager_id          uuid,
  org_unit_id         uuid,
  location_id         uuid,

  employment_type     text,
  work_model          text,
  -- 1.0000 is full time. Four decimal places because a 0.3333 split across
  -- three entities has to add back up.
  fte                 numeric(5,4),

  -- Minor units would be the transport form; this is storage, where the scale
  -- is explicit and exact. Never a float, anywhere, ever.
  base_salary         numeric(19,4),
  salary_currency     char(3),

  -- Everything the tenant invented, current values only. Validated on write
  -- against `schema_version`, which is why that column is on the row.
  custom              jsonb NOT NULL DEFAULT '{}'::jsonb,

  -- Which published version this record was last written under.
  --
  -- Load bearing rather than informational: a DSAR export is generated from
  -- the version the record was written under, and a consumer replaying the
  -- stream years later has no other way to know which shape it is reading.
  schema_version      int,

  -- Derived, never a decision somebody made: a record becomes incomplete
  -- because a version was published, not because anybody edited it. Stored so
  -- a directory can filter on it without recomputing 50,000 verdicts.
  completeness        text NOT NULL DEFAULT 'not_applicable',

  -- Whether People owns this record or is mirroring somebody else's system.
  source_of_record    text NOT NULL DEFAULT 'own',

  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),

  -- The target the manager reference below needs, and the reason it is here
  -- rather than added afterwards: a foreign key names a unique constraint, and
  -- one declared by a later `ALTER TABLE` does not yet exist when the
  -- self-reference is resolved.
  CONSTRAINT person_tenant_id_key UNIQUE (tenant_id, id),

  CONSTRAINT person_status_known CHECK (
    status IN ('provisional', 'pre_hire', 'active', 'on_leave', 'notice', 'terminated', 'discarded')
  ),
  CONSTRAINT person_completeness_known CHECK (
    completeness IN ('complete', 'incomplete', 'not_applicable')
  ),
  CONSTRAINT person_source_known CHECK (source_of_record IN ('own', 'external')),
  CONSTRAINT person_employment_type_known CHECK (
    employment_type IS NULL
    OR employment_type IN ('permanent', 'fixed_term', 'contractor', 'intern', 'apprentice', 'seasonal')
  ),
  CONSTRAINT person_work_model_known CHECK (
    work_model IS NULL OR work_model IN ('onsite', 'hybrid', 'remote')
  ),
  -- A last working day before the hire date describes an employment nobody
  -- had. The domain refuses it; so does the row, because an import and a
  -- mirror-mode sync do not go through the domain's transition.
  CONSTRAINT person_last_day_after_hire CHECK (
    last_working_day IS NULL OR hire_date IS NULL OR last_working_day >= hire_date
  ),
  -- An amount with no currency is a number nobody can add up, and a currency
  -- with no amount is a setting pretending to be a salary.
  CONSTRAINT person_salary_has_currency CHECK (
    (base_salary IS NULL) = (salary_currency IS NULL)
  ),
  CONSTRAINT person_fte_in_range CHECK (fte IS NULL OR (fte > 0 AND fte <= 1)),
  -- Nobody manages themselves. Cheap to check, and the cycle it prevents is
  -- one an org chart walk would follow forever.
  CONSTRAINT person_manager_is_somebody_else CHECK (manager_id IS NULL OR manager_id <> id),
  -- `custom` holds an object. An array or a scalar here would pass `jsonb` and
  -- break every reader that expects `custom->>'key'` to mean something.
  CONSTRAINT person_custom_is_an_object CHECK (jsonb_typeof(custom) = 'object')
);

-- A manager is a person in the same tenant, and the composite reference is
-- what makes "the same tenant" something the database knows rather than
-- something a query remembers. Added after the table exists, because a
-- self-reference cannot be resolved while it is being created.
ALTER TABLE people.person
  ADD CONSTRAINT person_manager_in_same_tenant
  FOREIGN KEY (tenant_id, manager_id) REFERENCES people.person (tenant_id, id);

-- One account, one person. The consumer that creates a provisional record on
-- `identity.account.provisioned` is idempotent because of this index rather
-- than because it remembers to check first.
CREATE UNIQUE INDEX person_identity_account_key
  ON people.person (tenant_id, identity_account_id)
  WHERE identity_account_id IS NOT NULL;

-- Employee numbers are unique per tenant where they exist. Partial, because
-- most records have none until HR assigns one.
CREATE UNIQUE INDEX person_employee_number_key
  ON people.person (tenant_id, employee_number)
  WHERE employee_number IS NOT NULL;

-- The directory's default read: live people, by name.
CREATE INDEX person_directory_idx
  ON people.person (tenant_id, status, family_name, given_name);

-- "Who reports to this person", which every org chart and every manager's team
-- view asks.
CREATE INDEX person_manager_idx ON people.person (tenant_id, manager_id);

-- The completeness grid, which reads exactly the incomplete records.
CREATE INDEX person_incomplete_idx
  ON people.person (tenant_id)
  WHERE completeness = 'incomplete';

-- Containment queries over tenant-defined attributes. GIN with `jsonb_path_ops`
-- rather than the default: it is smaller and faster for `@>`, which is the only
-- operator a directory filter uses. An attribute needing range or prefix search
-- is one marked `indexed` and promoted to a real column.
CREATE INDEX person_custom_idx ON people.person USING gin (custom jsonb_path_ops);

ALTER TABLE people.person ENABLE ROW LEVEL SECURITY;
ALTER TABLE people.person FORCE  ROW LEVEL SECURITY;
CREATE POLICY person_tenant_isolation ON people.person
  USING      (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

CREATE TRIGGER person_touch_updated_at
  BEFORE UPDATE ON people.person
  FOR EACH ROW EXECUTE FUNCTION platform.touch_updated_at();

-- -------------------------------------------- person_attribute_history --
--
-- Append-only. A change is a new dated fact; a correction is a new row
-- carrying `supersedes` and never an UPDATE.
--
-- The reason is one sentence: a salary typo corrected three months later must
-- not read as a pay cut followed by a raise. The superseded row stays, because
-- "what did we believe in February" is what an auditor asks when March's
-- payslip was wrong.
CREATE TABLE people.person_attribute_history (
  -- UUIDv7, written by the application. Sortable by time, which makes reading
  -- the sequence of a record's changes an index scan rather than a sort.
  id             uuid PRIMARY KEY,
  tenant_id      uuid NOT NULL,
  person_id      uuid NOT NULL,
  attribute_key  text NOT NULL,

  -- The value as stored. JSONB because an attribute may be a string, a number,
  -- an address or a repeating group, and history has to hold all four. A
  -- secret never appears here: an encrypted attribute records the fact of a
  -- change and keeps its ciphertext in `people.person_secret`.
  value          jsonb,

  -- When it takes effect in the domain, and when we recorded it. Both, always:
  -- a promotion entered on the 15th and effective on the 1st needs the pair or
  -- payroll cannot compute the retroactive delta.
  effective_from date NOT NULL,
  recorded_at    timestamptz NOT NULL DEFAULT now(),

  -- Who did it, as an `Actor`: a user, an integration or a system process.
  actor          jsonb NOT NULL,

  -- The history row this one replaces. Null for an ordinary change.
  supersedes     uuid,

  -- The outbox event this change produced, so a row and its event can be tied
  -- together when somebody is reading an incident backwards.
  event_id       uuid,

  FOREIGN KEY (tenant_id, person_id) REFERENCES people.person (tenant_id, id),
  FOREIGN KEY (supersedes) REFERENCES people.person_attribute_history (id),

  CONSTRAINT history_attribute_key_shape CHECK (attribute_key ~ '^[a-z][a-z0-9_]*$'),
  CONSTRAINT history_supersedes_is_not_itself CHECK (supersedes IS NULL OR supersedes <> id)
);

-- One live correction per fact. Two would be two answers to "what was the
-- salary in March"; correcting a correction names the correction.
CREATE UNIQUE INDEX history_one_correction_per_row
  ON people.person_attribute_history (supersedes)
  WHERE supersedes IS NOT NULL;

-- The `asOf` read: one person, one attribute, in effective order.
CREATE INDEX history_timeline_idx
  ON people.person_attribute_history (tenant_id, person_id, attribute_key, effective_from);

ALTER TABLE people.person_attribute_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE people.person_attribute_history FORCE  ROW LEVEL SECURITY;
CREATE POLICY history_tenant_isolation ON people.person_attribute_history
  USING      (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

/*
 * Append-only, enforced rather than intended.
 *
 * The whole correction mechanism rests on history not being editable. A
 * repository written in a hurry, a support session or a backfill script could
 * otherwise UPDATE a row and turn a typo into a fact nobody can find.
 */
CREATE OR REPLACE FUNCTION people.refuse_history_change()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION
    'people.person_attribute_history is append-only; write a correction carrying supersedes'
    USING ERRCODE = 'restrict_violation';
END $$;

CREATE TRIGGER history_is_append_only
  BEFORE UPDATE OR DELETE ON people.person_attribute_history
  FOR EACH ROW EXECUTE FUNCTION people.refuse_history_change();

-- ----------------------------------------------------------- person_secret --
--
-- Bank accounts, national identifiers and tax identifiers. Envelope
-- encryption, its own policy, its own grant.
--
-- There is no plaintext column, and the integration test asserts the column
-- list rather than trusting this comment. `last4` is what a screen shows —
-- enough to confirm which account somebody meant, useless to anybody who
-- dumps the table. The key id is recorded per row so a rotation knows what it
-- is re-wrapping.
--
-- Nothing here reaches `custom` and nothing here reaches an event.
CREATE TABLE people.person_secret (
  tenant_id     uuid NOT NULL,
  person_id     uuid NOT NULL,
  attribute_key text NOT NULL,

  ciphertext    bytea NOT NULL,
  -- Which data key wrapped it. A rotation re-wraps by this rather than by
  -- decrypting everything and hoping.
  key_id        text  NOT NULL,
  -- For display only. Four characters, and the constraint says so, because a
  -- "last4" that quietly held eight would be the account number in the column
  -- named for not being it.
  last4         text,

  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),

  PRIMARY KEY (tenant_id, person_id, attribute_key),
  FOREIGN KEY (tenant_id, person_id) REFERENCES people.person (tenant_id, id),

  CONSTRAINT secret_key_shape CHECK (attribute_key ~ '^[a-z][a-z0-9_]*$'),
  CONSTRAINT secret_last4_is_four CHECK (last4 IS NULL OR length(last4) <= 4)
);

ALTER TABLE people.person_secret ENABLE ROW LEVEL SECURITY;
ALTER TABLE people.person_secret FORCE  ROW LEVEL SECURITY;
CREATE POLICY person_secret_tenant_isolation ON people.person_secret
  USING      (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

CREATE TRIGGER person_secret_touch_updated_at
  BEFORE UPDATE ON people.person_secret
  FOR EACH ROW EXECUTE FUNCTION platform.touch_updated_at();

-- --------------------------------------------------------- attribute_unique --
--
-- Uniqueness on a tenant-defined attribute, without runtime DDL.
--
-- A rule that a custom field must be unique is a row here with a real unique
-- index over it, written in the same transaction as the value. This is the
-- point in the design most likely to be implemented as `CREATE INDEX` at
-- runtime, and the reason not to is that DDL against a multi-tenant
-- production database takes an exclusive lock on a table every tenant is
-- reading.
--
-- `scope_id` carries the legal entity when the rule is per entity, and the
-- tenant id when it is per tenant. One column rather than two nullable ones,
-- because a unique index over a nullable column does not constrain the rows
-- where it is null — which is every row the rule was written for.
CREATE TABLE people.attribute_unique (
  tenant_id        uuid NOT NULL,
  attribute_key    text NOT NULL,
  scope_id         uuid NOT NULL,
  -- Casefolded and trimmed by the application before it arrives. Two people
  -- whose employee numbers differ only in whitespace are one collision, not
  -- two records.
  normalised_value text NOT NULL,
  person_id        uuid NOT NULL,

  created_at       timestamptz NOT NULL DEFAULT now(),

  PRIMARY KEY (tenant_id, attribute_key, scope_id, normalised_value),
  FOREIGN KEY (tenant_id, person_id) REFERENCES people.person (tenant_id, id) ON DELETE CASCADE,

  CONSTRAINT attribute_unique_key_shape CHECK (attribute_key ~ '^[a-z][a-z0-9_]*$'),
  CONSTRAINT attribute_unique_value_present CHECK (normalised_value <> '')
);

-- "Which claims does this person hold", for the update path that has to
-- release the old value when a field changes.
CREATE INDEX attribute_unique_person_idx
  ON people.attribute_unique (tenant_id, person_id);

ALTER TABLE people.attribute_unique ENABLE ROW LEVEL SECURITY;
ALTER TABLE people.attribute_unique FORCE  ROW LEVEL SECURITY;
CREATE POLICY attribute_unique_tenant_isolation ON people.attribute_unique
  USING      (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

-- ------------------------------------------------------------------ outbox --
--
-- The same shape as `platform.outbox`, in this module's schema, because no
-- module reads another's tables and that includes the outbox.
--
-- The write and its event commit together. Debezium tails the WAL from here,
-- so an event exists if and only if the row committed — which is what "no dual
-- writes" means in practice.
CREATE TABLE people.outbox (
  event_id       uuid PRIMARY KEY,
  tenant_id      uuid NOT NULL,
  event_name     text NOT NULL,
  event_version  text NOT NULL,
  aggregate_type text NOT NULL,
  aggregate_id   text NOT NULL,
  -- `tenantId:aggregateId`, which is what guarantees per-person ordering
  -- downstream. Two changes to one person arrive in the order they committed.
  partition_key  text NOT NULL,
  envelope       jsonb NOT NULL,
  created_at     timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX people_outbox_created_idx ON people.outbox (created_at);

ALTER TABLE people.outbox ENABLE ROW LEVEL SECURITY;
ALTER TABLE people.outbox FORCE  ROW LEVEL SECURITY;
CREATE POLICY people_outbox_tenant_isolation ON people.outbox
  USING      (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

-- ------------------------------------------------------------------ grants --
--
-- DELETE on `person` because a discarded provisional record is the one state a
-- hard delete may follow, and on `attribute_unique` because a claim is
-- released when the value that held it changes. Nowhere else: history is
-- append-only, an outbox row is consumed rather than removed by this service,
-- and a secret is overwritten by a rotation rather than deleted.
GRANT SELECT, INSERT, UPDATE, DELETE ON people.person                   TO svc_people;
GRANT SELECT, INSERT                 ON people.person_attribute_history TO svc_people;
GRANT SELECT, INSERT, UPDATE         ON people.person_secret            TO svc_people;
GRANT SELECT, INSERT, DELETE         ON people.attribute_unique         TO svc_people;
GRANT SELECT, INSERT                 ON people.outbox                   TO svc_people;
