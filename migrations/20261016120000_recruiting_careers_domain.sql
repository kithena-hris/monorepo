-- A company's own domain for its careers page (Recruiting PRD §10.1, REC-136).
--
-- In the public projection, beside `company`: Kithena Jobs reads it to know
-- which company a request for `careers.acme.com` is for, and Recruiting to
-- answer that host's browser. No tenant policy, as for the rest of the
-- projection; a host and the company it shows are public by being served.
-- One domain a company.
CREATE TABLE recruiting_public.careers_domain (
  host          text PRIMARY KEY CHECK (host = lower(host)),
  tenant_id     uuid NOT NULL UNIQUE,
  company_slug  text NOT NULL,
  -- `pending` until its DNS points at Kithena Jobs and Vercel has verified it.
  status        text NOT NULL CHECK (status IN ('pending', 'verified')),
  -- What the company's DNS needs, as Vercel answered it.
  records       jsonb NOT NULL DEFAULT '[]',
  added_at      timestamptz NOT NULL DEFAULT now(),
  verified_at   timestamptz
);

GRANT SELECT, INSERT, UPDATE, DELETE ON recruiting_public.careers_domain TO svc_recruiting;
GRANT SELECT ON recruiting_public.careers_domain TO svc_jobs_reader;
