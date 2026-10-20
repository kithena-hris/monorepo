-- Kithena Jobs accounts: the picture Google vouched for, shown beside the
-- candidate's name on their own pages. Expand only; nothing without one.

ALTER TABLE recruiting_public.candidate_account ADD COLUMN picture_url text;
