import type { Meta, StoryObj } from '@storybook/react-native-web-vite';
import {
  Calendar,
  FileText,
  House,
  MessageCircle,
  RotateCw,
  User,
  Users,
  Wallet,
} from 'lucide-react-native';
import { useState, type ReactNode } from 'react';
import { View } from 'react-native-css/components';

import { designDocs, designNote } from '../../docs/design.ts';
import { settled } from '../../docs/stage.tsx';
import { Button } from '../button/button.tsx';
import { Card } from '../card/card.tsx';
import { Alert } from '../feedback/feedback.tsx';
import { Icon } from '../icon/icon.tsx';
import { Text } from '../text/text.tsx';
import { TabBar, type TabBarItem } from '../app-bar/app-bar.tsx';
import {
  AssistantAction,
  AssistantComposer,
  AssistantDetails,
  AssistantFeedback,
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
  AssistantText,
  AssistantWidget,
  Strong,
} from './assistant.tsx';

const meta = {
  title: 'Components/AI chat widget',
  component: AssistantPanel,
  parameters: designDocs('ai-chat'),
  // The card fades in from the launcher; axe reads its colours once it has.
  play: settled,
  args: { children: null },
} satisfies Meta<typeof AssistantPanel>;

export default meta;
type Story = StoryObj<typeof meta>;

const noop = (): void => undefined;

/** The assistant's card as the stories show it, with a composer that works. */
function Panel({
  height,
  streaming = false,
  children,
}: {
  height: number;
  streaming?: boolean;
  children: ReactNode;
}): React.JSX.Element {
  const [draft, setDraft] = useState('');
  return (
    <View style={{ height }}>
      <AssistantPanel
        title="Reach Assistant"
        badge="Beta"
        subtitle="Knows your policies and your team"
        onNewChat={noop}
        onMinimize={noop}
        className="flex-1"
        composer={
          <AssistantComposer
            value={draft}
            onValueChange={setDraft}
            onSubmit={() => {
              setDraft('');
            }}
            streaming={streaming}
            onStop={noop}
            onAttach={noop}
            onDictate={noop}
            placeholder="Ask about leave, pay or people…"
          />
        }
      >
        {children}
      </AssistantPanel>
    </View>
  );
}

/** A phone's page, for the launcher and the card to float over. */
function Screen({ height, children }: { height: number; children: ReactNode }): React.JSX.Element {
  return (
    <View
      className="overflow-hidden rounded-[24px] border border-border bg-canvas"
      style={{ height }}
    >
      <View className="gap-3 p-5">
        <View className="h-[18px] w-2/5 rounded-[6px] bg-surface-active" />
        <View className="h-2.5 w-[70%] rounded-[5px] bg-surface-sunken" />
        <View className="h-20 rounded-[14px] bg-surface" />
        <View className="h-20 rounded-[14px] bg-surface" />
        <View className="h-20 rounded-[14px] bg-surface" />
      </View>
      {children}
    </View>
  );
}

export const Launcher: Story = {
  parameters: designNote('ai-chat', 'Launcher'),
  render: function LauncherStory() {
    const [nudge, setNudge] = useState(true);
    return (
      <Screen height={420}>
        <View className="absolute bottom-5 right-5">
          <AssistantLauncher
            onOpen={noop}
            {...(nudge
              ? {
                  nudge: 'Hi Priya. Want to know how many days off you have left?',
                  onDismissNudge: () => {
                    setNudge(false);
                  },
                }
              : {})}
          />
        </View>
      </Screen>
    );
  },
};

export const Welcome: Story = {
  render: () => (
    <Panel height={620}>
      <View className="gap-2.5">
        <AssistantMark size={44} />
        <Text className="text-[24px] font-bold leading-[1.4]">Hi Priya, how can I help?</Text>
        <Text variant="subhead" tone="muted" className="leading-[1.5]">
          I can answer questions about your leave, pay and policies, and start requests for you.
        </Text>
      </View>
      <AssistantSuggestions>
        <AssistantSuggestion icon={Calendar} onPress={noop}>
          How many days off do I have?
        </AssistantSuggestion>
        <AssistantSuggestion icon={Wallet} onPress={noop}>
          Explain my last payslip
        </AssistantSuggestion>
        <AssistantSuggestion icon={Users} onPress={noop}>
          Who is out next week?
        </AssistantSuggestion>
        <AssistantSuggestion icon={FileText} onPress={noop}>
          What is the parental leave policy?
        </AssistantSuggestion>
      </AssistantSuggestions>
    </Panel>
  ),
};

export const ConversationWithSources: Story = {
  name: 'Conversation with sources',
  render: () => (
    <Panel height={560}>
      <AssistantMessage from="user">How many vacation days do I have left?</AssistantMessage>
      <AssistantMessage
        from="assistant"
        actions={<AssistantFeedback onCopy={noop} onRate={noop} onRetry={noop} />}
      >
        <AssistantText>
          You have <Strong>14.5 days</Strong> left for 2026. Up to 5 of those carry over to next
          year, and they must be used by 31 March.
        </AssistantText>
        <AssistantSources>
          <AssistantSource index={1} onPress={noop}>
            Leave policy §3
          </AssistantSource>
          <AssistantSource index={2} onPress={noop}>
            Your balance
          </AssistantSource>
        </AssistantSources>
      </AssistantMessage>
    </Panel>
  ),
};

export const Streaming: Story = {
  parameters: designNote('ai-chat', 'Streaming'),
  render: () => (
    <Panel height={520} streaming>
      <AssistantMessage from="user">Summarise the new parental leave policy</AssistantMessage>
      <AssistantMessage from="assistant" streaming>
        <AssistantText>
          Starting 1 January, everyone gets up to <Strong>14 weeks</Strong> of paid parental leave
          in the first year. You can take it in one block or split it into two
        </AssistantText>
      </AssistantMessage>
    </Panel>
  ),
};

export const WorkingOnIt: Story = {
  name: 'Working on it',
  render: () => (
    <Panel height={480}>
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

export const AskingBeforeItActs: Story = {
  name: 'Asking before it acts',
  render: () => (
    <Panel height={600}>
      <AssistantMessage from="user">Book 14–18 October off</AssistantMessage>
      <AssistantMessage from="assistant">
        Here’s the request. Nothing is sent until you confirm.
        <AssistantAction
          icon={Calendar}
          title="Vacation · 5 days"
          description="Goes to Jonas Weber for approval"
          details={[
            ['Dates', 'Mon 14 – Fri 18 Oct'],
            ['Left after', '9.5 days'],
          ]}
          confirmLabel="Send request"
          onConfirm={noop}
          onCancel={noop}
        />
      </AssistantMessage>
    </Panel>
  ),
};

export const UnsureOrWrong: Story = {
  name: 'Unsure, or wrong',
  render: () => (
    <Panel height={600}>
      <AssistantMessage from="user">What’s Jonas’s salary?</AssistantMessage>
      <AssistantMessage from="assistant">
        I can’t share that. Salaries are only visible to HR and to each person’s manager.
      </AssistantMessage>
      <AssistantMessage from="user">What is our dental allowance?</AssistantMessage>
      <AssistantMessage from="assistant">
        I couldn’t find a dental allowance in your policies. It may not exist, or it may be in a
        document I can’t read.
        <View className="flex-row">
          <Button size="sm" startIcon={<Icon icon={MessageCircle} />}>
            Ask the People team
          </Button>
        </View>
      </AssistantMessage>
    </Panel>
  ),
};

export const SomethingWentWrong: Story = {
  name: 'Something went wrong',
  render: () => (
    <Panel height={420}>
      <AssistantMessage from="user">Explain my last payslip</AssistantMessage>
      <Alert
        tone="danger"
        title="Couldn’t reach the assistant"
        actions={
          <Button size="xs" startIcon={<Icon icon={RotateCw} />}>
            Retry
          </Button>
        }
      >
        Your question is saved. Try again in a moment.
      </Alert>
    </Panel>
  ),
};

const TABS: TabBarItem[] = [
  { key: 'home', label: 'Home', icon: House },
  { key: 'people', label: 'People', icon: Users },
  { key: 'pay', label: 'Pay', icon: Wallet },
  { key: 'me', label: 'Me', icon: User },
];

/** The app's tab bar, floating at the bottom of the screen. */
function Tabs(): React.JSX.Element {
  const [section, setSection] = useState('people');
  return (
    <View className="absolute inset-x-2 bottom-2">
      <TabBar items={TABS} value={section} onValueChange={setSection} />
    </View>
  );
}

export const Placements: Story = {
  parameters: {
    docs: {
      description: {
        story:
          'On a phone the assistant opens as a compact card above the tab bar: never full screen and no scrim, so the page someone asked about stays in view. Minimise folds it back into the launcher and keeps the conversation.',
      },
    },
  },
  render: function PlacementsStory() {
    const [open, setOpen] = useState(true);
    return (
      <Screen height={560}>
        <Tabs />
        <AssistantWidget open={open} onOpenChange={setOpen} bottomInset={60} height={420}>
          <AssistantPanel
            title="Reach Assistant"
            badge="Beta"
            subtitle="Knows your policies and your team"
            onMinimize={() => {
              setOpen(false);
            }}
            className="flex-1"
            composer={
              <AssistantComposer
                value=""
                onValueChange={noop}
                onSubmit={noop}
                placeholder="Ask about leave, pay or people…"
                disclaimer={null}
              />
            }
          >
            <AssistantMessage from="user">Who is out next week?</AssistantMessage>
            <AssistantMessage from="assistant">
              3 people on your team: Amara (Mon–Fri), Omar (Wed) and Yuki (Fri).
            </AssistantMessage>
          </AssistantPanel>
        </AssistantWidget>
      </Screen>
    );
  },
};

export const PrivacyAndLimits: Story = {
  name: 'Privacy and limits',
  render: () => (
    <Card className="p-3">
      <AssistantDetails
        pairs={[
          ['What it reads', 'Policies, your own profile, pay and leave, and your team’s calendar'],
          ['What it can’t see', 'Other people’s pay, medical notes, or anything marked HR-only'],
          ['Actions', 'Always shown as a card. Nothing happens until you confirm'],
          ['History', 'Kept 30 days. Clear it any time from the menu'],
        ]}
      />
    </Card>
  ),
};
