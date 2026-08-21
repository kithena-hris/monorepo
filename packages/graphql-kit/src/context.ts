import type { AuthorizationContext, PermissionCheck } from '@kithena/auth-kit';
import type { Logger } from '@kithena/telemetry';

export interface GraphQLContext {
  readonly auth: AuthorizationContext;
  readonly permissions: PermissionCheck;
  readonly logger: Logger;
  readonly correlationId: string;
}
