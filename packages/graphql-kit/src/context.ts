import type { AuthorizationContext, PermissionCheck } from '@hris/auth-kit';
import type { Logger } from '@hris/telemetry';

export interface GraphQLContext {
  readonly auth: AuthorizationContext;
  readonly permissions: PermissionCheck;
  readonly logger: Logger;
  readonly correlationId: string;
}
