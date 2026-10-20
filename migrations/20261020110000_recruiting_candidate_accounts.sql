-- Candidate accounts on Kithena Jobs (Recruiting PRD §10.5, extended): one
-- account across every company, so a candidate signs in once, keeps a CV
-- library, and sees every application they made here. The account proves an
-- email address (a six-digit code, or Google vouching for it); what a company
-- knows about the candidate stays in that company's own schema, reached by
-- email, never copied here. Public schema, no tenant, written only by
-- Recruiting itself; the jobs reader role never sees it.

CREATE TABLE recruiting_public.candidate_account (
  id               uuid PRIMARY KEY,
  email_norm       text NOT NULL UNIQUE,
  email            text NOT NULL,
  name             text NOT NULL,
  google_sub       text UNIQUE,
  -- "Keep my data to apply faster": when they agreed, and to which notice.
  consented_at     timestamptz,
  consent_notice   text,
  -- The sign-in code in flight, if any: its hash, when it stops working, tries so far.
  code_hash        text,
  code_expires_at  timestamptz,
  code_attempts    integer NOT NULL DEFAULT 0,
  created_at       timestamptz NOT NULL DEFAULT now(),
  last_seen_at     timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE recruiting_public.candidate_session (
  token_hash  text PRIMARY KEY,
  account_id  uuid NOT NULL REFERENCES recruiting_public.candidate_account (id) ON DELETE CASCADE,
  expires_at  timestamptz NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX candidate_session_account_idx ON recruiting_public.candidate_session (account_id);

CREATE TABLE recruiting_public.candidate_cv (
  id          uuid PRIMARY KEY,
  account_id  uuid NOT NULL REFERENCES recruiting_public.candidate_account (id) ON DELETE CASCADE,
  file_name   text NOT NULL,
  media_type  text NOT NULL,
  blob_key    text NOT NULL,
  size        integer NOT NULL,
  is_default  boolean NOT NULL DEFAULT false,
  uploaded_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX candidate_cv_account_idx ON recruiting_public.candidate_cv (account_id, uploaded_at DESC);

GRANT SELECT, INSERT, UPDATE, DELETE ON recruiting_public.candidate_account,
  recruiting_public.candidate_session, recruiting_public.candidate_cv TO svc_recruiting;
