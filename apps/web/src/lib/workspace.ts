import 'server-only';
import { EC2Client, StartInstancesCommand } from '@aws-sdk/client-ec2';
import { awsCredentialsProvider } from '@vercel/oidc-aws-credentials-provider';

/**
 * The VM that runs People, woken (`deploy/vm/idle-stop.sh` puts it to sleep).
 * Asked by `lib/people.ts` whenever the router is not up yet.
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

let client: EC2Client | undefined;
const ec2 = (config: WorkspaceConfig): EC2Client =>
  (client ??= new EC2Client({
    region: config.region,
    credentials: awsCredentialsProvider({ roleArn: config.roleArn }),
  }));

/**
 * Start it. Idempotent twice over: EC2 answers a start of a running instance
 * with its current state, and this sends at most one start a minute from each
 * function instance however many people are waiting.
 *
 * Only a signed-in person's request gets here: `lib/people.ts` asks after
 * identity has minted their token, never for an anonymous one.
 *
 * ponytail: the limit is per warm function instance, not global; the IAM
 * role, which can do nothing but start this one VM, is what bounds the harm.
 * A shared limit (Valkey is on the VM, so not there) is the upgrade if that changes.
 */
const WAKE_EVERY_MS = 60_000;
let lastWake = 0;

export async function wakeWorkspace(
  config: WorkspaceConfig,
  now: number = Date.now(),
): Promise<void> {
  if (now - lastWake < WAKE_EVERY_MS) return;
  lastWake = now;
  await ec2(config).send(new StartInstancesCommand({ InstanceIds: [config.instanceId] }));
}

/** For the tests: forget the last wake. */
export function resetWakeLimit(): void {
  lastWake = 0;
}
