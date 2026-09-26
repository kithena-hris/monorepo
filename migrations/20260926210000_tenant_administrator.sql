-- Who the back office has named to administer each module (PEO-112).
--
-- Until now naming was an event and nothing more: identity raised
-- `identity.tenant.administrator_named` and forgot, so a module could have
-- only ever one administrator the back office knew of, none could be shown,
-- and none taken back. A module may now have several, the company page lists
-- them, and removing one raises `identity.tenant.administrator_removed` — which
-- needs a memory of who is named, and "never the last one" needs a count.
--
-- This is the back office's list, not the module's roles. People keeps its
-- own ledger (`people.role_grant`) and the company grants its own roles
-- there; no module reads this table.
--
-- Expand only, per CLAUDE.md: a new table, nothing existing changes.
CREATE TABLE platform.tenant_administrator (
  tenant_id   uuid        NOT NULL REFERENCES platform.tenant (id),
  -- `module.<key>`, the shape `tenant_entitlements_shape` allows.
  entitlement text        NOT NULL,
  -- An invitation withdrawn deletes its account, and the naming goes with it.
  account_id  uuid        NOT NULL REFERENCES platform.account (id) ON DELETE CASCADE,
  -- The back-office operator; not an account at the company, so no reference.
  named_by    uuid,
  named_at    timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, entitlement, account_id),
  CONSTRAINT tenant_administrator_entitlement_shape CHECK (entitlement ~ '^module\.[a-z]{2,32}$')
);

CREATE INDEX tenant_administrator_account_idx ON platform.tenant_administrator (account_id);

-- Carried over: everybody named so far, from the events that named them —
-- the outbox keeps every one. Before row-level security is switched on, and
-- read through the owner's view of `platform.outbox`, as 20260924270200 reads
-- `people.person`: every tenant where the owner bypasses RLS, as Neon's does.
-- An account since withdrawn is skipped; one that left stays and is simply
-- not shown, which is what the application does for a leaver anyway.
INSERT INTO platform.tenant_administrator (tenant_id, entitlement, account_id, named_by, named_at)
SELECT o.tenant_id,
       o.envelope -> 'payload' ->> 'entitlement',
       (o.envelope -> 'payload' ->> 'accountId')::uuid,
       NULLIF(o.envelope -> 'payload' ->> 'namedBy', '')::uuid,
       o.created_at
  FROM platform.outbox o
  JOIN platform.account a
    ON a.id = (o.envelope -> 'payload' ->> 'accountId')::uuid AND a.tenant_id = o.tenant_id
 WHERE o.event_name = 'identity.tenant.administrator_named'
 ORDER BY o.created_at, o.event_id
ON CONFLICT DO NOTHING;

ALTER TABLE platform.tenant_administrator ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform.tenant_administrator FORCE  ROW LEVEL SECURITY;
CREATE POLICY tenant_administrator_tenant_isolation ON platform.tenant_administrator
  USING      (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

-- No UPDATE: somebody is named or they are not.
GRANT SELECT, INSERT, DELETE ON platform.tenant_administrator TO svc_identity;
