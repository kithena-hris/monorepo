-- A document sent to somebody (Inbox H3, C3, C4, D2, F1): HR chooses what
-- the person does with it, and that decides whether it reaches them as a task
-- or an update. "Just keep it" is filed and is news; "Read and acknowledge"
-- and "Sign it" are tasks, and a signature can then be countersigned.
--
-- The bytes are kept here, beside who may read them: the person, whoever sent
-- it, whoever countersigns, and HR. It is the person's under Documents for as
-- long as their record is kept.
--
-- A signature is a record of who, how, when and where, kept with the
-- document: the typed name or the drawn strokes, the time, and the place the
-- signer's calendar names. The file itself is not rewritten.
--
-- Expand only: one new table.

CREATE TABLE people.document (
  tenant_id         uuid        NOT NULL,
  id                uuid        NOT NULL,
  person_id         uuid        NOT NULL,
  name              text        NOT NULL,
  media_type        text        NOT NULL,
  bytes             bytea       NOT NULL,
  checksum          text        NOT NULL,
  -- keep: filed, an update. acknowledge, sign: a task.
  mode              text        NOT NULL,
  message           text,
  due_on            date,
  sent_by           uuid        NOT NULL,
  sent_at           timestamptz NOT NULL,
  -- The account that countersigns a signed one; null for none.
  countersigner     uuid,
  -- open: waiting on the person. kept, acknowledged, signed (waiting on the
  -- countersigner, or done without one), countersigned: done. declined: sent
  -- back by the person with a note. cancelled: by whoever sent it.
  state             text        NOT NULL,
  signed_name       text,
  signed_how        text,
  -- The typed name, or the drawn strokes as an SVG path.
  signature         text,
  signed_at         timestamptz,
  signed_place      text,
  countersigned_by  uuid,
  countersigned_name text,
  countersigned_at  timestamptz,
  note              text,
  closed_at         timestamptz,

  PRIMARY KEY (tenant_id, id),
  FOREIGN KEY (tenant_id, person_id) REFERENCES people.person (tenant_id, id) ON DELETE CASCADE,
  CONSTRAINT document_type CHECK (media_type IN ('image/png', 'image/jpeg', 'application/pdf')),
  CONSTRAINT document_size CHECK (octet_length(bytes) BETWEEN 1 AND 26214400),
  CONSTRAINT document_name CHECK (length(name) BETWEEN 1 AND 255),
  CONSTRAINT document_checksum_is_sha256 CHECK (checksum ~ '^[0-9a-f]{64}$'),
  CONSTRAINT document_mode_known CHECK (mode IN ('keep', 'acknowledge', 'sign')),
  CONSTRAINT document_state_known CHECK (
    state IN ('open', 'kept', 'acknowledged', 'signed', 'countersigned', 'declined', 'cancelled')
  ),
  CONSTRAINT document_signed_how_known CHECK (signed_how IS NULL OR signed_how IN ('typed', 'drawn')),
  CONSTRAINT document_signature_whole CHECK (
    (signed_at IS NULL) = (signed_name IS NULL AND signed_how IS NULL AND signature IS NULL)
  )
);

-- The person's documents and To do; what a sender or countersigner has out.
CREATE INDEX document_person ON people.document (tenant_id, person_id, sent_at DESC);
CREATE INDEX document_sender ON people.document (tenant_id, sent_by, sent_at DESC);
CREATE INDEX document_countersigner ON people.document (tenant_id, countersigner)
  WHERE state = 'signed';

ALTER TABLE people.document ENABLE ROW LEVEL SECURITY;
ALTER TABLE people.document FORCE  ROW LEVEL SECURITY;
CREATE POLICY document_tenant_isolation ON people.document
  USING      (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

GRANT SELECT, INSERT, UPDATE ON people.document TO svc_people;

-- A document's upload waits where a photo's does, under its own purpose.
ALTER TABLE people.import_upload DROP CONSTRAINT import_upload_purpose;
ALTER TABLE people.import_upload
  ADD CONSTRAINT import_upload_purpose CHECK (purpose IN ('import', 'photo', 'file', 'document'));
