/*
 * The process that renders a remote's server build, and holds nothing worth
 * taking (PEO-115).
 *
 * `remote-render.ts` forks this file, bundled by `scripts/build-renderer.mjs`
 * with the React Next renders with and the design system, and forks it with:
 *
 * - an empty environment — no internal token, no database URL, no key;
 * - Node's permission model, reading only this file: no other file, no child
 *   process, no worker, no native addon;
 * - code generation from strings disallowed in every context, which is what
 *   the usual escapes from a `vm` context (`x.constructor.constructor(...)`)
 *   need;
 * - a heap ceiling, and a parent that kills it when it stops answering.
 *
 * Inside it, the build is evaluated in a `node:vm` context whose global has
 * nothing but the language: no `process`, no `require` beyond the three
 * modules the shell shares, no timers, no `fetch`. Evaluating it and each
 * render run under a CPU timeout, with the context's microtasks drained
 * inside that timeout. A `vm` context is not a security boundary on its own —
 * the objects it is handed are this realm's — so it is the first wall, and
 * the process is the one that matters.
 */
import Module from 'node:module';
import { Script, createContext, type Context } from 'node:vm';
import * as Reach from '@reach/ui';
import * as React from 'react';
import { renderToString } from 'react-dom/server';
import * as jsxRuntime from 'react/jsx-runtime';

const SHARED: Readonly<Record<string, unknown>> = {
  react: React,
  'react/jsx-runtime': jsxRuntime,
  '@reach/ui': Reach,
};
const LIMIT_MS = Number(process.argv[2] ?? '1000');
/** A function prop, which a render never calls; `remote-render.ts` writes the marker. */
const FN = '\u0000fn';

/*
 * No way out over the network either, as far as this process can arrange it.
 * The permission model in Node 24 does not cover sockets, so anything that
 * got past the context would otherwise reach whatever the shell's server can.
 * Best effort by construction — see PRD §17, "Residual risk".
 */
for (const name of ['fetch', 'WebSocket', 'EventSource', 'XMLHttpRequest']) {
  Reflect.deleteProperty(globalThis, name);
}
const NETWORK = /^(node:)?(net|tls|http|https|http2|dgram|dns|dns\/promises|undici)$/;
const loader = Module as unknown as { _load: (request: string, ...rest: unknown[]) => unknown };
const load = loader._load.bind(Module);
loader._load = (request: string, ...rest: unknown[]) => {
  if (NETWORK.test(request)) throw new Error(`${request} is not available to a remote`);
  return load(request, ...rest);
};
Reflect.deleteProperty(process, 'getBuiltinModule');

const GUARDED = new Script('__guarded()', { filename: 'guard' });

/** Run `fn` as if it were the context's own code: under its timeout and microtask queue. */
function guarded<T>(context: Context, fn: () => T): T {
  const global = context as { __guarded?: () => T };
  global.__guarded = fn;
  try {
    return GUARDED.runInContext(context, { timeout: LIMIT_MS }) as T;
  } finally {
    delete global.__guarded;
  }
}

/*
 * Words, in the page's language. Reach's `t` asks one function for every
 * screen (`@reach/ui` `setTranslate`), and a render is synchronous, so the
 * function is set for each render, from that render's language, and nothing
 * else can run in between. A remote works some words out once, as its build
 * is evaluated, so the build is evaluated once per language, in that
 * language: a page in German never shows English worked out for someone else.
 */
type Words = Readonly<Record<string, Readonly<Record<string, string>>>>;
const catalogues = new Map<string, Words>();
/** `''` is the build as written, in English: what `load` checks. */
const builds = new Map<string, { context: Context; exported: Record<string, unknown> }>();
let source: string | undefined;

function speak(language: string): void {
  const words = catalogues.get(language);
  Reach.setTranslate(
    words === undefined
      ? null
      : (ns, key, fallback, vars) => Reach.interpolate(words[ns]?.[key] ?? fallback, vars),
  );
}

function evaluate(
  code: string,
  language: string,
): { context: Context; exported: Record<string, unknown> } {
  speak(language);
  const context = createContext(
    {},
    {
      name: 'remote server build',
      codeGeneration: { strings: false, wasm: false },
      microtaskMode: 'afterEvaluate',
    },
  );
  const wrapper = new Script(`(function (require, module, exports) {\n${code}\n})`, {
    filename: 'ssr/people.cjs',
  }).runInContext(context, { timeout: LIMIT_MS }) as (
    require: (id: string) => unknown,
    module: { exports: Record<string, unknown> },
    exports: Record<string, unknown>,
  ) => void;
  const module: { exports: Record<string, unknown> } = { exports: {} };
  const require = (id: string): unknown => {
    if (!Object.hasOwn(SHARED, id)) throw new Error(`the server build asked for ${id}`);
    return SHARED[id];
  };
  guarded(context, () => {
    wrapper(require, module, module.exports);
  });
  const build = { context, exported: module.exports };
  builds.set(language, build);
  return build;
}

function render(component: string, props: string, prefix: string, language: string | null): string {
  if (source === undefined) throw new Error('no build is loaded');
  const lang = language !== null && catalogues.has(language) ? language : '';
  speak(lang);
  const { context, exported } = builds.get(lang) ?? evaluate(source, lang);
  const Screen = exported[component];
  if (typeof Screen !== 'function') throw new Error(`the build does not export ${component}`);
  const parsed = JSON.parse(props, (_key, value: unknown) =>
    typeof value === 'object' && value !== null && FN in value ? () => undefined : value,
  ) as Record<string, unknown>;
  const element = React.createElement(
    React.Suspense,
    { fallback: null },
    React.createElement(Screen as React.ComponentType<Record<string, unknown>>, parsed),
  );
  const ctx = context;
  const html = guarded(ctx, () => renderToString(element, { identifierPrefix: prefix }));
  // A component that throws is caught by the boundary and left to the
  // browser, `<!--$!-->`; that is a failed render, not a screen.
  if (html.includes('<!--$!-->')) throw new Error('the screen threw while rendering');
  return html;
}

type Message =
  | { readonly type: 'load'; readonly code: string }
  | { readonly type: 'messages'; readonly language: string; readonly messages: Words }
  | {
      readonly type: 'render';
      readonly id: number;
      readonly component: string;
      readonly props: string;
      readonly prefix: string;
      readonly language: string | null;
    };

const send = (message: unknown): void => {
  process.send?.(message);
};

process.on('message', (message: Message) => {
  if (message.type === 'messages') {
    catalogues.set(message.language, message.messages);
    return;
  }
  if (message.type === 'load') {
    try {
      source = message.code;
      builds.clear();
      evaluate(message.code, '');
      send({ type: 'ready' });
    } catch (error) {
      send({ type: 'refused', error: error instanceof Error ? error.message : String(error) });
    }
    return;
  }
  try {
    send({
      id: message.id,
      html: render(message.component, message.props, message.prefix, message.language),
    });
  } catch (error) {
    send({ id: message.id, error: error instanceof Error ? error.message : String(error) });
  }
});
