import type { Meta, StoryObj } from '@storybook/react-vite';

import { Card, CardContent, CardHeader, CardTitle } from '../components/card/card';
import { ReachLogo, ReachMark, ReachWordmark } from './reach-logo';

const meta = {
  title: 'Foundations/Brand',
  component: ReachMark,
  parameters: {
    layout: 'padded',
    docs: {
      description: {
        component: [
          'A figure leaning forward, and the thing it is reaching for just beyond its fingertips. Read the other way it is a lowercase `r`, which is the point: one shape doing both jobs.',
          '',
          '### One stroke, and no corner in it',
          '',
          'The line rises, bends over the top and comes back down still leaning outward. It is a single cubic curve rather than an arc joined to a straight arm, because a join leaves a flat spot however smoothly it is made, and a flat spot at the top reads as a shoulder. A shoulder makes it a letter. Without one it stays a movement that happens to spell something.',
          '',
          '### The gap is the idea',
          '',
          'The reach has not landed. It is still going. That is the argument of the whole system in one shape: a control has to be reachable from wherever the person actually is, and the interesting part is the range rather than the destination.',
          '',
          'Doubling as a monogram is why a letterform beat geometry here. Plenty of products can use concentric rings. Almost none can use this particular `r`.',
          '',
          '### What it replaced, and why',
          '',
          'The first drawing was three nested rounded squares stepping outward by an equal interval, the way `36 → 44 → 52` does. It was a tidy idea and a bad mark. It read as a camera aperture, the open corner carrying the meaning disappeared below about 32px, and a set of rings says "target" when the word is "reach".',
          '',
          '### Built from the system’s own geometry',
          '',
          'The stroke weight is the icon stroke used everywhere else and the caps are round, because every other line here is round. Nothing in the mark is a shape the interface does not already contain.',
          '',
          '### Colour and contrast',
          '',
          '`currentColor` throughout, so the mark inherits and is correct on any surface in either theme without a second file. Put it in the accent with `text-accent`. There is no gradient version and there will not be one: the mark has to survive a fax, an embroidery machine and a 16px favicon.',
          '',
          '### Clear space',
          '',
          'Half the mark’s height on every side. The space in front of the target is the one that matters, because the room ahead of the dot is what makes it a reach rather than a full stop.',
        ].join('\n'),
      },
    },
  },
  argTypes: {
    compact: {
      description: 'Tightens the gap and enlarges the target for small sizes.',
      control: 'boolean',
      table: { type: { summary: 'boolean' }, category: 'Appearance' },
    },
    title: {
      description: 'Names the mark where it is the only thing identifying the product.',
      control: 'text',
      table: { type: { summary: 'string' }, category: 'Accessibility' },
    },
  },
  args: {},
} satisfies Meta<typeof ReachMark>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Logo: Story = {
  name: 'The lockup',
  render: () => (
    <Card>
      <CardHeader>
        <CardTitle>Reach UI</CardTitle>
      </CardHeader>
      <CardContent className="space-y-8">
        <ReachLogo showSubtitle className="text-fg" />
        <div className="flex flex-wrap items-center gap-10">
          <ReachLogo />
          <ReachLogo variant="mark" className="text-accent" />
          <ReachWordmark title="Reach UI" className="h-6 text-fg" />
        </div>
      </CardContent>
    </Card>
  ),
};

export const Sizes: Story = {
  name: 'At size',
  parameters: {
    docs: {
      description: {
        story:
          'The mark holds from 64px down to 20px. Below that, `compact` pulls the target in and grows it: at 16px the gap closes optically and the two shapes merge into one blob, which loses the only thing the mark is saying.',
      },
    },
  },
  render: () => (
    <Card>
      <CardHeader>
        <CardTitle>Scale</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="flex flex-wrap items-end gap-8 text-fg">
          {[
            { size: 'size-16', label: '64px' },
            { size: 'size-10', label: '40px' },
            { size: 'size-8', label: '32px' },
            { size: 'size-6', label: '24px' },
          ].map((entry) => (
            <div key={entry.label} className="flex flex-col items-center gap-2">
              <ReachMark className={entry.size} />
              <span className="text-2xs text-fg-subtle">{entry.label}</span>
            </div>
          ))}
          {[
            { size: 'size-5', label: '20px' },
            { size: 'size-4', label: '16px' },
          ].map((entry) => (
            <div key={entry.label} className="flex flex-col items-center gap-2">
              <ReachMark compact className={entry.size} />
              <span className="text-2xs text-fg-subtle">{entry.label}, compact</span>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  ),
};

export const OnSurfaces: Story = {
  name: 'On any surface',
  parameters: {
    docs: {
      description: {
        story:
          'One file. The mark takes its colour from whatever it sits in, so the light theme, the dark theme, the accent tile and a printed page are the same asset rather than four exports that drift apart.',
      },
    },
  },
  render: () => (
    <div className="flex flex-wrap gap-4">
      <div className="flex size-28 items-center justify-center rounded-xl border border-border bg-surface text-fg">
        <ReachMark className="size-12" />
      </div>
      <div className="flex size-28 items-center justify-center rounded-xl bg-fg text-surface">
        <ReachMark className="size-12" />
      </div>
      <div className="flex size-28 items-center justify-center rounded-xl bg-accent text-fg-on-accent">
        <ReachMark className="size-12" />
      </div>
      <div className="flex size-28 items-center justify-center rounded-xl border border-border bg-surface text-accent">
        <ReachMark className="size-12" />
      </div>
    </div>
  ),
};

export const Construction: Story = {
  parameters: {
    docs: {
      description: {
        story:
          'Drawn on the 24px icon grid the rest of the system uses. The stem stands on the baseline at the vertical sixth, and the target sits on the line the curve was travelling along when it ran out, so the eye reads one movement rather than a letter with something next to it.',
      },
    },
  },
  render: () => (
    <Card className="max-w-sm">
      <CardHeader>
        <CardTitle>Grid</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="relative size-48 text-accent">
          <svg viewBox="0 0 24 24" className="absolute inset-0 size-full" aria-hidden>
            <defs>
              <pattern id="reach-grid" width="2" height="2" patternUnits="userSpaceOnUse">
                <path
                  d="M2 0 V2 M0 2 H2"
                  className="stroke-border"
                  strokeWidth="0.08"
                  fill="none"
                />
              </pattern>
            </defs>
            <rect width="24" height="24" fill="url(#reach-grid)" />
            <circle
              cx="6"
              cy="12.5"
              r="6.5"
              className="stroke-border"
              strokeWidth="0.15"
              fill="none"
            />
          </svg>
          <ReachMark className="absolute inset-0 size-full" />
        </div>
      </CardContent>
    </Card>
  ),
};
