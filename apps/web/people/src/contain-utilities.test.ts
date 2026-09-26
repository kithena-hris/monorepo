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
