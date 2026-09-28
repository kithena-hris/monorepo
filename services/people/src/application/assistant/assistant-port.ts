import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import type { GatewayResult, Prompt } from '@kithena/telemetry';

type Tx = PostgresJsDatabase;

/** What the assistant needs of the outside: the AI gateway, and the policies it checks with. */
export interface AssistantPort {
  /** The AI gateway: the only way a prompt leaves. */
  readonly complete: (tenantId: string, prompt: Prompt) => Promise<GatewayResult>;
  /** Make sure the gateway knows this tenant's field policies before it checks a prompt. */
  readonly loadPolicies: (tx: Tx, tenantId: string) => Promise<void>;
}
