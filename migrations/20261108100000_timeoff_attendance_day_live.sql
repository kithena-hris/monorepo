-- The days still `live` (a shift nobody has clocked out of), which every
-- report asks about before it reads the rest. Few at any time, so a partial
-- index finds them where the period index read every day of the range.
CREATE INDEX attendance_day_live_idx
  ON timeoff.attendance_day (tenant_id, date)
  WHERE status = 'live';
