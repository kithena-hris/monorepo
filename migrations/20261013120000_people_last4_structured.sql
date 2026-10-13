-- A sealed amount or signature is stored as JSON, and its "last four" were the
-- JSON's closing characters (`SD"}` under a masked salary). Such a value shows
-- nothing now; clear the tails already written. Data only, no shape change.
UPDATE people.person_secret SET last4 = NULL WHERE last4 ~ '[]}]$';
UPDATE people.pending_change SET last4 = NULL WHERE last4 ~ '[]}]$';
