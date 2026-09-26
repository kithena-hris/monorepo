import { NextResponse } from 'next/server';

import { currentPerson } from '../../../lib/session';
import { wakeWorkspace, workspaceConfig, workspaceStatus } from '../../../lib/workspace';

/**
 * `GET` whether the People VM is up, `POST` to start it (`lib/workspace.ts`).
 *
 * Signed in, at a company that bought People, or nothing: the same check the
 * People pages make. With the feature off (no `WORKSPACE_INSTANCE_ID`) both
 * answer 404, as for a route that does not exist.
 */
async function allowed(): Promise<NextResponse | null> {
  const person = await currentPerson();
  if (person === null) return NextResponse.json({ ok: false }, { status: 401 });
  if (!person.entitlements.includes('module.people')) {
    return NextResponse.json({ ok: false }, { status: 403 });
  }
  return null;
}

async function answer(act: typeof workspaceStatus): Promise<Response> {
  const config = workspaceConfig();
  if (config === null) return NextResponse.json({ ok: false }, { status: 404 });
  const refused = await allowed();
  if (refused !== null) return refused;
  try {
    return NextResponse.json(
      { ok: true, ...(await act(config)) },
      {
        headers: { 'cache-control': 'no-store' },
      },
    );
  } catch (cause) {
    // AWS refused or could not be reached: the reason is for the logs.
    console.error('workspace: AWS call failed', cause);
    return NextResponse.json({ ok: false }, { status: 502 });
  }
}

export function GET(): Promise<Response> {
  return answer(workspaceStatus);
}

export function POST(): Promise<Response> {
  return answer((config) => wakeWorkspace(config));
}
