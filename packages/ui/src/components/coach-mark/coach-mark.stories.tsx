import type { Meta, StoryObj } from '@storybook/react-vite';
import { Download, Network } from 'lucide-react';
import { useState } from 'react';

import { Button } from '../button/button';
import { Card } from '../card/card';
import { CoachMark, CoachMarkDot } from './coach-mark';

const meta = {
  title: 'Components/Coach mark',
  component: CoachMark,
  parameters: {
    layout: 'padded',
    docs: {
      description: {
        component: [
          'Introduces one new feature, pointing at the actual control. Use it sparingly, and never for things a good label could explain.',
          '',
          'Wrap the control: the callout anchors to it, and `spotlight` rings it and dims the rest of the page. For something that only needs noticing, `CoachMarkDot` is a quieter mark on the control itself.',
        ].join('\n'),
      },
    },
  },
  argTypes: {
    spotlight: { control: 'boolean', table: { category: 'Appearance' } },
    step: { control: 'number', table: { category: 'Tour' } },
    total: { control: 'number', table: { category: 'Tour' } },
    side: {
      control: 'inline-radio',
      options: ['top', 'right', 'bottom', 'left'],
      table: { defaultValue: { summary: 'bottom' }, category: 'Placement' },
    },
  },
  args: {
    title: 'Export the org chart',
    description: 'Download it as a PDF or PNG, or print it for the wall.',
    children: null,
    spotlight: true,
    step: 1,
    total: 3,
  },
} satisfies Meta<typeof CoachMark>;

export default meta;
type Story = StoryObj<typeof meta>;

const steps = [
  ['Export the org chart', 'Download it as a PDF or PNG, or print it for the wall.'],
  ['Filter by team', 'Show one department at a time, with its managers kept in view.'],
  ['Share a link', 'Anyone in the company can open the chart you’re looking at.'],
] as const;

export const Spotlight: Story = {
  render: function SpotlightStory(args) {
    const [step, setStep] = useState(0);
    const [open, setOpen] = useState(true);
    const [title, description] = steps[step] ?? steps[0];
    return (
      // The stage clips the scrim to the story, as a page's own edge would.
      <div className="relative isolate grid h-90 place-items-center overflow-hidden rounded-lg bg-canvas shadow-[inset_0_0_0_1px_var(--color-border)]">
        <CoachMark
          {...args}
          title={title}
          description={description}
          step={step + 1}
          total={steps.length}
          open={open}
          onOpenChange={setOpen}
          side="bottom"
          onSkip={() => undefined}
          {...(step < steps.length - 1
            ? {
                onNext: () => {
                  setStep(step + 1);
                },
              }
            : {})}
        >
          <Button startIcon={<Download aria-hidden="true" />}>Export</Button>
        </CoachMark>
        {open ? null : (
          <Button
            variant="link"
            onClick={() => {
              setStep(0);
              setOpen(true);
            }}
            className="absolute bottom-4"
          >
            Replay the tour
          </Button>
        )}
      </div>
    );
  },
};

export const ANewFeatureDot: Story = {
  name: 'A new-feature dot',
  render: () => (
    <div className="flex flex-wrap items-center gap-3.5">
      <Button variant="ghost" startIcon={<Network aria-hidden="true" />}>
        Org chart
        <CoachMarkDot />
      </Button>
      <p className="text-sm text-fg-muted">
        A quiet dot for something new. It goes away the first time it’s opened.
      </p>
    </div>
  ),
};

export const TheRules: Story = {
  name: 'The rules',
  render: () => (
    <Card className="p-5 touch:p-3">
      <dl className="flex flex-col">
        {(
          [
            ['How many', 'One tour, three steps at most'],
            ['When', 'The first time someone reaches the feature, never at sign-in'],
            ['Dismiss', 'Esc, Skip, or tapping outside. It never shows again'],
            ['Reduced motion', 'No pulse. The dot stays solid'],
          ] as const
        ).map(([term, rule], index, all) => (
          <div
            key={term}
            className={
              'grid min-h-11 grid-cols-[8.75rem_minmax(0,1fr)] items-baseline gap-4 py-2' +
              (index < all.length - 1 ? ' shadow-[inset_0_-1px_0_var(--color-border)]' : '')
            }
          >
            <dt className="text-sm text-fg-muted">{term}</dt>
            <dd className="text-sm font-medium">{rule}</dd>
          </div>
        ))}
      </dl>
    </Card>
  ),
};
