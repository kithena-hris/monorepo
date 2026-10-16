-- A member's Zoom beside their calendar (Recruiting PRD §26.2, REC-135): the
-- same sealed grant, one row a provider. Widening the check only; nothing
-- stored changes.
ALTER TABLE recruiting.calendar_link
  DROP CONSTRAINT calendar_link_provider_check,
  ADD CONSTRAINT calendar_link_provider_check
    CHECK (provider IN ('google', 'microsoft', 'zoom'));
