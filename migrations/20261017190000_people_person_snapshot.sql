-- Every person People holds, as `people.person.snapshot`, for every module
-- that keeps a member list: People's hires before the relay existed never
-- reached a module, so a module saw only their later changes and named them
-- "Someone". People writes the snapshots itself
-- (`services/people/src/infrastructure/snapshot.ts`): for a company whenever
-- its modules change, and here, once, for every company.
--
-- Not written by this migration: migrations run before the services are
-- redeployed, and a module still on its old code would read a snapshot and
-- skip it for good. So this marks every company as due a quarter of an hour
-- from now, and People's background work writes them once that has passed,
-- after the deploy, and clears the mark.
CREATE TABLE people.snapshot_due (
  tenant_id uuid PRIMARY KEY,
  due_at    timestamptz NOT NULL
);

ALTER TABLE people.snapshot_due ENABLE ROW LEVEL SECURITY;
ALTER TABLE people.snapshot_due FORCE  ROW LEVEL SECURITY;
CREATE POLICY snapshot_due_tenant_isolation ON people.snapshot_due
  USING      (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

DO $$
BEGIN
  IF EXISTS (SELECT FROM pg_roles WHERE rolname = 'svc_people') THEN
    GRANT SELECT, INSERT, DELETE ON people.snapshot_due TO svc_people;
  END IF;
END $$;

INSERT INTO people.snapshot_due (tenant_id, due_at)
SELECT DISTINCT tenant_id, now() + interval '15 minutes' FROM people.person
ON CONFLICT DO NOTHING;
