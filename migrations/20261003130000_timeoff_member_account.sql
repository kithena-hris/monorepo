-- The account a member signs in with (TOF-050a), so a caller the router
-- names by account becomes the member it is. People's `hired` and
-- `identity_linked` carry it; an import may. Nullable: a member with no
-- account is somebody HR books time off for, and expand-only like every
-- migration here.
--
-- Not unique: People moves an account between records on a merge, and the
-- two events need not arrive in one transaction. A caller resolves only when
-- exactly one member holds the account (`drizzle-members.ts`).
ALTER TABLE timeoff.member ADD COLUMN account_id uuid;

CREATE INDEX member_account_idx ON timeoff.member (tenant_id, account_id)
  WHERE account_id IS NOT NULL;
