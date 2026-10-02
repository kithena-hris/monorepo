import { EC2Client, StartInstancesCommand } from '@aws-sdk/client-ec2';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

const { resetWakeLimit, wakeWorkspace, workspaceConfig } = await import('./workspace');

const ENV = {
  NODE_ENV: 'test' as const,
  WORKSPACE_INSTANCE_ID: 'i-0123456789abcdef0',
  AWS_ROLE_ARN: 'arn:aws:iam::111122223333:role/kithena-workspace-wake',
  AWS_REGION: 'eu-west-2',
};

// Every EC2 call goes through `send`, so nothing reaches AWS and the OIDC
// credentials provider is never asked for a token.
const send = vi.fn<(command: unknown) => Promise<unknown>>();

beforeEach(() => {
  resetWakeLimit();
  send.mockReset();
  send.mockResolvedValue({});
  vi.spyOn(EC2Client.prototype, 'send').mockImplementation(send as never);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('wakeWorkspace', () => {
  it('is off when any of the three settings is missing', () => {
    expect(workspaceConfig({ ...ENV, WORKSPACE_INSTANCE_ID: '' })).toBeNull();
    expect(workspaceConfig({ ...ENV, AWS_ROLE_ARN: undefined })).toBeNull();
    expect(workspaceConfig(ENV)).toEqual({
      instanceId: ENV.WORKSPACE_INSTANCE_ID,
      roleArn: ENV.AWS_ROLE_ARN,
      region: ENV.AWS_REGION,
    });
  });

  it('starts exactly the configured instance, once a minute however often it is asked', async () => {
    const config = workspaceConfig(ENV);
    if (config === null) throw new Error('configured');
    await wakeWorkspace(config, 100_000);
    await wakeWorkspace(config, 130_000);
    expect(send).toHaveBeenCalledTimes(1);
    const [command] = send.mock.calls[0] ?? [];
    expect(command).toBeInstanceOf(StartInstancesCommand);
    expect((command as StartInstancesCommand).input).toEqual({
      InstanceIds: [ENV.WORKSPACE_INSTANCE_ID],
    });

    await wakeWorkspace(config, 160_001);
    expect(send).toHaveBeenCalledTimes(2);
  });
});
