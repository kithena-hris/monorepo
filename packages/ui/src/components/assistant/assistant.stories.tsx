import type { Meta, StoryObj } from '@storybook/react-vite';
import {
  Calendar,
  Copy,
  FileText,
  MessageCircle,
  Mic,
  Paperclip,
  RotateCw,
  ThumbsDown,
  ThumbsUp,
  Users,
  Wallet,
} from 'lucide-react';
import { useState, type JSX, type ReactNode } from 'react';

import { Button } from '../button/button';
import { Card } from '../card/card';
import { Alert, Skeleton } from '../feedback/feedback';
import {
  AssistantComposer,
  AssistantLauncher,
  AssistantMark,
  AssistantMessage,
  AssistantPanel,
  AssistantSource,
  AssistantSources,
  AssistantStep,
  AssistantSteps,
  AssistantSuggestion,
  AssistantSuggestions,
} from './assistant';

const meta: Meta = {
  title: 'Components/Assistant',
  component: AssistantPanel,
  parameters: {
    layout: 'centered',
    docs: {
      description: {
        component: [
          'An assistant that answers questions from your policies and data, and can take action once you confirm. It cites its sources, and it always says when it’s unsure.',
          '',
          'Presentational only: the panel, the messages and the composer, with no model or transport behind them. The product decides what answers.',
          '',
          '### Placement',
          '',
          '**Docked** beside the page pushes it aside, for long tasks. **Floating** at 400 × 560 in the bottom corner, for quick questions. **Full page** from the sidebar, for research. On a phone it opens full screen as a sheet; swipe down to close, and the conversation is kept.',
          '',
          '### Privacy and limits, as the product should state them',
          '',
          '| | |',
          '| --- | --- |',
          '| What it reads | Policies, your own profile, pay and leave, and your team’s calendar |',
          '| What it can’t see | Other people’s pay, medical notes, or anything marked HR-only |',
          '| Actions | Always shown as a card. Nothing happens until you confirm |',
          '| History | Kept 30 days. Clear it any time from the menu |',
        ].join('\n'),
      },
    },
  },
};

export default meta;
type Story = StoryObj;

const noop = (): void => undefined;

function Composer({ streaming = false }: { streaming?: boolean }): JSX.Element {
  const [value, setValue] = useState('');
  return (
    <AssistantComposer
      value={value}
      onValueChange={setValue}
      onSubmit={() => {
        setValue('');
      }}
      streaming={streaming}
      onStop={noop}
      placeholder="Ask about leave, pay or people…"
      tools={
        <>
          <Button
            variant="ghost"
            size="sm"
            startIcon={<Paperclip aria-hidden />}
            aria-label="Attach a file"
          />
          <Button variant="ghost" size="sm" startIcon={<Mic aria-hidden />} aria-label="Dictate" />
        </>
      }
    />
  );
}

function Panel({
  children,
  height = 'h-120 touch:h-140',
  busy = false,
  streaming = false,
}: {
  children: ReactNode;
  height?: string;
  busy?: boolean;
  streaming?: boolean;
}): JSX.Element {
  return (
    <AssistantPanel
      badge="Beta"
      subtitle="Knows your policies and your team"
      onNewChat={noop}
      onExpand={noop}
      onClose={noop}
      busy={busy}
      composer={<Composer streaming={streaming} />}
      className={`w-100 max-w-full touch:w-full ${height}`}
    >
      {children}
    </AssistantPanel>
  );
}

const feedback = (
  <>
    <Button variant="ghost" size="sm" startIcon={<Copy aria-hidden />} aria-label="Copy" />
    <Button
      variant="ghost"
      size="sm"
      startIcon={<ThumbsUp aria-hidden />}
      aria-label="Good answer"
    />
    <Button
      variant="ghost"
      size="sm"
      startIcon={<ThumbsDown aria-hidden />}
      aria-label="Bad answer"
    />
    <Button variant="ghost" size="sm" startIcon={<RotateCw aria-hidden />} aria-label="Try again" />
  </>
);

/** The nudge shows once per session and never covers a primary action. */
export const Launcher: Story = {
  render: function Render() {
    const [nudge, setNudge] = useState(true);
    return (
      <div className="flex h-80 w-full min-w-80 items-end justify-end p-5">
        <AssistantLauncher
          onOpen={noop}
          nudge={nudge ? 'Hi Priya. Want to know how many days off you have left?' : undefined}
          onDismissNudge={() => {
            setNudge(false);
          }}
        />
      </div>
    );
  },
};

export const Welcome: Story = {
  render: () => (
    <Panel height="h-135 touch:h-155">
      <div className="flex flex-col gap-2.5">
        <AssistantMark size="lg" />
        <h3 className="font-display text-lg font-bold text-fg touch:text-xl">
          Hi Priya, how can I help?
        </h3>
        <p className="text-sm text-fg-muted">
          I can answer questions about your leave, pay and policies, and start requests for you.
        </p>
      </div>
      <AssistantSuggestions className="mt-auto">
        <AssistantSuggestion icon={<Calendar aria-hidden />}>
          How many days off do I have?
        </AssistantSuggestion>
        <AssistantSuggestion icon={<Wallet aria-hidden />}>
          Explain my last payslip
        </AssistantSuggestion>
        <AssistantSuggestion icon={<Users aria-hidden />}>
          Who is out next week?
        </AssistantSuggestion>
        <AssistantSuggestion icon={<FileText aria-hidden />}>
          What is the parental leave policy?
        </AssistantSuggestion>
      </AssistantSuggestions>
    </Panel>
  ),
};

export const ConversationWithSources: Story = {
  render: () => (
    <Panel>
      <AssistantMessage from="user">How many vacation days do I have left?</AssistantMessage>
      <AssistantMessage from="assistant" actions={feedback}>
        <p>
          You have <b>14.5 days</b> left for 2026. Up to 5 of those carry over to next year, and
          they must be used by 31 March.
        </p>
        <AssistantSources>
          <AssistantSource index={1} href="#policy">
            Leave policy §3
          </AssistantSource>
          <AssistantSource index={2} href="#balance">
            Your balance
          </AssistantSource>
        </AssistantSources>
      </AssistantMessage>
    </Panel>
  ),
};

/** The send button becomes Stop. Text streams in, but the layout never jumps under the reader. */
export const Streaming: Story = {
  render: () => (
    <Panel busy streaming height="h-110 touch:h-130">
      <AssistantMessage from="user">Summarise the new parental leave policy</AssistantMessage>
      <AssistantMessage from="assistant" streaming>
        <p>
          Starting 1 January, everyone gets up to <b>14 weeks</b> of paid parental leave in the
          first year. You can take it in one block or split it into two
        </p>
      </AssistantMessage>
    </Panel>
  ),
};

export const WorkingOnIt: Story = {
  render: () => (
    <Panel busy height="h-100 touch:h-120">
      <AssistantMessage from="user">Book 14–18 October off</AssistantMessage>
      <AssistantMessage from="assistant">
        <AssistantSteps>
          <AssistantStep status="done">Checked your balance</AssistantStep>
          <AssistantStep status="done">Checked team cover</AssistantStep>
          <AssistantStep status="running">Drafting the request</AssistantStep>
        </AssistantSteps>
      </AssistantMessage>
    </Panel>
  ),
};

/** Anything with a consequence is a card with its own confirm. Nothing is sent until it is pressed. */
export const AskingBeforeItActs: Story = {
  render: () => (
    <Panel height="h-130 touch:h-150">
      <AssistantMessage from="user">Book 14–18 October off</AssistantMessage>
      <AssistantMessage from="assistant">
        <p>Here’s the request. Nothing is sent until you confirm.</p>
        <Card className="flex flex-col gap-2.5 p-3.5">
          <div className="flex items-center gap-2.5">
            <span
              aria-hidden
              className="grid size-8 place-items-center rounded-sm bg-accent-subtle text-accent-fg"
            >
              <Calendar className="size-4" />
            </span>
            <div className="min-w-0">
              <p className="text-sm font-semibold">Vacation · 5 days</p>
              <p className="text-xs text-fg-muted">Goes to Jonas Weber for approval</p>
            </div>
          </div>
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
            <dt className="text-fg-muted">Dates</dt>
            <dd>Mon 14 – Fri 18 Oct</dd>
            <dt className="text-fg-muted">Left after</dt>
            <dd className="tabular-nums">9.5 days</dd>
          </dl>
          <div className="flex justify-end gap-2">
            <Button size="sm">Cancel</Button>
            <Button size="sm" variant="primary">
              Send request
            </Button>
          </div>
        </Card>
      </AssistantMessage>
    </Panel>
  ),
};

/** It says so, in words, rather than guessing. */
export const UnsureOrWrong: Story = {
  render: () => (
    <Panel height="h-130 touch:h-150">
      <AssistantMessage from="user">What’s Jonas’s salary?</AssistantMessage>
      <AssistantMessage from="assistant">
        <p>I can’t share that. Salaries are only visible to HR and to each person’s manager.</p>
      </AssistantMessage>
      <AssistantMessage from="user">What is our dental allowance?</AssistantMessage>
      <AssistantMessage from="assistant">
        <p>
          I couldn’t find a dental allowance in your policies. It may not exist, or it may be in a
          document I can’t read.
        </p>
        <div>
          <Button size="sm" startIcon={<MessageCircle aria-hidden />}>
            Ask the People team
          </Button>
        </div>
      </AssistantMessage>
    </Panel>
  ),
};

export const SomethingWentWrong: Story = {
  render: () => (
    <Panel height="h-90 touch:h-105">
      <AssistantMessage from="user">Explain my last payslip</AssistantMessage>
      <Alert
        tone="danger"
        title="Couldn’t reach the assistant"
        action={
          <Button size="sm" startIcon={<RotateCw aria-hidden />}>
            Retry
          </Button>
        }
      >
        Your question is saved. Try again in a moment.
      </Alert>
    </Panel>
  ),
};

/** Docked: beside the page, pushing it aside. */
export const Placements: Story = {
  parameters: { layout: 'padded' },
  render: () => (
    <div className="flex h-110 overflow-hidden rounded-lg border border-border bg-canvas">
      <div className="flex flex-1 flex-col gap-2.5 p-5 touch:hidden">
        <Skeleton className="h-4.5 w-2/5" />
        <Skeleton className="h-20 w-full" />
        <Skeleton className="h-20 w-full" />
      </div>
      <AssistantPanel
        onClose={noop}
        composer={<Composer />}
        className="w-75 rounded-none border-s border-border shadow-none touch:w-full"
      >
        <AssistantMessage from="user">Who is out next week?</AssistantMessage>
        <AssistantMessage from="assistant">
          <p>3 people on your team: Amara (Mon–Fri), Omar (Wed) and Yuki (Fri).</p>
        </AssistantMessage>
      </AssistantPanel>
    </div>
  ),
};
