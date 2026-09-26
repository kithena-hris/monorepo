import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

/**
 * `deploy/vm/idle-stop.sh`'s decision, fed from the environment as the VM's
 * probes feed it. Only the pure halves run here: nothing touches Docker.
 */
const SCRIPT = fileURLToPath(new URL('../../../deploy/vm/idle-stop.sh', import.meta.url));

const IDLE = {
  UPTIME_SECONDS: '3600',
  REQUESTS: '0',
  NEWEST_START_SECONDS: '7200',
  SESSIONS: '0',
  JOBS: '0',
  ACTIVITIES: '0',
};

function run(args: string[], env: Record<string, string> = {}): { status: number | null; out: string } {
  const result = spawnSync('bash', [SCRIPT, ...args], {
    env: { PATH: process.env['PATH'] ?? '', KITHENA_ETC: '/nonexistent', ...env },
    encoding: 'utf8',
  });
  return { status: result.status, out: result.stdout.trim() };
}

const decide = (overrides: Record<string, string>, minutes = '30') =>
  run(['decide'], { ...IDLE, IDLE_STOP_MINUTES: minutes, ...overrides });

describe('idle-stop decide', () => {
  it('stops when every signal is quiet', () => {
    expect(decide({})).toEqual({ status: 0, out: 'stop: idle for 30 min' });
  });

  it.each([
    [{ UPTIME_SECONDS: '600' }, 'stay: up 600s, under 15 min'],
    [{ REQUESTS: '3' }, 'stay: 3 request(s) in the last 30 min'],
    [{ NEWEST_START_SECONDS: '1799' }, 'stay: a container started or a deploy landed 1799s ago'],
    [{ SESSIONS: '1' }, 'stay: 1 login session(s)'],
    [{ JOBS: '2' }, 'stay: 2 export job(s) in flight'],
    [{ ACTIVITIES: '1' }, 'stay: 1 full-values activit(y/ies) pending'],
  ])('stays for %o', (overrides, line) => {
    expect(decide(overrides)).toEqual({ status: 1, out: line });
  });

  it('measures the window in IDLE_STOP_MINUTES', () => {
    expect(decide({ NEWEST_START_SECONDS: '1799' }, '20').status).toBe(0);
    expect(decide({ NEWEST_START_SECONDS: '3599' }, '60').status).toBe(1);
  });

  it('treats a probe that failed as a reason to stay up', () => {
    expect(decide({ JOBS: 'unknown' })).toEqual({ status: 1, out: 'stay: JOBS unknown (unknown)' });
    expect(decide({ ACTIVITIES: '' })).toEqual({ status: 1, out: 'stay: ACTIVITIES unknown (unset)' });
  });
});

describe('idle-stop after a failed backup', () => {
  it('stops only when the last good backup is under a day old', () => {
    expect(run(['backup-allows', '3600']).status).toBe(0);
    expect(run(['backup-allows', '86400'])).toEqual({
      status: 1,
      out: 'stay: backup failed twice and none has succeeded in 24 h',
    });
    expect(run(['backup-allows', '']).status).toBe(1);
  });
});
