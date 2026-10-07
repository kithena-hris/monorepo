import type { Meta, StoryObj } from '@storybook/react-native-web-vite';
import { useState } from 'react';
import { View } from 'react-native-css/components';

import { designDocs } from '../../docs/design.ts';
import { settled } from '../../docs/stage.tsx';
import { PEOPLE } from '../../docs/people.ts';
import { Avatar } from '../avatar/avatar.tsx';
import { Button } from '../button/button.tsx';
import { Card } from '../card/card.tsx';
import { Checkbox } from '../checkbox/checkbox.tsx';
import { Field, FieldError, FieldLabel } from '../field/field.tsx';
import { Input } from '../input/input.tsx';
import { Stack } from '../layout/layout.tsx';
import { Text } from '../text/text.tsx';
import { Reveal, Stagger, staggerDelay } from './reveal.tsx';

const meta = {
  title: 'Components/Reveal',
  component: Reveal,
  parameters: designDocs('reveal'),
  args: { open: true, children: null },
} satisfies Meta<typeof Reveal>;

export default meta;
type Story = StoryObj<typeof meta>;

function Caption({ children }: { children: string }): React.JSX.Element {
  return (
    <Text variant="subhead" tone="muted" className="text-center leading-[1.5]">
      {children}
    </Text>
  );
}

export const Playground: Story = {
  render: function PlaygroundStory() {
    const [open, setOpen] = useState(true);
    return (
      <Stack gap={3} align="center">
        <View className="h-[60px] justify-start">
          <Reveal open={open}>
            <View className="h-[60px] w-[100px] rounded-[14px] bg-accent-subtle" />
          </Reveal>
        </View>
        <Caption>{open ? 'Shown' : 'Hidden'}</Caption>
        <Button
          size="sm"
          onPress={() => {
            setOpen(!open);
          }}
        >
          {open ? 'Hide' : 'Show'}
        </Button>
      </Stack>
    );
  },
};

export const AgainstAConditionalRender: Story = {
  name: 'Against a conditional render',
  render: function Against() {
    const [open, setOpen] = useState(true);
    return (
      <Stack gap={3}>
        <View className="flex-row gap-3">
          <View className="flex-1 gap-2">
            <Text variant="footnote" weight="semibold" tone="muted">
              Conditional render
            </Text>
            {open ? (
              <View className="h-[60px] items-center justify-center rounded-[12px] bg-surface-sunken px-2">
                <Caption>Pops in, and the layout jumps</Caption>
              </View>
            ) : null}
          </View>
          <View className="flex-1 gap-2">
            <Text variant="footnote" weight="semibold" tone="muted">
              Reveal
            </Text>
            <Reveal open={open}>
              <View className="h-[60px] items-center justify-center rounded-[12px] bg-accent-subtle px-2">
                <Caption>Height and opacity ease</Caption>
              </View>
            </Reveal>
          </View>
        </View>
        <Button
          size="sm"
          onPress={() => {
            setOpen(!open);
          }}
        >
          {open ? 'Hide both' : 'Show both'}
        </Button>
      </Stack>
    );
  },
};

export const ASelectionBar: Story = {
  name: 'A selection bar',
  render: function SelectionBar() {
    const people = PEOPLE.slice(0, 3);
    const [picked, setPicked] = useState<string[]>([people[0]?.name ?? '', people[2]?.name ?? '']);
    const all = picked.length === people.length;
    return (
      <Stack gap={3}>
        <Card padded={false} className="overflow-hidden">
          <View className="flex-row items-center gap-3 border-b border-border px-4 py-3">
            <Checkbox
              checked={all ? true : picked.length > 0 ? 'indeterminate' : false}
              onCheckedChange={(on) => {
                setPicked(on ? people.map((p) => p.name) : []);
              }}
              accessibilityLabel="Select everyone"
            />
            <Text variant="subhead" weight="semibold" tone="muted">
              Select all
            </Text>
          </View>
          {people.map((person) => {
            const on = picked.includes(person.name);
            return (
              <View
                key={person.name}
                className={`flex-row items-start gap-3 border-b border-border px-4 py-3.5 ${on ? 'bg-accent-subtle' : ''}`}
              >
                <View className="pt-2">
                  <Checkbox
                    checked={on}
                    onCheckedChange={(next) => {
                      setPicked(
                        next ? [...picked, person.name] : picked.filter((n) => n !== person.name),
                      );
                    }}
                    accessibilityLabel={`Select ${person.name}`}
                  />
                </View>
                <View className="min-w-0 flex-1 gap-2">
                  <View className="flex-row items-center gap-3">
                    <Avatar name={person.name} size={40} decorative />
                    <View className="min-w-0 flex-1">
                      <Text weight="semibold" className="text-[16px] leading-[1.3]">
                        {person.name}
                      </Text>
                      <Text tone="muted" className="text-[14px] leading-[1.3]">
                        {person.role}
                      </Text>
                    </View>
                  </View>
                  <Text tone="muted" className="text-[14px] leading-[1.3]">
                    {person.team}
                  </Text>
                </View>
              </View>
            );
          })}
        </Card>
        <Reveal open={picked.length > 0}>
          <View className="flex-row items-center gap-2 rounded-full bg-invert py-1.5 pl-[18px] pr-1.5 shadow-lg">
            <Text tone="on-invert" weight="semibold" className="flex-1 text-[15px] leading-none">
              {`${String(picked.length)} selected`}
            </Text>
            <Button size="sm" variant="on-invert">
              Message
            </Button>
            <Button size="sm" variant="on-invert">
              Export
            </Button>
          </View>
        </Reveal>
      </Stack>
    );
  },
};

export const StaggerStyle: Story = {
  name: 'staggerStyle',
  // Checked once the group has arrived: mid-fade, every row is faint on purpose.
  play: settled,
  render: () => (
    <Stack gap={1} className="gap-1.5">
      {PEOPLE.slice(0, 4).map((person, i) => (
        <Stagger key={person.name} index={i}>
          <Card className="flex-row items-center gap-2.5 p-2.5">
            <Avatar name={person.name} size={32} decorative />
            <Text weight="semibold" className="flex-1 text-[14px]">
              {person.name}
            </Text>
            <Text mono tone="subtle" className="text-[11px] leading-none">
              {`+${String(staggerDelay(i))}ms`}
            </Text>
          </Card>
        </Stagger>
      ))}
    </Stack>
  ),
};

export const AnErrorMessage: Story = {
  name: 'An error message',
  render: function ErrorMessage() {
    const [email, setEmail] = useState('priya@');
    const invalid = !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email);
    return (
      <Stack gap={2}>
        <Field invalid={invalid}>
          <FieldLabel>Work email</FieldLabel>
          <Input type="email" value={email} onChange={setEmail} />
          <Reveal open={invalid} from="top">
            <FieldError>Use a full address, like priya@reach.co.</FieldError>
          </Reveal>
        </Field>
        <Text variant="subhead" tone="muted" className="leading-[1.5]">
          The message eases in below the field, so the field above it doesn’t move.
        </Text>
      </Stack>
    );
  },
};
