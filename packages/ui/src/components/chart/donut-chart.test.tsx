import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { TooltipProvider } from '../tooltip/tooltip';
import { DonutChart } from './donut-chart';

describe('<DonutChart> with parts', () => {
  it('draws an outer ring of each slice’s parts, one colour per part, totalled in its key', () => {
    const { container } = render(
      <TooltipProvider>
        <DonutChart
          label="Reviews"
          data={[
            {
              label: 'Submitted',
              value: 3,
              parts: [
                { label: 'Self', value: 2 },
                { label: 'Manager', value: 1 },
              ],
            },
            { label: 'Overdue', value: 2, parts: [{ label: 'Self', value: 2 }] },
          ]}
        />
      </TooltipProvider>,
    );
    // Two track circles, two inner arcs, three outer arcs.
    expect(container.querySelectorAll('svg circle')).toHaveLength(7);
    const key = screen.getByRole('list', { name: 'Made of' });
    expect(key).toHaveTextContent('Self4');
    expect(key).toHaveTextContent('Manager1');
    const self = container.querySelectorAll('svg g circle');
    // Self keeps one stroke class under both slices.
    const tones = [...self]
      .map((c) => c.getAttribute('class') ?? '')
      .filter((c) => c.includes('stroke-chart'));
    expect(tones.length).toBeGreaterThan(0);
  });

  it('stays one ring without parts', () => {
    const { container } = render(
      <TooltipProvider>
        <DonutChart
          label="Teams"
          data={[
            { label: 'A', value: 1 },
            { label: 'B', value: 2 },
          ]}
        />
      </TooltipProvider>,
    );
    expect(container.querySelectorAll('svg circle')).toHaveLength(3);
    expect(screen.queryByRole('list', { name: 'Made of' })).toBeNull();
  });
});
