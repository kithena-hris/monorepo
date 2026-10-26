import * as z from 'zod';

/**
 * The devices a person turned push on for (Settings › Notifications), kept
 * with their account as the `push` preference, which Messaging reads to push
 * to them (`platform/messaging/src/message/application/push.ts`).
 */

const WebDevice = z.object({
  kind: z.literal('web'),
  endpoint: z.url().max(2000),
  keys: z.object({ p256dh: z.string().min(1).max(200), auth: z.string().min(1).max(100) }),
  /** What the person would call it: "Chrome on macOS". */
  label: z.string().max(80),
  at: z.string().max(40),
});
const PhoneDevice = z.object({
  kind: z.literal('expo'),
  token: z.string().regex(/^Expo(nent)?PushToken\[[^\]]{1,200}\]$/u),
  label: z.string().max(80),
  at: z.string().max(40),
});
export const PushDevice = z.discriminatedUnion('kind', [WebDevice, PhoneDevice]);
export type PushDevice = z.infer<typeof PushDevice>;

/** Eight is plenty for one person; the oldest goes first, as a phone replaced long ago would. */
export const MAX_DEVICES = 8;

export function devicesOf(value: unknown): PushDevice[] {
  const list = (value as { devices?: unknown } | null)?.devices;
  if (!Array.isArray(list)) return [];
  return list.flatMap((d) => {
    const parsed = PushDevice.safeParse(d);
    return parsed.success ? [parsed.data] : [];
  });
}

const idOf = (d: PushDevice): string => (d.kind === 'web' ? d.endpoint : d.token);

/** The list with this device in it once, newest first, at most eight. */
export function withDevice(list: readonly PushDevice[], device: PushDevice): PushDevice[] {
  return [device, ...list.filter((d) => idOf(d) !== idOf(device))].slice(0, MAX_DEVICES);
}

/** The list without the device with this endpoint or token. */
export const withoutDevice = (list: readonly PushDevice[], id: string): PushDevice[] =>
  list.filter((d) => idOf(d) !== id);
