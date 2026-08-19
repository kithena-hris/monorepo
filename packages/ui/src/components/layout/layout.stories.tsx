import type { Meta, StoryObj } from '@storybook/react-vite';
import type { JSX, ReactNode } from 'react';

import { Button } from '../button/button';
import { Card } from '../card/card';
import { AutoGrid, Container, Inline, Split, Stack } from './layout';

const meta = {
  title: 'Components/Layout',
  component: AutoGrid,
  parameters: {
    layout: 'fullscreen',
    docs: {
      description: {
        component: [
          'Spacing and flow primitives: `Stack`, `Inline`, `AutoGrid`, `Container`, `Split`.',
          '',
          '### Why these exist',
          '',
          'So that spacing is a token rather than a number someone typed, and so the four responsive behaviours every screen needs are one prop instead of four breakpoint classes copied between files.',
          '',
          '### The rule they encode: ask the container, not the window',
          '',
          '`AutoGrid` is the important one. `repeat(auto-fit, minmax(min(<w>, 100%), 1fr))` reflows on the width of the *container*, so the same component gives four cards on a desktop, two on an iPad, one on an iPhone and two in a 4K sidebar, without anyone enumerating those cases, and without a `md:grid-cols-3` that is wrong the moment the component is dropped into a narrower column.',
          '',
          'The `min(<w>, 100%)` is not decoration: bare `minmax(20rem, 1fr)` overflows a 16rem container and produces a horizontal scrollbar on a phone. That is the single most common auto-fit bug.',
          '',
          '### Where the tokens come from',
          '',
          '`gap` values are the 4px rhythm the rest of the system uses. Every accepted value is written out in a lookup rather than interpolated, because Tailwind scans source text for complete class names and `gap-${n}` compiles to nothing.',
        ].join('\n'),
      },
    },
  },
  argTypes: {
    minItemWidth: {
      description:
        'The narrowest a column may get before the grid drops one. Any CSS length. Wrapped in `min(…, 100%)` internally.',
      control: 'text',
      table: {
        type: { summary: 'string' },
        defaultValue: { summary: '16rem' },
        category: 'Layout',
      },
    },
    gap: {
      description: 'Spacing step on the 4px rhythm.',
      control: 'select',
      options: [0, 1, 2, 3, 4, 5, 6, 8, 10, 12],
      table: {
        type: { summary: '0 | 1 | 2 | 3 | 4 | 5 | 6 | 8 | 10 | 12' },
        defaultValue: { summary: '4' },
        category: 'Layout',
      },
    },
    className: {
      control: 'text',
      table: { type: { summary: 'string' }, category: 'Escape hatches' },
    },
  },
  args: { minItemWidth: '16rem', gap: 4 },
} satisfies Meta<typeof AutoGrid>;

export default meta;
type Story = StoryObj<typeof meta>;

function Tile({ children }: { children: ReactNode }): JSX.Element {
  return (
    <Card padded className="text-sm text-fg-muted">
      {children}
    </Card>
  );
}

export const AutoGridPlayground: Story = {
  name: 'AutoGrid',
  parameters: {
    docs: {
      description: {
        story:
          'Change `minItemWidth` and resize the canvas. There is not a single breakpoint in this story, the column count is a consequence of the container width and the minimum, computed by the browser.',
      },
    },
  },
  render: (args) => (
    <div className="bg-canvas p-6">
      <AutoGrid {...args}>
        {['Platform', 'Payroll', 'People Ops', 'Support', 'Finance', 'Legal'].map((team) => (
          <Tile key={team}>{team}</Tile>
        ))}
      </AutoGrid>
    </div>
  ),
};

export const AutoGridInThreeContainers: Story = {
  name: 'The same AutoGrid in three containers',
  parameters: {
    docs: {
      description: {
        story:
          'One component, three container widths, one viewport. A breakpoint-based grid would render identically in all three, because the *window* has not changed, which is exactly the bug this avoids.',
      },
    },
  },
  render: (args) => (
    <div className="space-y-6 bg-canvas p-6">
      {(['20rem', '44rem', '100%'] as const).map((width) => (
        <div key={width} style={{ maxWidth: width }}>
          <p className="mb-2 text-2xs font-semibold tracking-wide text-fg-subtle uppercase">
            Container {width}
          </p>
          <AutoGrid {...args}>
            {['Platform', 'Payroll', 'People Ops', 'Support'].map((team) => (
              <Tile key={team}>{team}</Tile>
            ))}
          </AutoGrid>
        </div>
      ))}
    </div>
  ),
};

export const StackAndInline: Story = {
  name: 'Stack and Inline',
  parameters: {
    docs: {
      description: {
        story:
          '`Inline` wraps by default, a row of filter chips that cannot wrap is a row that clips on a phone, and `collapseBelow` turns it into a stack at a chosen width. Narrow the canvas past 640px and the action group below becomes three full-width buttons.',
      },
    },
  },
  render: () => (
    <div className="space-y-8 bg-canvas p-6">
      <Stack gap={2}>
        <p className="text-2xs font-semibold tracking-wide text-fg-subtle uppercase">
          Stack, gap 2
        </p>
        <Tile>First</Tile>
        <Tile>Second</Tile>
        <Tile>Third</Tile>
      </Stack>

      <Stack gap={2}>
        <p className="text-2xs font-semibold tracking-wide text-fg-subtle uppercase">
          Inline, wrapping
        </p>
        <Inline gap={2}>
          {['Active', 'On leave', 'Offboarding', 'Contractor', 'Probation', 'Notice period'].map(
            (chip) => (
              <span
                key={chip}
                className="rounded-full border border-border bg-surface px-3 py-1 text-sm text-fg-muted"
              >
                {chip}
              </span>
            ),
          )}
        </Inline>
      </Stack>

      <Stack gap={2}>
        <p className="text-2xs font-semibold tracking-wide text-fg-subtle uppercase">
          Inline, collapsing below sm
        </p>
        <Inline gap={2} collapseBelow="sm" justify="end">
          <Button>Cancel</Button>
          <Button>Save draft</Button>
          <Button variant="primary">Submit for approval</Button>
        </Inline>
      </Stack>
    </div>
  ),
};

export const SplitLayout: Story = {
  name: 'Split',
  parameters: {
    docs: {
      description: {
        story:
          "Main content plus a detail rail that becomes a stacked block below `stackBelow`. The main track is `minmax(0, 1fr)` and not `1fr`: a grid track's default minimum is `auto`, so one wide table inside it would stop the pane from ever shrinking, a horizontal scrollbar on the whole page instead of on the table.",
      },
    },
  },
  render: () => (
    <div className="bg-canvas p-6">
      <Split
        stackBelow="lg"
        aside={
          <Stack gap={3}>
            <Tile>Approval queue</Tile>
            <Tile>Recent changes</Tile>
          </Stack>
        }
      >
        <Stack gap={3}>
          <Tile>
            Main column. Resize past 1024px and the rail moves underneath rather than squeezing to
            an unusable width.
          </Tile>
          <Tile>Second block</Tile>
        </Stack>
      </Split>
    </div>
  ),
};

export const ContainerSizes: Story = {
  name: 'Container',
  parameters: {
    docs: {
      description: {
        story:
          'A centred measure with responsive gutters. The horizontal padding is `max(1rem, env(safe-area-inset-left))`, so on a landscape iPhone the content clears the notch instead of hiding under it, the one safe-area case people forget, because in portrait the insets are vertical.',
      },
    },
  },
  render: () => (
    <div className="space-y-4 bg-canvas py-6">
      {(['sm', 'md', 'lg', 'xl'] as const).map((size) => (
        <Container key={size} size={size}>
          <Tile>Container size {size}</Tile>
        </Container>
      ))}
    </div>
  ),
};

/**
 * Every flex option `Stack` and `Inline` expose, rendered side by side.
 *
 * These are the props people otherwise reach past the system for, writing
 * `flex items-baseline justify-between` by hand and losing the gap token on the
 * way. Seeing the whole set in one place is usually enough to stop that.
 */
/** Local presentation helpers for the flex-options story. */
function Label({ children }: { children: ReactNode }): JSX.Element {
  return <p className="mb-1 font-mono text-2xs text-accent-fg">{children}</p>;
}

function Swatch({
  children,
  className,
}: {
  children?: ReactNode;
  className?: string;
}): JSX.Element {
  return (
    <span
      className={`inline-flex min-w-10 items-center justify-center rounded-sm bg-accent-solid px-2 text-2xs text-fg-on-solid ${className ?? 'h-8'}`}
    >
      {children}
    </span>
  );
}

function Demo({
  title,
  hint,
  children,
}: {
  title: string;
  hint: string;
  children: ReactNode;
}): JSX.Element {
  return (
    <section aria-label={title}>
      <h3 className="font-mono text-sm font-semibold text-fg">{title}</h3>
      <p className="mt-1 mb-3 max-w-2xl text-xs text-fg-subtle">{hint}</p>
      {children}
    </section>
  );
}

export const FlexOptions: Story = {
  name: 'Flex options',
  parameters: {
    layout: 'padded',
    docs: {
      description: {
        story:
          '`gap` is a spacing token rather than a number, so rows stay on the same rhythm as everything else. `align` maps to `align-items` and `justify` to `justify-content`; `Inline` adds `wrap` and `collapseBelow`. `as` changes the element without changing the layout, which is how a `Stack` becomes a `<ul>` without losing its semantics.',
      },
    },
  },
  render: () => (
    <Stack gap={8}>
      <Demo title="gap" hint="The 4px rhythm, as tokens. 0, 1, 2, 3, 4, 5, 6, 8, 10 and 12.">
        <Stack gap={3}>
          {([1, 2, 4, 6] as const).map((gap) => (
            <div key={gap}>
              <Label>gap={gap}</Label>
              <Inline gap={gap}>
                <Swatch />
                <Swatch />
                <Swatch />
              </Inline>
            </div>
          ))}
        </Stack>
      </Demo>

      <Demo title="align" hint="align-items, across the cross axis of an Inline.">
        <Stack gap={3}>
          {(['start', 'center', 'end', 'stretch', 'baseline'] as const).map((align) => (
            <div key={align}>
              <Label>align=&quot;{align}&quot;</Label>
              <Inline gap={2} align={align} className="h-20 rounded-md bg-surface-sunken p-2">
                <Swatch className="h-6">sm</Swatch>
                <Swatch className="h-12">md</Swatch>
                <Swatch className="h-8">lg</Swatch>
              </Inline>
            </div>
          ))}
        </Stack>
      </Demo>

      <Demo title="justify" hint="justify-content, along the main axis.">
        <Stack gap={3}>
          {(['start', 'center', 'end', 'between', 'around'] as const).map((justify) => (
            <div key={justify}>
              <Label>justify=&quot;{justify}&quot;</Label>
              <Inline gap={2} justify={justify} className="rounded-md bg-surface-sunken p-2">
                <Swatch />
                <Swatch />
                <Swatch />
              </Inline>
            </div>
          ))}
        </Stack>
      </Demo>

      <Demo
        title="wrap"
        hint="On by default. Turning it off is for a row that must stay one line, such as a toolbar that scrolls."
      >
        <Stack gap={3}>
          <div>
            <Label>wrap (default)</Label>
            <Inline gap={2} className="max-w-sm rounded-md bg-surface-sunken p-2">
              {Array.from({ length: 8 }, (_, i) => (
                <Swatch key={i}>{i + 1}</Swatch>
              ))}
            </Inline>
          </div>
          <div>
            <Label>wrap={'{false}'}</Label>
            <Inline
              gap={2}
              wrap={false}
              className="max-w-sm overflow-x-auto rounded-md bg-surface-sunken p-2"
            >
              {Array.from({ length: 8 }, (_, i) => (
                <Swatch key={i}>{i + 1}</Swatch>
              ))}
            </Inline>
          </div>
        </Stack>
      </Demo>

      <Demo
        title="collapseBelow"
        hint="Becomes a stack under the named breakpoint. Narrow the canvas to see it. Items also stretch, because a half-width button in a column reads as a mistake."
      >
        <Stack gap={3}>
          {(['xs', 'sm', 'md'] as const).map((at) => (
            <div key={at}>
              <Label>collapseBelow=&quot;{at}&quot;</Label>
              <Inline gap={2} collapseBelow={at}>
                <Button>Cancel</Button>
                <Button>Save draft</Button>
                <Button variant="primary">Submit</Button>
              </Inline>
            </div>
          ))}
        </Stack>
      </Demo>

      <Demo
        title="as"
        hint="Changes the element, not the layout. A list of things should be a list."
      >
        <Stack gap={2} as="ul">
          <li className="rounded-md border border-border bg-surface px-3 py-2 text-sm text-fg-muted">
            Renders inside a real &lt;ul&gt;
          </li>
          <li className="rounded-md border border-border bg-surface px-3 py-2 text-sm text-fg-muted">
            so a screen reader announces the count
          </li>
        </Stack>
      </Demo>
    </Stack>
  ),
};
