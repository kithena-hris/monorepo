import { describe, expect, it } from 'vitest';

import { REMOTE_SCOPE, containUtilities, isPlainUtility } from './contain-utilities';

type Fake = { type: string; name?: string; params?: string; parent?: Fake; selectors: string[] };

const layer = (params: string): Fake => ({ type: 'atrule', name: 'layer', params, selectors: [] });
const rule = (selectors: string[], parent: Fake): Fake => ({ type: 'rule', parent, selectors });

describe('containUtilities', () => {
  const { Rule } = containUtilities();

  it('limits a utility, and one under a media query, to the remote and the portals', () => {
    const utilities = layer('utilities');
    const hidden = rule(['.hidden'], utilities);
    const media = {
      type: 'atrule',
      name: 'media',
      params: '(min-width:48rem)',
      parent: utilities,
      selectors: [],
    };
    const flex = rule(['.md\\:flex', '.x'], media);
    Rule(hidden);
    Rule(flex);
    expect(hidden.selectors).toEqual([`${REMOTE_SCOPE} .hidden`]);
    expect(flex.selectors).toEqual([`${REMOTE_SCOPE} .md\\:flex`, `${REMOTE_SCOPE} .x`]);
  });

  it('reaches the remote and the portals, and never the host’s page, with or without the remote on it', () => {
    const matches = (html: string): boolean => {
      document.body.innerHTML = html;
      return document.querySelector('[data-t]')?.matches(`${REMOTE_SCOPE} [data-t]`) ?? false;
    };
    // The host's own sidebar, while a People screen is showing and after leaving it.
    expect(matches('<div data-remote-host><nav data-t></nav><div data-remote></div></div>')).toBe(
      false,
    );
    expect(matches('<div data-remote-host><nav data-t></nav></div>')).toBe(false);
    // The screen, and a menu it portalled to the body.
    expect(matches('<div data-remote-host><div data-remote><p data-t></p></div></div>')).toBe(true);
    expect(matches('<div data-remote-host></div><div><p data-t></p></div>')).toBe(true);
    // A host that marks only the screen keeps the old rule.
    expect(matches('<div><nav data-t></nav><div data-remote></div></div>')).toBe(false);
  });

  it('leaves the theme, the base layer and nested rules alone, and scopes once', () => {
    const theme = rule([':root'], layer('theme'));
    const base = rule(['*'], layer('base'));
    const outer = rule(['.a'], layer('utilities'));
    const nested = rule(['&:hover'], outer);
    for (const r of [theme, base, nested, outer, outer]) Rule(r);
    expect(theme.selectors).toEqual([':root']);
    expect(base.selectors).toEqual(['*']);
    expect(nested.selectors).toEqual(['&:hover']);
    expect(outer.selectors).toEqual([`${REMOTE_SCOPE} .a`]);
  });

  it('tells a plain utility from a variant, so only the plain ones step down a layer', () => {
    const decl = { type: 'decl' };
    const media = { type: 'atrule', name: 'media' };
    const plain = (selector: string, nodes: readonly { type: string }[] = [decl]): boolean =>
      isPlainUtility({ type: 'rule', selector, selectors: [selector], nodes });
    expect(plain('.text-sm')).toBe(true);
    expect(plain(`${REMOTE_SCOPE} .min-h-9\\.5`)).toBe(true);
    expect(plain('.w-1\\/2')).toBe(true);
    // A variant nests its condition, or adds to the selector.
    expect(plain('.touch\\:text-md', [media])).toBe(false);
    expect(plain('.\\[\\&_svg\\]\\:size-5 svg')).toBe(false);
    expect(plain('.hover\\:underline:hover')).toBe(false);
    expect(plain(':where(.space-y-2>:not(:last-child))')).toBe(false);
  });

  it('moves the plain utilities into a sublayer of utilities, in order, and leaves the rest', () => {
    const appended: unknown[][] = [];
    class AtRule {
      readonly type = 'atrule';
      readonly nodes: unknown[] = [];
      readonly props: { name: string; params: string };
      constructor(props: { name: string; params: string }) {
        this.props = props;
      }
      append(...nodes: unknown[]): void {
        appended.push(nodes);
        this.nodes.push(...nodes);
      }
    }
    const decl = { type: 'decl' };
    const a = { type: 'rule', selector: '.text-sm', selectors: ['.text-sm'], nodes: [decl] };
    const v = {
      type: 'rule',
      selector: '.touch\\:x',
      selectors: ['.touch\\:x'],
      nodes: [{ type: 'atrule' }],
    };
    const b = { type: 'rule', selector: '.flex', selectors: ['.flex'], nodes: [decl] };
    const utilities = {
      type: 'atrule',
      name: 'layer',
      params: 'utilities',
      nodes: [a, v, b],
      append: (...nodes: unknown[]) => appended.push(nodes),
    };
    const theme = { type: 'atrule', name: 'layer', params: 'theme', nodes: [a], append: () => 0 };
    containUtilities().OnceExit(
      { type: 'root', nodes: [theme, utilities], append: () => 0 },
      { AtRule: AtRule as never },
    );
    // The sublayer took the two plain ones in order; it went into utilities.
    expect(appended).toHaveLength(2);
    expect(appended[0]).toEqual([a, b]);
    const [sublayer] = appended[1] ?? [];
    expect((sublayer as AtRule).props).toEqual({ name: 'layer', params: 'remote' });
  });
});
