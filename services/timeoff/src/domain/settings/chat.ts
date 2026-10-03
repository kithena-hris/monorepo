import type { PendingEvent } from '@kithena/domain-kit';
import { SettingsChanged, type TenantId } from '@kithena/contracts';

import { envelope, type EventContext } from '../context.js';

/**
 * What a chat answer may say about private leave (assistant PRD §11.4).
 *
 * A chat app stores messages under the company's retention, not Kithena's,
 * so by default an answer never writes a private leave type beside a name
 * and never lists the people a private-type filter found. A company may
 * choose otherwise: HR switches `namesPrivateLeave` on, and every switch is
 * recorded — who, when, and which way — as `timeoff.settings.changed`. It
 * never widens what anybody sees: Time Off's sight rule has already decided
 * which types an asker sees before an answer is written.
 */
export interface ChatAnswers {
  readonly namesPrivateLeave: boolean;
}

export const DEFAULT_CHAT_ANSWERS: ChatAnswers = { namesPrivateLeave: false };

/** The setting after HR's switch, and the event recording it; null when it is already that way. */
export function switchChatNames(
  ctx: EventContext,
  tenantId: TenantId,
  current: ChatAnswers,
  on: boolean,
): { readonly setting: ChatAnswers; readonly event: PendingEvent } | null {
  if (current.namesPrivateLeave === on) return null;
  return {
    setting: { ...current, namesPrivateLeave: on },
    event: envelope(ctx, {
      tenantId,
      eventName: SettingsChanged.name,
      eventVersion: SettingsChanged.version,
      effectiveFrom: null,
      // A setting has no history of its own to version: the event is the history.
      aggregate: { type: 'Setting', id: 'chat_answers', version: 0 },
      payload: SettingsChanged.payload.parse({ setting: 'chat_names_private_leave', value: on }),
    }),
  };
}
