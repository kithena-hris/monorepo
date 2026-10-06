import type { Meta, StoryObj } from '@storybook/react-native-web-vite';
import { Image } from 'lucide-react-native';
import { View } from 'react-native-css/components';

import { designDocs, designNote } from '../../docs/design.ts';
import { Card } from '../card/card.tsx';
import { Icon } from '../icon/icon.tsx';
import { Text } from '../text/text.tsx';
import { Carousel } from './carousel.tsx';

const meta = {
  title: 'Components/Carousel',
  component: Carousel,
  parameters: designDocs('carousel'),
  args: { accessibilityLabel: 'Events', children: null },
} satisfies Meta<typeof Carousel>;

export default meta;
type Story = StoryObj<typeof meta>;

/** The chart colours a slide's picture is tinted with, as the design draws them. */
const TINT = {
  2: 'bg-chart-2',
  3: 'bg-chart-3',
  4: 'bg-chart-4',
  5: 'bg-chart-5',
  6: 'bg-chart-6',
} as const;

/** A slide: a picture over a title and a line. */
function Slide({
  tint,
  title,
  detail,
}: {
  tint: keyof typeof TINT;
  title: string;
  detail: string;
}): React.JSX.Element {
  return (
    <Card padded={false} className="overflow-hidden">
      <View className="h-[120px] items-center justify-center">
        {/* 55% of the colour over the surface, the design's mix. */}
        <View className={`absolute inset-0 opacity-[0.55] ${TINT[tint]}`} />
        {/* In a view: positioned, so it draws over the tint as on a device. */}
        <View>
          <Icon icon={Image} size={28} className="text-white" />
        </View>
      </View>
      <View className="p-3.5">
        <Text weight="semibold" className="leading-[1.4]">
          {title}
        </Text>
        <Text variant="subhead" tone="muted" className="leading-[1.5]">
          {detail}
        </Text>
      </View>
    </Card>
  );
}

export const CardsThatPeek: Story = {
  name: 'Cards that peek',
  render: () => (
    <Carousel accessibilityLabel="Events" bleed>
      <Slide tint={2} title="Team offsite" detail="Lisbon · 12 Nov" />
      <Slide tint={3} title="Benefits fair" detail="Berlin · 20 Nov" />
      <Slide tint={5} title="Training week" detail="Online · Dec" />
      <Slide tint={4} title="Winter party" detail="All offices" />
    </Carousel>
  ),
};

function Hero({ title, detail }: { title: string; detail: string }): React.JSX.Element {
  return (
    // The accent at full strength: the design's 70% mix over the surface
    // leaves white 14pt text under 4.5:1.
    <View className="h-[200px] justify-end gap-1.5 overflow-hidden rounded-[24px] bg-accent-solid p-5">
      <Text className="text-[24px] font-bold leading-[1.4] text-white">{title}</Text>
      <Text className="text-[14px] leading-[1.4] text-white">{detail}</Text>
    </View>
  );
}

export const HeroWithDots: Story = {
  name: 'Hero with dots',
  render: () => (
    <Carousel accessibilityLabel="Getting started" controls="dots" slideWidth={1}>
      <Hero title="Welcome to Reach, Lucas" detail="Three things to do in your first week" />
      <Hero title="Add your photo" detail="So your team knows who you are" />
      <Hero title="Book your first day off" detail="Your allowance is ready" />
    </Carousel>
  ),
};

export const WithControls: Story = {
  name: 'With controls',
  parameters: designNote('carousel', 'With controls'),
  render: () => (
    <Carousel accessibilityLabel="Upcoming" title="Upcoming" controls="arrows">
      <Slide tint={2} title="Payday" detail="31 Oct" />
      <Slide tint={6} title="Reviews open" detail="4 Nov" />
      <Slide tint={3} title="Holiday" detail="25 Dec" />
    </Carousel>
  ),
};
