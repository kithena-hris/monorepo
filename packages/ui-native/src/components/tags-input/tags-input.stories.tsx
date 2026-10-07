import type { Meta, StoryObj } from '@storybook/react-native-web-vite';
import { useState } from 'react';

import { designDocs } from '../../docs/design.ts';
import { Kbd } from '../kbd/kbd.tsx';
import { Inline, Stack } from '../layout/layout.tsx';
import { Text } from '../text/text.tsx';
import { isEmailish, TagsInput } from './tags-input.tsx';

const meta = {
  title: 'Forms/TagsInput',
  component: TagsInput,
  parameters: designDocs('tags-input'),
} satisfies Meta<typeof TagsInput>;

export default meta;
type Story = StoryObj;

function Tags({
  initial,
  ...props
}: Omit<React.ComponentProps<typeof TagsInput>, 'value' | 'onChange'> & {
  initial: readonly string[];
}): React.JSX.Element {
  const [tags, setTags] = useState(initial);
  return <TagsInput value={tags} onChange={setTags} {...props} />;
}

export const Playground: Story = {
  render: () => (
    <Tags
      label="Skills"
      placeholder="Add a skill"
      initial={['React', 'TypeScript', 'Design systems']}
    />
  ),
};

function Hint({ keys, children }: { keys: string; children: string }): React.JSX.Element {
  return (
    <Inline className="items-center gap-1">
      <Kbd touch="show">{keys}</Kbd>
      <Text variant="footnote" tone="muted">
        {children}
      </Text>
    </Inline>
  );
}

export const FromTheKeyboard: Story = {
  name: 'From the keyboard',
  render: () => (
    <Stack className="gap-3.5">
      <Tags label="Skills" placeholder="Add a skill" initial={['React', 'TypeScript']} />
      <Inline className="flex-wrap gap-3">
        <Hint keys="enter">add</Hint>
        <Hint keys=",">add</Hint>
        <Hint keys="backspace">remove last</Hint>
        <Hint keys="left">select a tag</Hint>
      </Inline>
    </Stack>
  ),
};

export const ValidationAndDuplicates: Story = {
  name: 'Validation and duplicates',
  render: () => (
    <Tags
      label="Invite"
      placeholder="Add an email address"
      hint="Type or paste addresses: a duplicate lights up the tag it ran into."
      validate={(v) => (isEmailish(v) ? null : `${v} isn’t a full address.`)}
      initial={['priya@reach.co', 'jonas@']}
    />
  ),
};

export const MarkupIsEscaped: Story = {
  name: 'Markup is escaped',
  render: () => (
    <Stack className="gap-3.5">
      <Tags label="Tags" initial={['<script>alert(1)</script>', '<b>bold</b>']} />
      <Text variant="subhead" tone="muted">
        Tags are always plain text. What you type is exactly what shows.
      </Text>
    </Stack>
  ),
};

export const ALimit: Story = {
  name: 'A limit',
  render: function LimitStory() {
    const [tags, setTags] = useState<readonly string[]>([
      'Berlin',
      'London',
      'Paris',
      'Madrid',
      'Remote',
    ]);
    return (
      <TagsInput
        label="Locations"
        max={5}
        value={tags}
        onChange={setTags}
        hint={
          tags.length >= 5 ? '5 of 5. Remove one to add another.' : `${String(tags.length)} of 5.`
        }
      />
    );
  },
};

export const SizesAndStates: Story = {
  name: 'Sizes and states',
  render: () => (
    <Stack className="gap-2.5">
      <Tags label="Small" hideLabel size="sm" placeholder="Add a skill" initial={['Small']} />
      <Tags label="Default" hideLabel placeholder="Add a skill" initial={['Default']} />
      <Tags label="Disabled" hideLabel disabled placeholder="Add a skill" initial={['Disabled']} />
    </Stack>
  ),
};
