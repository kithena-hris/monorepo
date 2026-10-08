import { describe, expect, it } from 'vitest';

import { orgTree, type OrgNode, type OrgPerson } from './org';

const p = (id: string, managerId: string | null): OrgPerson => ({
  id,
  name: id,
  title: null,
  managerId,
});
const shape = (n: OrgNode): unknown => [n.person.id, n.reports.map(shape)];

describe('orgTree', () => {
  it('puts everybody under their manager', () => {
    const tree = orgTree([p('nora', null), p('marco', 'nora'), p('adam', 'marco')]);
    expect(tree.map(shape)).toEqual([['nora', [['marco', [['adam', []]]]]]]);
  });

  it('starts a tree for somebody whose manager is not listed', () => {
    expect(orgTree([p('adam', 'hidden')]).map(shape)).toEqual([['adam', []]]);
  });

  it('draws a cycle once instead of forever, and loses nobody in it', () => {
    const tree = orgTree([p('a', 'b'), p('b', 'a')]);
    expect(tree.map(shape)).toEqual([['a', [['b', []]]]]);
  });
});
