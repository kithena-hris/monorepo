import * as z from 'zod';

/**
 * A push to a person's devices (Settings › Notifications, "on this device"):
 * the browsers and the phones they turned it on for, kept with their account
 * as the `push` preference. A web push is encrypted for its browser
 * (`infrastructure/web-push.ts`); a phone's goes through Expo's push service.
 *
 * What a push says is the item's own title where the module gave one, and the
 * notice's heading otherwise; its button is the item in the Inbox. Nothing is
 * recorded of it beyond what the log says of any send: the outcome.
 */

const WebDevice = z.object({
  kind: z.literal('web'),
  endpoint: z.url().max(2000),
  keys: z.object({ p256dh: z.string().max(200), auth: z.string().max(100) }),
});
const ExpoDevice = z.object({
  kind: z.literal('expo'),
  token: z.string().regex(/^Expo(nent)?PushToken\[[^\]]{1,200}\]$/u),
});
export const PushDevice = z.discriminatedUnion('kind', [WebDevice, ExpoDevice]);
export type PushDevice = z.infer<typeof PushDevice>;

/** The devices in the stored preference, leniently: one that does not parse is skipped. */
export function devicesOf(value: unknown): PushDevice[] {
  const list = (value as { devices?: unknown } | null)?.devices;
  if (!Array.isArray(list)) return [];
  return list.flatMap((d) => {
    const parsed = PushDevice.safeParse(d);
    return parsed.success ? [parsed.data] : [];
  });
}

export interface PushMessage {
  readonly title: string;
  readonly body: string;
  /** The item, on the company's own app; a phone opens the same path in the app. */
  readonly url: string;
  /** One notification per item: a later push with the same tag replaces it. */
  readonly tag: string;
  /** A task: shown at once. An update may wait for the device's next wake. */
  readonly urgent: boolean;
}

export interface PushDeps {
  /** The `push` preference of one account; null when identity cannot be asked. */
  readonly devices: (tenantId: string, accountId: string) => Promise<unknown>;
  readonly web?: (
    device: Extract<PushDevice, { kind: 'web' }>,
    message: PushMessage,
  ) => Promise<'sent' | 'gone' | 'failed'>;
  readonly expo?: (tokens: readonly string[], message: PushMessage) => Promise<void>;
}

export type Push = (tenantId: string, accountId: string, message: PushMessage) => Promise<number>;

/** Every device of the account: how many the push went to. A device that fails never fails the send. */
export function pushTo(deps: PushDeps): Push {
  return async (tenantId, accountId, message) => {
    const devices = devicesOf(await deps.devices(tenantId, accountId).catch(() => null));
    let sent = 0;
    for (const d of devices) {
      if (d.kind !== 'web' || deps.web === undefined) continue;
      if ((await deps.web(d, message).catch(() => 'failed' as const)) === 'sent') sent += 1;
    }
    const tokens = devices.flatMap((d) => (d.kind === 'expo' ? [d.token] : []));
    if (tokens.length > 0 && deps.expo !== undefined) {
      await deps.expo(tokens, message).catch(() => undefined);
      sent += tokens.length;
    }
    return sent;
  };
}

/** A line of a module's words, short enough for a notification. */
export const pushLine = (text: string, max = 180): string => {
  const line =
    text
      .split(/\n\s*\n/u)[0]
      ?.replace(/\s+/gu, ' ')
      .trim() ?? '';
  return line.length <= max ? line : `${line.slice(0, max - 1).trimEnd()}…`;
};
