import type { Meta, StoryObj } from '@storybook/react-native-web-vite';
import { Download, Network } from 'lucide-react-native';
import { useState } from 'react';
import { View } from 'react-native-css/components';

import { designDocs } from '../../docs/design.ts';
import { Stage, StandInKeyValues, settled } from '../../docs/stage.tsx';
import { Button } from '../button/button.tsx';
import { Icon } from '../icon/icon.tsx';
import { Text } from '../text/text.tsx';
import { CoachMark, CoachMarkDot } from './coach-mark.tsx';

const meta = {
  title: 'Components/Coach mark',
  component: CoachMark,
  parameters: designDocs('coach-mark'),
  // axe runs once the callout has faded in.
  play: settled,
} satisfies Meta<typeof CoachMark>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Spotlight: Story = {
  args: { title: '', children: null },
  render: function SpotlightStory() {
    const [step, setStep] = useState(1);
    return (
      <Stage height={420}>
        {(host) => (
          <View className="absolute inset-x-0 top-[100px] items-center">
            <CoachMark
              defaultOpen
              spotlight
              portalHost={host}
              title="Export the org chart"
              description="Download it as a PDF or PNG, or print it for the wall."
              step={step}
              total={3}
              onNext={() => {
                setStep(Math.min(3, step + 1));
              }}
              onSkip={() => undefined}
            >
              <Button startIcon={<Icon icon={Download} />}>Export</Button>
            </CoachMark>
          </View>
        )}
      </Stage>
    );
  },
};

export const ANewFeatureDot: Story = {
  name: 'A new-feature dot',
  args: { title: '', children: null },
  render: () => (
    <View className="items-start gap-3.5">
      <View className="relative">
        <Button
          variant="ghost"
          startIcon={<Icon icon={Network} />}
          accessibilityLabel="Org chart, new"
        >
          Org chart
        </Button>
        <CoachMarkDot />
      </View>
      <Text variant="subhead" tone="muted" className="self-stretch leading-[1.5]">
        A quiet dot for something new. It goes away the first time it’s opened.
      </Text>
    </View>
  ),
};

export const TheRules: Story = {
  name: 'The rules',
  args: { title: '', children: null },
  render: () => (
    <View className="rounded-[22px] bg-surface p-3 shadow-sm">
      <StandInKeyValues
        pairs={[
          ['How many', 'One tour, three steps at most'],
          ['When', 'The first time someone reaches the feature, never at sign-in'],
          ['Dismiss', 'Esc, Skip, or tapping outside. It never shows again'],
          ['Reduced motion', 'No pulse. The dot stays solid'],
        ]}
      />
    </View>
  ),
};
