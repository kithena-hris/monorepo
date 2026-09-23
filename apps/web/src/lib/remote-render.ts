import { fork, type ChildProcess } from 'node:child_process';
import { join } from 'node:path';

/*
 * A remote's server build, rendered to HTML in a process of its own (PEO-115).
 *
 * The shell never evaluates a remote's code in its own process: that process
 * holds the internal token, the session secrets and every other module's
 * data. `remote-renderer.ts` says what the renderer process is denied. This
 * file keeps one of them per build — a new build gets a new process, so
 * nothing an old build left behind survives it — and gives up on a render
 * that takes too long, killing the process when it has gone quiet.
 *
 * Every failure is a rejection, and every rejection means the same thing to
 * the page: draw it in the browser instead.
 */

/** CPU per evaluation and per render, enforced inside the renderer. */
const CPU_MS = 1000;
/** Wall clock per render, from the call: a cold process, a queue, a hang. */
const WALL_MS = 5000;
/** Bigger than any screen; a build answering more is not answering with a screen. */
const MAX_HTML = 5 * 1024 * 1024;

export const RENDERER = join(process.cwd(), '.renderer/renderer.cjs');

interface Pending {
  readonly resolve: (html: string) => void;
  readonly reject: (error: Error) => void;
  readonly timer: NodeJS.Timeout;
}

export interface Renderer {
  readonly child: ChildProcess;
  readonly sha: string;
  readonly pending: Map<number, Pending>;
  ready: Promise<void>;
  heard: number;
}

let current: Renderer | undefined;
let nextId = 0;
/** Builds the renderer would not evaluate: not tried again until they change. */
const refused = new Set<string>();

function stop(renderer: Renderer, why: string): void {
  if (current === renderer) current = undefined;
  renderer.child.kill('SIGKILL');
  for (const [id, pending] of renderer.pending) {
    clearTimeout(pending.timer);
    pending.reject(new Error(why));
    renderer.pending.delete(id);
  }
}

function spawn(code: string, sha: string, path: string): Renderer {
  const child = fork(path, [String(CPU_MS)], {
    // Nothing from this process: not the token, not a URL, not a key.
    env: { NODE_ENV: 'production' },
    execArgv: [
      '--permission',
      `--allow-fs-read=${path}`,
      '--disallow-code-generation-from-strings',
      '--max-old-space-size=256',
    ],
    stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
    serialization: 'json',
  });
  // Neither keeps the shell alive; a renderer whose parent is gone loses its
  // channel and exits with it.
  child.unref();
  child.channel?.unref();
  let settle: { resolve: () => void; reject: (e: Error) => void } | undefined;
  const renderer: Renderer = {
    child,
    sha,
    pending: new Map(),
    ready: new Promise<void>((resolve, reject) => {
      settle = { resolve, reject };
    }),
    heard: Date.now(),
  };
  // Nobody may be waiting on `ready` when it fails.
  renderer.ready.catch(() => undefined);
  child.on('message', (message: unknown) => {
    renderer.heard = Date.now();
    if (typeof message !== 'object' || message === null) return;
    const m = message as { type?: unknown; id?: unknown; html?: unknown; error?: unknown };
    if (m.type === 'ready') settle?.resolve();
    if (m.type === 'refused') {
      // Those waiting hear why from `ready`; the process goes.
      refused.add(sha);
      settle?.reject(
        new Error(`the build was refused: ${typeof m.error === 'string' ? m.error : 'unknown'}`),
      );
      if (current === renderer) current = undefined;
      child.kill('SIGKILL');
      return;
    }
    if (typeof m.id !== 'number') return;
    const pending = renderer.pending.get(m.id);
    if (pending === undefined) return;
    renderer.pending.delete(m.id);
    clearTimeout(pending.timer);
    if (typeof m.html === 'string' && m.html.length <= MAX_HTML) pending.resolve(m.html);
    else
      pending.reject(
        new Error(`the render failed: ${typeof m.error === 'string' ? m.error : 'no HTML'}`),
      );
  });
  child.on('exit', () => {
    settle?.reject(new Error('the renderer exited'));
    stop(renderer, 'the renderer exited');
  });
  child.on('error', () => {
    stop(renderer, 'the renderer could not start');
  });
  child.send({ type: 'load', code });
  return renderer;
}

/**
 * The renderer for this build, started now if it is not running: the page
 * calls this as soon as a build verifies, so the process starts while the
 * page's data is still being fetched.
 */
export function warmRenderer(code: string, sha: string, path: string = RENDERER): Renderer {
  if (current?.sha !== sha) {
    if (current !== undefined) stop(current, 'a newer build replaced it');
    current = spawn(code, sha, path);
  }
  return current;
}

/**
 * The HTML `component` of this build draws from `props`, which are JSON with
 * every function replaced by a marker (`remote-screen.tsx`).
 */
export async function renderRemote(
  code: string,
  sha: string,
  component: string,
  props: string,
  prefix: string,
  path: string = RENDERER,
): Promise<string> {
  if (refused.has(sha)) throw new Error('the build was refused');
  const renderer = warmRenderer(code, sha, path);
  return new Promise<string>((resolve, reject) => {
    const id = ++nextId;
    const timer = setTimeout(() => {
      renderer.pending.delete(id);
      reject(new Error(`the render took longer than ${String(WALL_MS)} ms`));
      // Still answering others means busy; silent this long means stuck.
      if (Date.now() - renderer.heard >= WALL_MS) stop(renderer, 'the renderer stopped answering');
    }, WALL_MS);
    renderer.pending.set(id, { resolve, reject, timer });
    renderer.ready.then(
      () => {
        if (!renderer.pending.has(id)) return;
        try {
          renderer.child.send({ type: 'render', id, component, props, prefix });
        } catch {
          stop(renderer, 'the renderer went away');
        }
      },
      (error: unknown) => {
        clearTimeout(timer);
        renderer.pending.delete(id);
        reject(error instanceof Error ? error : new Error(String(error)));
      },
    );
  });
}

/** For tests, and for a process shutting down. */
export function stopRenderer(): void {
  if (current !== undefined) stop(current, 'stopped');
}
