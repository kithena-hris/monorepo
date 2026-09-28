import type { Meta, StoryObj } from '@storybook/react-vite';

import { ReachLogo, ReachMark } from './reach-logo';

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
    tile: {
      description: 'The app mark: the glyph reversed out of an accent tile.',
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
  parameters: {
    docs: {
      description: {
        story:
          'The app mark and the word, set bold in the display face. The word follows the text colour and the tile stays accent, so one lockup serves both themes.',
      },
    },
  },
  render: () => (
    <div className="flex flex-col items-start gap-8">
      <ReachLogo size="lg" />
      <ReachLogo showSubtitle />
    </div>
  ),
};

export const Sizes: Story = {
  name: 'At size',
  parameters: {
    docs: {
      description: {
        story:
          'Three sizes, one lockup: `size="lg"`, `md` and `sm` put a 56, 32 and 20px mark beside the word in proportion. Below 20px use the app mark alone; the word stops being legible before the mark does.',
      },
    },
  },
  render: () => (
    <div className="flex flex-col items-start gap-5">
      <ReachLogo size="lg" />
      <ReachLogo size="md" />
      <ReachLogo size="sm" />
    </div>
  ),
};

/*
 * The four grounds the lockup is placed on, each with the tile tone and word
 * colour that belong on it. On the accent ground the tile turns light, since an
 * accent tile on an accent field is a hole in the page.
 */
const grounds = [
  {
    name: 'Background',
    ground: 'bg-canvas ring-1 ring-border ring-inset',
    word: 'text-fg',
    tone: 'accent',
  },
  {
    name: 'Surface',
    ground: 'bg-surface ring-1 ring-border ring-inset',
    word: 'text-fg',
    tone: 'accent',
  },
  { name: 'Accent', ground: 'bg-accent-solid', word: 'text-fg-on-accent', tone: 'light' },
  { name: 'Invert', ground: 'bg-invert', word: 'text-fg-on-invert', tone: 'accent' },
] as const;

export const OnSurfaces: Story = {
  name: 'On any surface',
  parameters: {
    docs: {
      description: {
        story:
          'The page, a card, the accent and the inverse. The word takes the text colour of whatever it sits on; the tile keeps the accent except on the accent itself, where it turns light and carries the accent in the glyph instead.',
      },
    },
  },
  render: () => (
    <div className="grid grid-cols-[repeat(auto-fill,minmax(min(100%,10rem),1fr))] gap-3">
      {grounds.map((entry) => (
        <div
          key={entry.name}
          className={`grid h-24 place-items-center rounded-md ${entry.ground}`}
          title={entry.name}
        >
          <ReachLogo size="sm" tone={entry.tone} className={entry.word} />
        </div>
      ))}
    </div>
  ),
};

export const Construction: Story = {
  parameters: {
    docs: {
      description: {
        story:
          'An 8 × 8 grid, a 9/32 corner radius and a 2.8 stroke. The glyph sits on the 24px icon grid inside the tile, the stem on the baseline at the vertical sixth and the target on the line the curve was travelling along when it ran out. The dashed line is the clear space: nothing comes inside it.',
      },
    },
  },
  render: () => (
    <div className="flex flex-col items-center gap-3">
      <div
        className="relative grid size-60 place-items-center rounded-md ring-1 ring-border ring-inset"
        style={{
          backgroundImage:
            'linear-gradient(var(--reach-color-border) 1px, transparent 1px), linear-gradient(90deg, var(--reach-color-border) 1px, transparent 1px)',
          backgroundSize: '30px 30px',
        }}
      >
        <ReachMark tile className="size-45" />
        <span
          aria-hidden
          className="absolute inset-[30px] rounded-[50px] border-[1.5px] border-dashed border-danger"
        />
      </div>
      <p className="text-sm text-fg-muted">
        8 × 8 grid, 9/32 corner radius, 2.8 stroke. The red line is the clear space.
      </p>
    </div>
  ),
};
