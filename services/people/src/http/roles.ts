import * as z from 'zod';

/**
 * Tenant roles on the wire (PEO-112), described once for REST, its OpenAPI
 * document and GraphQL, so neither transport accepts a shape the other
 * refuses. Who may grant or revoke is `TenantRoles`' to decide.
 */

export const TenantRoleBody = z
  .enum(['hr', 'finance', 'people_admin'])
  .describe(
    'hr and finance see what §6.6 gives them; people_admin edits the schema and grants roles.',
  );

export const RoleHolderBody = z.object({
  accountId: z.uuid(),
  roles: z.array(TenantRoleBody),
});

export const RoleChangeBody = z.strictObject({
  accountId: z.uuid().describe('The account the role is granted to or revoked from.'),
  role: TenantRoleBody,
  reason: z.string().min(1).max(500).describe('Kept with the change, in its event.'),
});
