import type { Meta, StoryObj } from '@storybook/react-vite';
import { Image } from 'lucide-react';
import type { JSX } from 'react';

import { Card } from '../card/card';
import { Carousel } from './carousel';

const meta: Meta = {
  title: 'Components/Carousel',
  component: Carousel,
  parameters: {
    layout: 'padded',
    docs: {
      description: {
        component: [
          'A few equal items side by side, scrolled or swiped to see more. The next item always peeks in from the edge.',
          '',
          'The track is CSS scroll-snap, so a swipe and a trackpad move it with the platform’s own physics. Arrow buttons for a pointer, swipe for a finger, and ← → when the track has focus. It never auto-plays.',
          '',
          'APG carousel semantics: a named region with `aria-roledescription="carousel"`, and each slide a group, "2 of 4".',
        ].join('\n'),
      },
    },
  },
};

export default meta;
type Story = StoryObj;

// Washes of the chart colours, standing in for photographs.
const wash = {
  2: 'bg-chart-2/55',
  3: 'bg-chart-3/55',
  4: 'bg-chart-4/55',
  5: 'bg-chart-5/55',
  6: 'bg-chart-6/55',
} as const;

function Slide({
  tone,
  title,
  note,
}: {
  tone: keyof typeof wash;
  title: string;
  note: string;
}): JSX.Element {
  return (
    <Card className="overflow-hidden border-0 shadow-sm touch:rounded-xl">
      <div aria-hidden className={`grid h-30 place-items-center text-fg ${wash[tone]}`}>
        <Image className="size-7" />
      </div>
      <div className="p-3.5">
        <p className="text-base font-semibold text-fg">{title}</p>
        <p className="text-sm text-fg-muted">{note}</p>
      </div>
    </Card>
  );
}

export const CardsThatPeek: Story = {
  render: () => (
    <Carousel label="Events" controls="none">
      <Slide tone={2} title="Team offsite" note="Lisbon · 12 Nov" />
      <Slide tone={3} title="Benefits fair" note="Berlin · 20 Nov" />
      <Slide tone={5} title="Training week" note="Online · Dec" />
      <Slide tone={4} title="Winter party" note="All offices" />
    </Carousel>
  ),
};

/** One slide at a time, with dots to jump between them. */
export const HeroWithDots: Story = {
  render: () => (
    <Carousel label="Getting started" controls="dots" itemClassName="w-full">
      {[
        ['Welcome, Lucas', 'Three things to do in your first week'],
        ['Meet your team', 'Eight people, two offices'],
        ['Set up payday', 'Add your bank details by Friday'],
      ].map(([title, note]) => (
        <div
          key={title}
          className="flex h-55 flex-col justify-end gap-1.5 rounded-lg bg-accent-solid p-5 text-fg-on-accent touch:h-50 touch:rounded-xl"
        >
          <p className="font-display text-xl font-bold">{title}</p>
          <p className="text-sm">{note}</p>
        </div>
      ))}
    </Carousel>
  ),
};

/** A heading with the arrows beside it. The first arrow is off until there is somewhere to go back to. */
export const WithControls: Story = {
  render: () => (
    <Carousel label="Upcoming" title="Upcoming" itemClassName="w-50 touch:w-[78%]">
      <Slide tone={2} title="Payday" note="31 Oct" />
      <Slide tone={6} title="Reviews open" note="4 Nov" />
      <Slide tone={3} title="Holiday" note="25 Dec" />
      <Slide tone={4} title="Winter party" note="All offices" />
      <Slide tone={5} title="Training week" note="Online · Dec" />
    </Carousel>
  ),
};
