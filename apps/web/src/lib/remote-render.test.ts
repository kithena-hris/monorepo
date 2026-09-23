import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { RENDERER, renderRemote, stopRenderer } from './remote-render';

/*
 * The renderer process against builds that behave and builds that do not
 * (PEO-115). Each build is a CommonJS string, as `ssr/people.cjs` is.
 */

beforeAll(() => {
  execFileSync(process.execPath, [join(import.meta.dirname, '../../scripts/build-renderer.mjs')], {
    stdio: 'inherit',
  });
}, 60_000);

afterAll(() => {
  stopRenderer();
});

const sha = (code: string) => createHash('sha384').update(code).digest('base64');
const render = (code: string, props: Record<string, unknown> = {}, component = 'Screen') =>
  renderRemote(code, sha(code), component, JSON.stringify(props), 'remote-', RENDERER);

const screen = (body: string) => `
  const { jsx } = require('react/jsx-runtime');
  const { Button } = require('@reach/ui');
  exports.Screen = function Screen(props) { ${body} };
`;

const legitimate = screen(`
  const id = require('react').useId();
  return jsx('section', { 'aria-labelledby': id, children: [
    jsx('h2', { id, children: props.title }),
    jsx(Button, { onClick: props.onSave, children: 'Save' }),
  ] });
`);

describe('a build that behaves', () => {
  it('renders with the shell’s React and Reach, the same way every time', async () => {
    const props = { title: 'Personal information', onSave: { '\u0000fn': true } };
    const html = await render(legitimate, props);
    expect(html).toContain('Personal information');
    expect(html).toMatch(/<button[^>]*>Save<\/button>/);
    // The id comes from the prefix the browser's own root hydrates with.
    expect(html).toMatch(/id="[^"]*remote-/);
    // Inside a Suspense boundary, as the browser's root has it.
    expect(html.startsWith('<!--$-->')).toBe(true);
    expect(await render(legitimate, props)).toBe(html);
  });
});

describe('a build that does not', () => {
  it('cannot read the environment: there is no process', async () => {
    await expect(render(`exports.x = process.env;`)).rejects.toThrow(
      /refused: .*process is not defined/,
    );
    await expect(
      render(screen(`return jsx('p', { children: process.env.PEOPLE_API_TOKEN });`)),
    ).rejects.toThrow(/threw while rendering/);
  });

  it('cannot require anything the shell does not share', async () => {
    await expect(render(`require('node:fs');`)).rejects.toThrow(/asked for node:fs/);
    await expect(
      render(
        screen(`return jsx('p', { children: require('node:child_process').execSync('id') });`),
      ),
    ).rejects.toThrow(/threw while rendering/);
  });

  it('finds a global with nothing but the language on it', async () => {
    const html = await render(
      screen(`
        globalThis.leaked = 'yes';
        return jsx('p', { children: [typeof globalThis.process, typeof globalThis.require,
          typeof setTimeout, typeof setImmediate, typeof fetch, typeof globalThis.module].join(' ') });
      `),
    );
    expect(html).toContain('undefined undefined undefined undefined undefined undefined');
    expect((globalThis as Record<string, unknown>)['leaked']).toBeUndefined();
  });

  it('cannot climb out of the context through a shared object', async () => {
    await expect(
      render(`
        const host = require('react').createElement.constructor('return process')();
        exports.token = host.env.PEOPLE_API_TOKEN;
      `),
    ).rejects.toThrow(/Code generation from strings disallowed/);
  });

  it('is stopped when it loops, on evaluation or on render, and the next build still renders', async () => {
    await expect(render(`while (true) {}`)).rejects.toThrow(/refused.*timed out/);
    await expect(render(screen(`while (true) {} `))).rejects.toThrow(/timed out/);
    // A microtask loop the timeout interrupts; the process may not survive
    // that, and either way nobody waits on it.
    await expect(
      render(
        screen(
          `Promise.resolve().then(function f() { return Promise.resolve().then(f); }); return null;`,
        ),
      ),
    ).rejects.toThrow(/timed out|exited/);
    const html = await render(legitimate, { title: 'After' });
    expect(html).toContain('After');
  }, 30_000);
});
