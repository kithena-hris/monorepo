import type { Meta, StoryObj } from '@storybook/react-vite';
import {
  ChevronLeft,
  ChevronRight,
  MessageSquare,
  PanelTop,
  SquareDashed,
  Wrench,
} from 'lucide-react';
import { useState, type ReactNode } from 'react';

import { ReachMark } from '../../brand/reach-logo';
import { Avatar } from '../avatar/avatar';
import { Badge } from '../badge/badge';
import { Button } from '../button/button';
import { Card } from '../card/card';
import { Skeleton } from '../feedback/feedback';
import { Banner } from './banner';

const meta = {
  title: 'Components/Banner',
  component: Banner,
  parameters: {
    layout: 'padded',
    docs: {
      description: {
        component: [
          'A full-width message at the top of the page about the whole app or account. Only one banner shows at a time.',
          '',
          '| Use | When |',
          '| --- | --- |',
          '| `Banner` | The whole app or account. Stays until it’s fixed or dismissed. |',
          '| `Alert` | One section of a page. Sits next to what it’s about. |',
          '| Toast | Confirms something you just did. Goes away on its own. |',
          '',
          '`danger` and `warning` announce assertively; the other tones wait for a pause. Leave `onDismiss` out for a banner that must stay until its cause is fixed.',
        ].join('\n'),
      },
    },
  },
  argTypes: {
    tone: {
      control: 'inline-radio',
      options: ['info', 'success', 'warning', 'danger', 'accent', 'neutral'],
      table: {
        type: { summary: "'info' | 'success' | 'warning' | 'danger' | 'accent' | 'neutral'" },
        defaultValue: { summary: 'info' },
        category: 'Appearance',
      },
    },
    emphasis: {
      description:
        '`solid` for a critical message: a filled danger, success or accent. `invert` for a system notice that is not about the account, such as maintenance.',
      control: 'inline-radio',
      options: ['soft', 'solid', 'invert'],
      table: {
        type: { summary: "'soft' | 'solid' | 'invert'" },
        defaultValue: { summary: 'soft' },
        category: 'Appearance',
      },
    },
    rounded: {
      description:
        'Inset with rounded corners, for a banner inside a content column rather than across the top.',
      control: 'boolean',
      table: { type: { summary: 'boolean' }, category: 'Appearance' },
    },
    title: { control: 'text', table: { type: { summary: 'ReactNode' }, category: 'Content' } },
    children: { control: 'text', table: { type: { summary: 'ReactNode' }, category: 'Content' } },
    actions: { control: false, table: { type: { summary: 'ReactNode' }, category: 'Content' } },
    onDismiss: { control: false, table: { type: { summary: '() => void' }, category: 'Events' } },
  },
  args: {
    tone: 'warning',
    title: 'Payroll closes tomorrow at 17:00.',
    children: 'Submit expenses before then.',
  },
} satisfies Meta<typeof Banner>;

export default meta;
type Story = StoryObj<typeof meta>;

/** A page for a banner to sit on top of. */
function Page({ banner }: { banner: ReactNode }): React.JSX.Element {
  return (
    <div className="overflow-hidden rounded-lg bg-canvas shadow-[inset_0_0_0_1px_var(--color-border)] touch:rounded-[1.75rem]">
      {banner}
      <div className="flex h-11 items-center gap-2.5 px-4 shadow-[inset_0_-1px_0_var(--color-border)]">
        <ReachMark className="size-5.5" />
        <span className="text-sm font-bold">Reach</span>
        <Avatar name="Priya Shah" size="sm" className="ms-auto" />
      </div>
      <div className="flex flex-col gap-2.5 p-4">
        <Skeleton className="h-4 w-2/5" />
        <Skeleton className="h-15 w-full rounded-md" />
      </div>
    </div>
  );
}

export const Playground: Story = {
  render: function PlaygroundStory(args) {
    const [shown, setShown] = useState(true);
    return (
      <Page
        banner={
          shown ? (
            <Banner
              {...args}
              actions={<a href="#payroll">Review</a>}
              onDismiss={() => {
                setShown(false);
              }}
            />
          ) : null
        }
      />
    );
  },
};

const tones = [
  ['info', 'Heads up.', 'Your manager changes on 1 Nov.'],
  ['success', 'All payslips sent.', '312 people were paid.'],
  ['warning', '2 contracts expire soon.', 'Renew them before 12 Oct.'],
  ['danger', 'Payroll failed for 3 people.', 'Their bank details are missing.'],
  ['accent', 'New:', 'You can now export the org chart.'],
  ['neutral', 'Scheduled maintenance.', 'Sunday 02:00–04:00 CET.'],
] as const;

export const Tones: Story = {
  render: () => (
    <div className="flex flex-col gap-2">
      {tones.map(([tone, title, body]) => (
        <Banner key={tone} tone={tone} title={title} rounded>
          {body}
        </Banner>
      ))}
    </div>
  ),
};

export const CriticalSolid: Story = {
  name: 'Critical, solid',
  render: () => (
    <Banner
      tone="danger"
      emphasis="solid"
      rounded
      title="Payroll failed for 3 people."
      actions={<Button size="sm">Fix now</Button>}
    >
      They won’t be paid until you fix it.
    </Banner>
  ),
};

export const WithActions: Story = {
  name: 'With actions',
  render: () => (
    <Banner
      tone="warning"
      rounded
      title="Your trial ends in 5 days."
      onDismiss={() => undefined}
      actions={
        <>
          <Button variant="primary" size="sm">
            Add payment
          </Button>
          <Button variant="ghost" size="sm">
            Later
          </Button>
        </>
      }
    >
      Add a payment method to keep your data.
    </Banner>
  ),
};

export const MaintenanceCountdown: Story = {
  name: 'Maintenance countdown',
  render: () => (
    <Banner
      emphasis="invert"
      rounded
      icon={<Wrench />}
      title="Reach is read-only in 14 min."
      actions={<a href="#maintenance">Details</a>}
    >
      Maintenance from 02:00 to 04:00 CET.
    </Banner>
  ),
};

export const Announcement: Story = {
  render: () => (
    <Banner
      tone="accent"
      rounded
      title="Org chart export is here."
      onDismiss={() => undefined}
      actions={
        <>
          <Badge tone="accent" size="sm">
            New
          </Badge>
          <a href="#export">Try it</a>
        </>
      }
    >
      Download any chart as a PDF or PNG.
    </Banner>
  ),
};

const queue = [
  ['warning', '2 contracts expire soon.', 'Renew them before 12 Oct.'],
  ['info', 'Your manager changes on 1 Nov.', 'Nora Becker takes over the team.'],
  ['neutral', 'Scheduled maintenance.', 'Sunday 02:00–04:00 CET.'],
] as const;

export const WhenThereAreSeveral: Story = {
  name: 'When there are several',
  parameters: {
    docs: {
      description: {
        story:
          'Only one banner at a time. The most severe comes first, and the rest page behind it.',
      },
    },
  },
  render: function SeveralStory() {
    const [index, setIndex] = useState(0);
    const [tone, title, body] = queue[index] ?? queue[0];
    return (
      <Banner
        tone={tone}
        rounded
        title={title}
        onDismiss={() => undefined}
        actions={
          <div className="flex items-center gap-1 text-xs font-semibold text-fg-muted">
            <Button
              variant="ghost"
              size="sm"
              startIcon={<ChevronLeft aria-hidden="true" />}
              aria-label="Previous message"
              disabled={index === 0}
              onClick={() => {
                setIndex(index - 1);
              }}
            />
            <span aria-live="polite">
              {index + 1} of {queue.length}
            </span>
            <Button
              variant="ghost"
              size="sm"
              startIcon={<ChevronRight aria-hidden="true" />}
              aria-label="Next message"
              disabled={index === queue.length - 1}
              onClick={() => {
                setIndex(index + 1);
              }}
            />
          </div>
        }
      >
        {body}
      </Banner>
    );
  },
};

export const BannerAlertOrToast: Story = {
  name: 'Banner, alert or toast?',
  render: () => (
    <div className="@container">
      <div className="grid gap-2.5 @xl:grid-cols-3">
        {(
          [
            [PanelTop, 'Banner', 'Whole app or account. Stays until it’s fixed or dismissed.'],
            [SquareDashed, 'Alert', 'One section of a page. Sits next to what it’s about.'],
            [MessageSquare, 'Toast', 'Confirms something you just did. Goes away on its own.'],
          ] as const
        ).map(([Icon, name, body]) => (
          <Card key={name} className="flex flex-col gap-2 p-3.5">
            <Icon aria-hidden="true" className="size-5 text-accent-fg" />
            <p className="font-semibold">{name}</p>
            <p className="text-sm text-fg-muted">{body}</p>
          </Card>
        ))}
      </div>
    </div>
  ),
};

export const OnThePage: Story = {
  name: 'On the page',
  render: () => (
    <Page
      banner={
        <Banner tone="info" onDismiss={() => undefined} actions={<a href="#team">See who</a>}>
          Your manager changes on 1 Nov.
        </Banner>
      }
    />
  ),
};
