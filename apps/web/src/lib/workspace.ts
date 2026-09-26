import 'server-only';
import { DescribeInstancesCommand, EC2Client, StartInstancesCommand } from '@aws-sdk/client-ec2';
import { awsCredentialsProvider } from '@vercel/oidc-aws-credentials-provider';

/**
 * The VM that runs People, asleep or awake (`deploy/vm/idle-stop.sh` puts it
 * to sleep; this wakes it).
 *
 * One EC2 instance, named by `WORKSPACE_INSTANCE_ID`, reached with short-lived
 * credentials: Vercel's OIDC token for this deployment, exchanged for the
 * `AWS_ROLE_ARN` role, which may start that one instance and describe
 * instances and nothing else (`deploy/aws/provision.sh`). No AWS key exists
 * anywhere. With any of the three settings unset the feature is off: every
 * function here says so and nothing calls AWS — local dev, other hosts.
 */

export interface WorkspaceConfig {
  readonly instanceId: string;
  readonly roleArn: string;
  readonly region: string;
}

export function workspaceConfig(env: NodeJS.ProcessEnv = process.env): WorkspaceConfig | null {
  const instanceId = env['WORKSPACE_INSTANCE_ID'] ?? '';
  const roleArn = env['AWS_ROLE_ARN'] ?? '';
  const region = env['AWS_REGION'] ?? '';
  return instanceId === '' || roleArn === '' || region === ''
    ? null
    : { instanceId, roleArn, region };
}

/** EC2's instance state, and whether the router answers through the tunnel. */
export interface WorkspaceStatus {
  readonly state: string;
  readonly ready: boolean;
}

let client: EC2Client | undefined;
const ec2 = (config: WorkspaceConfig): EC2Client =>
  (client ??= new EC2Client({
    region: config.region,
    credentials: awsCredentialsProvider({ roleArn: config.roleArn }),
  }));

async function instanceState(config: WorkspaceConfig): Promise<string> {
  const out = await ec2(config).send(
    new DescribeInstancesCommand({ InstanceIds: [config.instanceId] }),
  );
  return out.Reservations?.[0]?.Instances?.[0]?.State?.Name ?? 'unknown';
}

/** `/health/ready` through the public URL: the tunnel, the router and what it waits for. */
async function routerReady(): Promise<boolean> {
  const router = (process.env['ROUTER_URL'] ?? 'http://localhost:4000').replace(/\/$/, '');
  try {
    const response = await fetch(`${router}/health/ready`, {
      cache: 'no-store',
      signal: AbortSignal.timeout(3_000),
    });
    return response.ok;
  } catch {
    return false;
  }
}

export async function workspaceStatus(config: WorkspaceConfig): Promise<WorkspaceStatus> {
  const state = await instanceState(config);
  return { state, ready: state === 'running' && (await routerReady()) };
}

/**
 * Start it. Idempotent twice over: EC2 answers a start of a running instance
 * with its current state, and this sends at most one start a minute from each
 * function instance however many people are waiting.
 *
 * ponytail: the limit is per warm function instance, not global; the IAM
 * role, which can do nothing but start this one VM, is what bounds the harm.
 * Vercel's firewall rate limit on the route is the upgrade if that changes.
 */
const WAKE_EVERY_MS = 60_000;
let lastWake = 0;

export async function wakeWorkspace(
  config: WorkspaceConfig,
  now: number = Date.now(),
): Promise<WorkspaceStatus & { readonly started: boolean }> {
  if (now - lastWake < WAKE_EVERY_MS) {
    return { ...(await workspaceStatus(config)), started: false };
  }
  lastWake = now;
  const out = await ec2(config).send(
    new StartInstancesCommand({ InstanceIds: [config.instanceId] }),
  );
  const state = out.StartingInstances?.[0]?.CurrentState?.Name ?? 'unknown';
  return { state, ready: state === 'running' && (await routerReady()), started: true };
}

/** For the tests: forget the last wake. */
export function resetWakeLimit(): void {
  lastWake = 0;
}
