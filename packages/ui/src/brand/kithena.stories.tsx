import type { Meta, StoryObj } from '@storybook/react-vite';
import type { JSX } from 'react';

import { Card, CardContent, CardHeader, CardTitle } from '../components/card/card';
import { KithenaLogo, KithenaMark, KithenaWordmark } from './kithena-logo';

const meta = {
  title: 'Foundations/Brand — Kithena',
  component: KithenaMark,
  parameters: {
    layout: 'padded',
    docs: {
      description: {
        component: [
          'Three rings, woven. Each one passes over one neighbour and under the other, alternating the whole way round, so no ring sits flat on top and none sits flat underneath. Reach is the design system; Kithena is the product built on it.',
          '',
          'This weave is the **Borromean rings**, and it has a property no other arrangement of three loops has: *no two of the rings are linked to each other*. Lift any one away and the remaining two fall apart, unlinked, because they never touched. Yet all three together cannot be separated. The whole is held by a relationship that exists between none of the pairs.',
          '',
          '### Why this, for this product',
          '',
          'It is the rule in `CLAUDE.md`, drawn.',
          '',
          'No module here may import another. A module reaches its neighbours through events and `packages/contracts`, never directly, and `.dependency-cruiser.cjs` fails the build if it tries. Every module has to boot alone and pass its acceptance suite with no siblings present. So: no two are linked. And yet the thing you sell is the suite, which is real, and which is held together by exactly nothing a dependency graph can show you.',
          '',
          'That is the Borromean property stated in TypeScript instead of in rope. The mark is not a metaphor for the architecture — it is the same fact in a different notation.',
          '',
          'The word carries it too. `Kith` is Old English for the people you belong among, the surviving half of *kith and kin*, and the half that is chosen rather than inherited. An organisation is not a shape you can point at. It is what holds when no two people in it are bound to each other by anything but the arrangement.',
          '',
          '### Why it is drawn hard',
          '',
          'The weave is the point, so the crossings cannot be faked. Each ring is cut into arcs and a gap of 0.30 radians is opened at every crossing where it passes underneath — six breaks in total, at coordinates derived from the actual circle-circle intersections rather than nudged by eye. Move a ring and every break has to be recomputed: the geometry is generated, not drawn.',
          '',
          'The stroke is 2.2 against the 2.6 the icon set uses. Anything heavier closes the six windows the weave opens, and the mark reverts to three overlapping circles — a different and much worse logo.',
          '',
          '### Where it stops working',
          '',
          'This is an intricate mark and it is honest to say so. It is at its best from 32px up. `compact` thickens the stroke to 2.8 and widens the breaks so the weave survives further down, but at 16px the windows close and it reads as a dense trefoil rather than three woven rings. A favicon is the worst case for anything with real detail in it, and this has more detail than most.',
          '',
          '### One colour only',
          '',
          'The mark may not be recoloured ring by ring. Three colours would say the three rings are three different things, and the whole argument is that they are identical and interchangeable — which of them is on top at any crossing is an accident of drawing, not a statement about rank.',
          '',
          '### Contrast',
          '',
          'The mark carries meaning rather than decorating, so it is held to WCAG 1.4.11 at 3:1 against its background rather than to a text ratio. `currentColor` means it is correct wherever the surrounding text already is. The six breaks are background showing through, so they inherit the surface and need no ratio of their own.',
        ].join('\n'),
      },
    },
  },
  argTypes: {
    compact: {
      description: 'Thickens the stroke and widens the six breaks for small sizes.',
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
} satisfies Meta<typeof KithenaMark>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Logo: Story = {
  name: 'The lockup',
  render: () => (
    <Card>
      <CardHeader>
        <CardTitle>Kithena</CardTitle>
      </CardHeader>
      <CardContent className="space-y-8">
        <KithenaLogo showSubtitle className="text-fg" />
        <div className="flex flex-wrap items-center gap-10">
          <KithenaLogo />
          <KithenaLogo variant="mark" className="text-accent" />
          <KithenaWordmark title="Kithena" className="h-6 text-fg" />
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
          'The weave is at its best from 32px up. `compact` thickens the stroke and widens the six breaks so it survives further down, but at 16px the windows close and the mark reads as a dense trefoil rather than three woven rings. This is the honest weak point of an intricate mark, and worth knowing before it goes on a browser tab.',
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
              <KithenaMark className={entry.size} />
              <span className="text-2xs text-fg-subtle">{entry.label}</span>
            </div>
          ))}
          {[
            { size: 'size-5', label: '20px' },
            { size: 'size-4', label: '16px' },
          ].map((entry) => (
            <div key={entry.label} className="flex flex-col items-center gap-2">
              <KithenaMark compact className={entry.size} />
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
          'One file. The mark takes its colour from whatever it sits in, so the light theme, the dark theme, the accent tile and a printed page are the same asset rather than four exports that drift apart. The weave reads in either polarity, because the breaks are gaps in the stroke rather than a second colour laid on top.',
      },
    },
  },
  render: () => (
    <div className="flex flex-wrap gap-4">
      <div className="flex size-28 items-center justify-center rounded-xl border border-border bg-surface text-fg">
        <KithenaMark className="size-12" />
      </div>
      <div className="flex size-28 items-center justify-center rounded-xl bg-fg text-surface">
        <KithenaMark className="size-12" />
      </div>
      <div className="flex size-28 items-center justify-center rounded-xl bg-accent text-fg-on-accent">
        <KithenaMark className="size-12" />
      </div>
      <div className="flex size-28 items-center justify-center rounded-xl border border-border bg-surface text-accent">
        <KithenaMark className="size-12" />
      </div>
    </div>
  ),
};

export const Construction: Story = {
  parameters: {
    docs: {
      description: {
        story:
          'Three circles of radius 7, centred 4.3 from the middle of the box at -90°, 30° and 150°. The dashed circles are those three paths complete; the mark is what is left after 0.30 radians is removed at each of the six crossings where a ring passes underneath. Those cut points are computed from the circle-circle intersections, so moving any ring invalidates all six paths at once.',
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
              <pattern id="kithena-grid" width="2" height="2" patternUnits="userSpaceOnUse">
                <path
                  d="M2 0 V2 M0 2 H2"
                  className="stroke-border"
                  strokeWidth="0.08"
                  fill="none"
                />
              </pattern>
            </defs>
            <rect width="24" height="24" fill="url(#kithena-grid)" />
            {/* The three rings, whole, before the crossings are cut. */}
            {[
              [12, 7.7],
              [15.72, 14.15],
              [8.28, 14.15],
            ].map(([cx, cy]) => (
              <circle
                key={`${String(cx)}-${String(cy)}`}
                cx={cx}
                cy={cy}
                r="7"
                className="stroke-border"
                strokeWidth="0.14"
                strokeDasharray="0.5 0.5"
                fill="none"
              />
            ))}
          </svg>
          <KithenaMark className="absolute inset-0 size-full" />
        </div>
      </CardContent>
    </Card>
  ),
};

function Reject({ children, label }: { children: JSX.Element; label: string }): JSX.Element {
  return (
    <div className="flex flex-col items-center gap-2">
      {children}
      <span className="max-w-32 text-center text-2xs">{label}</span>
    </div>
  );
}

const strokeProps = {
  viewBox: '0 0 24 24',
  className: 'size-16',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 2.5,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
  'aria-hidden': true,
} as const;

export const Rejected: Story = {
  name: 'What it replaced',
  parameters: {
    docs: {
      description: {
        story: [
          'Seven drawings that did not survive, kept so nobody spends a week rediscovering them.',
          '',
          '- **The monogram.** A `K` with its limbs detached from the stem. It reads, and it is a mark about a name rather than about people.',
          '- **The handshake as the `K`’s junction.** The clasp doubling as the one point every `K` must have. Clever, and still a monogram.',
          '- **Two figures shaking hands.** Warm, legible, and the single most-worn gesture in business identity.',
          '- **Linked arms.** The closest of the figurative attempts, and still a pictogram of people rather than an idea about them.',
          '- **The trefoil.** Three leaves turned about a centre. Reads as a clover.',
          '- **The cradle.** Two arcs holding a dot. Reads as a camera aperture — which is exactly why the first Reach mark was scrapped.',
          '- **The Kanizsa square.** Four discs, each missing a quarter, implying a square nobody drew. A good idea and a plain-looking object: at any size you actually ship it at, it is four dots.',
          '',
          'Three further families were abandoned before they were worth drawing twice: segmented rings, which read as a loading spinner at every size; interlace and knots, which merge into a solid blob at icon stroke weights; and stacked bars, which read as a hamburger menu.',
        ].join('\n'),
      },
    },
  },
  render: () => (
    <div className="flex flex-wrap items-end gap-8 text-fg-subtle">
      <Reject label="Detached-limb K">
        <svg {...strokeProps} strokeWidth={2.6}>
          <path d="M6.6 4 V20" />
          <path d="M17.4 7.4 L10.9 13.7 L17.8 20" />
        </svg>
      </Reject>
      <Reject label="Handshake as the K's junction">
        <svg {...strokeProps} strokeWidth={2.4}>
          <path d="M5.8 8.8 V20" />
          <path d="M5.8 13.2 C8 14.6 9 15 10.2 14.9" />
          <path d="M16.2 8.6 C13.8 11.2 13.4 13.4 12.8 14.4" />
          <path d="M12.6 15.7 L17.4 20" />
          <circle cx="5.8" cy="5.4" r="2.05" fill="currentColor" stroke="none" />
          <circle cx="17.6" cy="6.2" r="2.05" fill="currentColor" stroke="none" />
          <circle cx="11.5" cy="14.6" r="1.9" fill="currentColor" stroke="none" />
        </svg>
      </Reject>
      <Reject label="Two figures shaking hands">
        <svg {...strokeProps} strokeWidth={2.4}>
          <path d="M4.8 19.6 C4.8 14.2 5.6 11.4 6.8 10.2" />
          <path d="M5.7 13.4 C7.7 14.1 9.2 14.4 10.4 14.5" />
          <path d="M19.2 19.6 C19.2 14.2 18.4 11.4 17.2 10.2" />
          <path d="M18.3 13.4 C16.3 14.1 14.8 14.4 13.6 14.5" />
          <circle cx="7.6" cy="7" r="2.05" fill="currentColor" stroke="none" />
          <circle cx="16.4" cy="7" r="2.05" fill="currentColor" stroke="none" />
          <circle cx="12" cy="14.5" r="1.75" fill="currentColor" stroke="none" />
        </svg>
      </Reject>
      <Reject label="Linked arms">
        <svg {...strokeProps}>
          <path d="M5.6 20 V12 C5.6 16 8.8 17.3 12 17.3 C15.2 17.3 18.4 16 18.4 12 V20" />
          <circle cx="5.6" cy="7.6" r="2.3" fill="currentColor" stroke="none" />
          <circle cx="18.4" cy="7.6" r="2.3" fill="currentColor" stroke="none" />
        </svg>
      </Reject>
      <Reject label="Trefoil">
        <svg {...strokeProps} strokeWidth={2.3}>
          <path d="M12 9.6 Q7.2 7.6 12 3 Q16.8 7.6 12 9.6" />
          <path d="M12 9.6 Q7.2 7.6 12 3 Q16.8 7.6 12 9.6" transform="rotate(120 12 12)" />
          <path d="M12 9.6 Q7.2 7.6 12 3 Q16.8 7.6 12 9.6" transform="rotate(240 12 12)" />
        </svg>
      </Reject>
      <Reject label="Cradle">
        <svg {...strokeProps} strokeWidth={2.6}>
          <path d="M9.8 4.8 C5.2 6.2 4 9.2 4 12 C4 14.8 5.2 17.8 9.8 19.2" />
          <path d="M14.2 4.8 C18.8 6.2 20 9.2 20 12 C20 14.8 18.8 17.8 14.2 19.2" />
          <circle cx="12" cy="12" r="2.2" fill="currentColor" stroke="none" />
        </svg>
      </Reject>
      <Reject label="Kanizsa square">
        <svg viewBox="0 0 24 24" className="size-16" fill="currentColor" aria-hidden>
          <path d="M16.95 7.05 L17.16 11.04 A4 4 0 1 0 12.96 6.84 Z" />
          <path d="M16.95 16.95 L12.96 17.16 A4 4 0 1 0 17.16 12.96 Z" />
          <path d="M7.05 16.95 L6.84 12.96 A4 4 0 1 0 11.04 17.16 Z" />
          <path d="M7.05 7.05 L11.04 6.84 A4 4 0 1 0 6.84 11.04 Z" />
        </svg>
      </Reject>
      <Reject label="Kept">
        <KithenaMark className="size-16 text-accent" />
      </Reject>
    </div>
  ),
};
