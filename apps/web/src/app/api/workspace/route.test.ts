import { DescribeInstancesCommand, EC2Client, StartInstancesCommand } from '@aws-sdk/client-ec2';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
const person = vi.fn<() => Promise<unknown>>();
vi.mock('../../../lib/session', () => ({ currentPerson: () => person() }));

const { GET, POST } = await import('./route');
const { resetWakeLimit } = await import('../../../lib/workspace');

const SIGNED_IN = { accountId: 'a', entitlements: ['module.people'] };
const ENV = {
  WORKSPACE_INSTANCE_ID: 'i-0123456789abcdef0',
  AWS_ROLE_ARN: 'arn:aws:iam::111122223333:role/kithena-workspace-wake',
  AWS_REGION: 'eu-west-2',
  ROUTER_URL: 'https://api.example.test',
};

// Every EC2 call goes through `send`, so nothing reaches AWS and the OIDC
// credentials provider is never asked for a token.
const send = vi.fn<(command: unknown) => Promise<unknown>>();
const routerFetch = vi.fn<(url: string, init?: unknown) => Promise<Response>>();

beforeEach(() => {
  for (const [k, v] of Object.entries(ENV)) vi.stubEnv(k, v);
  person.mockResolvedValue(SIGNED_IN);
  resetWakeLimit();
  send.mockReset();
  send.mockImplementation((command) =>
    Promise.resolve(
      command instanceof StartInstancesCommand
        ? { StartingInstances: [{ CurrentState: { Name: 'pending' } }] }
        : { Reservations: [{ Instances: [{ State: { Name: 'running' } }] }] },
    ),
  );
  vi.spyOn(EC2Client.prototype, 'send').mockImplementation(send as never);
  routerFetch.mockReset();
  routerFetch.mockImplementation(() => Promise.resolve(new Response('ok')));
  vi.stubGlobal('fetch', routerFetch);
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

interface Sent {
  readonly constructor: unknown;
  readonly input: unknown;
}
const commands = (): Sent[] => send.mock.calls.map(([command]) => command as Sent);

describe('/api/workspace', () => {
  it('is off, and calls nothing, when the instance is not configured', async () => {
    vi.stubEnv('WORKSPACE_INSTANCE_ID', '');
    expect((await POST()).status).toBe(404);
    expect((await GET()).status).toBe(404);
    expect(send).not.toHaveBeenCalled();
  });

  it('refuses anybody not signed in, or at a company without People', async () => {
    person.mockResolvedValue(null);
    expect((await POST()).status).toBe(401);
    person.mockResolvedValue({ ...SIGNED_IN, entitlements: [] });
    expect((await POST()).status).toBe(403);
    expect(send).not.toHaveBeenCalled();
  });

  it('starts exactly the configured instance', async () => {
    const response = await POST();
    expect(await response.json()).toEqual({
      ok: true,
      state: 'pending',
      ready: false,
      started: true,
    });
    expect(commands()).toHaveLength(1);
    expect(commands()[0]).toBeInstanceOf(StartInstancesCommand);
    expect(commands()[0]?.input).toEqual({ InstanceIds: ['i-0123456789abcdef0'] });
  });

  it('sends one start a minute however often it is asked, and describes instead', async () => {
    await POST();
    const again = await POST();
    expect(await again.json()).toMatchObject({ ok: true, state: 'running', started: false });
    expect(commands().map((c) => c.constructor)).toEqual([
      StartInstancesCommand,
      DescribeInstancesCommand,
    ]);
  });

  it('is ready only when the instance runs and the router answers through the tunnel', async () => {
    expect(await (await GET()).json()).toEqual({ ok: true, state: 'running', ready: true });
    expect(routerFetch).toHaveBeenCalledWith(
      'https://api.example.test/health/ready',
      expect.anything(),
    );
    expect(commands()[0]?.input).toEqual({ InstanceIds: ['i-0123456789abcdef0'] });

    routerFetch.mockResolvedValue(new Response('', { status: 530 }));
    expect(await (await GET()).json()).toMatchObject({ ready: false });
  });

  it('answers 502 when AWS refuses', async () => {
    send.mockRejectedValue(new Error('AccessDenied'));
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    expect((await GET()).status).toBe(502);
  });
});
