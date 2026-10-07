import type { Meta, StoryObj } from '@storybook/react-native-web-vite';
import { useState } from 'react';

import { overlayDocs } from '../../docs/design.ts';
import { Stage, settled } from '../../docs/stage.tsx';
import { Field, FieldDescription, FieldLabel } from '../field/field.tsx';
import { Stack } from '../layout/layout.tsx';
import { Text } from '../text/text.tsx';
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from './select.tsx';

const meta = {
  title: 'Forms/Select',
  component: Select,
  parameters: overlayDocs('select'),
  // axe runs after this, on the open list, not on its fade in.
  play: settled,
} satisfies Meta<typeof Select>;

export default meta;
type Story = StoryObj;

const teams = ['Engineering', 'Design', 'Sales', 'Support', 'Finance'];

export const Playground: Story = {
  render: function PlaygroundStory() {
    const [team, setTeam] = useState('Design');
    return (
      <Select value={team} onValueChange={setTeam} defaultOpen>
        <Stage
          trigger={
            <SelectTrigger accessibilityLabel="Team">
              <SelectValue />
            </SelectTrigger>
          }
        >
          {(host) => (
            <SelectContent portalHost={host}>
              {teams.map((t) => (
                <SelectItem key={t} value={t}>
                  {t}
                </SelectItem>
              ))}
            </SelectContent>
          )}
        </Stage>
      </Select>
    );
  },
};

export const Placeholder: Story = {
  render: () => (
    <Select>
      <SelectTrigger accessibilityLabel="Team">
        <SelectValue placeholder="Choose a team" />
      </SelectTrigger>
      <SelectContent>
        {teams.map((t) => (
          <SelectItem key={t} value={t}>
            {t}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  ),
};

export const Grouped: Story = {
  render: () => (
    <Select defaultValue="berlin" defaultOpen>
      <Stage
        height={560}
        trigger={
          <SelectTrigger accessibilityLabel="Office">
            <SelectValue />
          </SelectTrigger>
        }
      >
        {(host) => (
          <SelectContent portalHost={host}>
            <SelectGroup>
              <SelectLabel>Europe</SelectLabel>
              <SelectItem value="berlin">Berlin</SelectItem>
              <SelectItem value="london">London</SelectItem>
              <SelectItem value="paris">Paris</SelectItem>
            </SelectGroup>
            <SelectGroup>
              <SelectLabel>Asia</SelectLabel>
              <SelectItem value="tokyo">Tokyo</SelectItem>
              <SelectItem value="singapore">Singapore</SelectItem>
            </SelectGroup>
          </SelectContent>
        )}
      </Stage>
    </Select>
  ),
};

export const InAField: Story = {
  name: 'In a field',
  render: () => (
    <Field>
      <FieldLabel>Contract type</FieldLabel>
      <Select defaultValue="permanent">
        <SelectTrigger>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="permanent">Permanent</SelectItem>
          <SelectItem value="fixed">Fixed-term</SelectItem>
          <SelectItem value="casual">Casual</SelectItem>
        </SelectContent>
      </Select>
      <FieldDescription>Fixed-term contracts need an end date.</FieldDescription>
    </Field>
  ),
};

const payDays: Record<string, readonly string[]> = {
  Monthly: ['Last working day', 'The 25th', 'The 1st'],
  Fortnightly: ['Every other Friday', 'Every other Thursday'],
  Weekly: ['Friday', 'Thursday'],
};

export const Controlled: Story = {
  render: function ControlledStory() {
    const [frequency, setFrequency] = useState('Monthly');
    const [day, setDay] = useState('Last working day');
    return (
      <Stack className="gap-3.5">
        <Field>
          <FieldLabel>Pay frequency</FieldLabel>
          <Select
            value={frequency}
            onValueChange={(next) => {
              setFrequency(next);
              // The parent owns both: a new frequency resets the day.
              setDay(payDays[next]?.[0] ?? '');
            }}
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {Object.keys(payDays).map((f) => (
                <SelectItem key={f} value={f}>
                  {f}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
        <Text variant="subhead" tone="muted">
          The value comes from the parent. Changing it resets the pay-day field below.
        </Text>
        <Field>
          <FieldLabel>Pay day</FieldLabel>
          <Select value={day} onValueChange={setDay}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {(payDays[frequency] ?? []).map((d) => (
                <SelectItem key={d} value={d}>
                  {d}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
      </Stack>
    );
  },
};

export const Disabled: Story = {
  render: () => (
    <Stack className="gap-3.5">
      <Field disabled>
        <FieldLabel>Currency</FieldLabel>
        <Select defaultValue="EUR" disabled>
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="EUR">EUR</SelectItem>
          </SelectContent>
        </Select>
        <FieldDescription>Set by your entity.</FieldDescription>
      </Field>
      <Select defaultValue="full" defaultOpen>
        <Stage
          height={400}
          trigger={
            <SelectTrigger accessibilityLabel="Employment type">
              <SelectValue />
            </SelectTrigger>
          }
        >
          {(host) => (
            <SelectContent portalHost={host}>
              <SelectItem value="full">Full-time</SelectItem>
              <SelectItem value="part">Part-time</SelectItem>
              <SelectItem value="contractor" disabled description="Not available in Germany">
                Contractor
              </SelectItem>
            </SelectContent>
          )}
        </Stage>
      </Select>
    </Stack>
  ),
};
