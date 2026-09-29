import { describe, expect, it } from 'vitest';

import { REMOTE_SCOPE, containUtilities } from './contain-utilities';

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
});
