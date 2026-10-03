-- What a manager writes with the dates they suggest (T18, TOF-099b), kept
-- beside who suggested them so the member reads it on their request. Free
-- text typed by a person; nullable and added empty, an expand.
ALTER TABLE timeoff.request ADD COLUMN proposal_message text;
ALTER TABLE timeoff.request ADD CONSTRAINT request_proposal_message_length
  CHECK (proposal_message IS NULL OR char_length(proposal_message) <= 1000);
