-- Kiosks punch (PRD §11.9, TOF-107). Expand only: two nullable or defaulted
-- columns and a new table.

-- The highest punch sequence a kiosk has synced. A queue replayed after a
-- dropped answer carries the same sequences, and anything at or below this
-- is nothing new.
ALTER TABLE timeoff.kiosk_device
  ADD COLUMN last_sequence bigint NOT NULL DEFAULT 0;

-- How far a kiosk's clock was from ours when it sent this punch, in seconds,
-- when beyond the threshold. The punch keeps the kiosk's instant and is an
-- exception for HR; null for every other punch.
ALTER TABLE timeoff.punch
  ADD COLUMN clock_skew_seconds integer;

-- ------------------------------------------------------- kiosk_credential --
--
-- A member's badge or PIN, as an HMAC under the module's secret: a dump of
-- this table cannot be walked back to a four-digit PIN without the secret.
-- One of each kind per member, and no two members share one.
CREATE TABLE timeoff.kiosk_credential (
  tenant_id  uuid NOT NULL,
  person_id  uuid NOT NULL,
  kind       text NOT NULL,
  hash       bytea NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),

  PRIMARY KEY (tenant_id, person_id, kind),
  FOREIGN KEY (tenant_id, person_id) REFERENCES timeoff.member (tenant_id, person_id),
  CONSTRAINT kiosk_credential_one_holder UNIQUE (tenant_id, kind, hash),
  CONSTRAINT kiosk_credential_kind_known CHECK (kind IN ('badge', 'pin')),
  CONSTRAINT kiosk_credential_hash_is_hmac_sha256 CHECK (octet_length(hash) = 32)
);

ALTER TABLE timeoff.kiosk_credential ENABLE ROW LEVEL SECURITY;
ALTER TABLE timeoff.kiosk_credential FORCE  ROW LEVEL SECURITY;
CREATE POLICY kiosk_credential_tenant_isolation ON timeoff.kiosk_credential
  USING      (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

-- Replaced by delete and insert; never updated in place.
GRANT SELECT, INSERT, DELETE ON timeoff.kiosk_credential TO svc_timeoff;
