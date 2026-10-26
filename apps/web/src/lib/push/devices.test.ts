import { describe, expect, it } from 'vitest';

import { devicesOf, MAX_DEVICES, withDevice, withoutDevice, type PushDevice } from './devices';

const web = (n: number): PushDevice => ({
  kind: 'web',
  endpoint: `https://fcm.googleapis.com/fcm/send/${String(n)}`,
  keys: { p256dh: 'p', auth: 'a' },
  label: 'Chrome',
  at: '2026-10-26T00:00:00.000Z',
});

describe('the devices a person pushes to', () => {
  it('keeps each once, newest first, and no more than eight', () => {
    let list: PushDevice[] = [];
    for (let n = 0; n < 10; n += 1) list = withDevice(list, web(n));
    list = withDevice(list, web(5));
    expect(list).toHaveLength(MAX_DEVICES);
    expect(list[0]).toEqual(web(5));
    expect(list.filter((d) => d.kind === 'web' && d.endpoint.endsWith('/5'))).toHaveLength(1);
  });

  it('forgets one, and reads a stored list leniently', () => {
    const list = withDevice([web(1)], {
      kind: 'expo',
      token: 'ExponentPushToken[abc]',
      label: 'iPhone',
      at: '2026-10-26T00:00:00.000Z',
    });
    expect(withoutDevice(list, 'ExponentPushToken[abc]')).toEqual([web(1)]);
    expect(devicesOf({ devices: [web(1), { kind: 'fax' }] })).toEqual([web(1)]);
    expect(devicesOf(null)).toEqual([]);
  });
});
