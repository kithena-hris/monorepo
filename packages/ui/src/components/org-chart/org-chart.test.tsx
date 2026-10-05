import { render } from '@testing-library/react';
import { beforeAll, describe, expect, it } from 'vitest';

beforeAll(() => {
  // jsdom lays nothing out and has no scrolling; the chart centres its root on mount.
  Element.prototype.scrollTo = () => undefined;
});

import { OrgChart, type OrgNode } from './org-chart';

/** A company `levels` deep, ten reports to every manager: 1, 10, 100, 1,000… */
function company(levels: number): OrgNode[] {
  const nodes: OrgNode[] = [{ id: 'n0', name: 'Person 0' }];
  let parents = ['n0'];
  for (let level = 1; level < levels; level += 1) {
    const next: string[] = [];
    for (const parent of parents) {
      for (let k = 0; k < 10; k += 1) {
        const id = `n${String(nodes.length)}`;
        nodes.push({ id, name: `Person ${String(nodes.length)}`, parentId: parent });
        next.push(id);
      }
    }
    parents = next;
  }
  return nodes;
}

const cards = (): number => document.querySelectorAll('[data-org-node]').length;

describe('OrgChart, opening', () => {
  it('opens a small company whole', () => {
    render(<OrgChart label="Org chart" nodes={company(2)} />);
    expect(cards()).toBe(11);
  });

  it('opens a large one with the levels that fit, its branches a press away', () => {
    render(<OrgChart label="Org chart" nodes={company(4)} />);
    // 1,111 people: the top two levels, 11 cards, rather than every one of them.
    expect(cards()).toBe(11);
  });

  it('opens as told when the caller says what is folded', () => {
    render(<OrgChart label="Org chart" nodes={company(3)} defaultCollapsed={[]} />);
    expect(cards()).toBe(111);
  });
});
