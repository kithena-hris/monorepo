import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';

/**
 * Chat apps (Slack today; Teams or any other later), as People's settings
 * reach them. Each app is its own platform service; People sees the same few
 * questions of every one — is the company connected, connect it, disconnect
 * it — and keeps for itself which of its notices go to chat apps at all.
 *
 * Its own file so the screens' dependencies can name it without importing
 * the use cases.
 */
export interface ChatConnection {
  /** The workspace or tenant on the chat app's side, as it names itself. */
  readonly workspace: string;
  readonly connectedAt: string;
}

export type ChatAnswer<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly message: string };

export interface ChatApp {
  /** `slack`: in routes and in the settings page. */
  readonly key: string;
  /** `Slack`: the one place the product is named. */
  readonly name: string;
  status(tenantId: string): Promise<{
    /** Connecting is set up in this deployment. */
    readonly canConnect: boolean;
    readonly connection: ChatConnection | null;
  }>;
  /** Where the administrator goes to connect it, coming back to `origin`. */
  authorize(tenantId: string, accountId: string, origin: string): Promise<ChatAnswer<string>>;
  complete(tenantId: string, code: string, state: string): Promise<ChatAnswer<ChatConnection>>;
  disconnect(tenantId: string): Promise<void>;
}

/** Which of People's notices go to chat apps: `people.chat_notice`. */
export interface ChatNoticeStore {
  enabled(tx: PostgresJsDatabase, tenantId: string): Promise<ReadonlySet<string>>;
  set(
    tx: PostgresJsDatabase,
    tenantId: string,
    change: { readonly event: string; readonly on: boolean; readonly by: string; readonly at: string },
  ): Promise<void>;
}

export interface ChatDeps {
  readonly apps: readonly ChatApp[];
  readonly notices: ChatNoticeStore;
}
