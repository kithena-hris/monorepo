import type { Meta, StoryObj } from '@storybook/react-native-web-vite';
import { AtSign, Paperclip, Smile } from 'lucide-react-native';
import { useState } from 'react';
import { Text as CssText, View } from 'react-native-css/components';

import { designDocs } from '../../docs/design.ts';
import { Button } from '../button/button.tsx';
import { Field, FieldError } from '../field/field.tsx';
import { Icon } from '../icon/icon.tsx';
import { Inline, Stack } from '../layout/layout.tsx';
import { Text } from '../text/text.tsx';
import { RichTextEditor } from './rich-text-editor.tsx';
import { textOf } from './text.ts';

const meta = {
  title: 'Forms/RichTextEditor',
  component: RichTextEditor,
  parameters: designDocs('rich-text-editor'),
} satisfies Meta<typeof RichTextEditor>;

export default meta;
type Story = StoryObj;

export const Playground: Story = {
  render: () => (
    <RichTextEditor
      label="Welcome note"
      value="<p>Welcome to the team, <strong>Lucas</strong>! Your first week:</p><ul><li><p>Laptop pickup on Monday</p></li><li><p>Lunch with Tom on Wednesday</p></li></ul>"
      minHeight={140}
    />
  ),
};

export const ACommentBox: Story = {
  name: 'A comment box',
  render: function CommentStory() {
    const [html, setHtml] = useState('');
    const empty = textOf(html).trim() === '';
    return (
      <RichTextEditor
        label="Comment"
        placeholder="Add a comment…"
        toolbar={[]}
        minHeight={64}
        onChange={setHtml}
        footer={
          <>
            <Inline className="gap-0.5">
              <Button
                variant="ghost"
                size="xs"
                accessibilityLabel="Mention someone"
                startIcon={<Icon icon={AtSign} size={16} tone="muted" />}
              />
              <Button
                variant="ghost"
                size="xs"
                accessibilityLabel="Attach a file"
                startIcon={<Icon icon={Paperclip} size={16} tone="muted" />}
              />
              <Button
                variant="ghost"
                size="xs"
                accessibilityLabel="Add an emoji"
                startIcon={<Icon icon={Smile} size={16} tone="muted" />}
              />
            </Inline>
            <Button size="sm" variant="primary" disabled={empty}>
              Comment
            </Button>
          </>
        }
      />
    );
  },
};

export const EveryGroup: Story = {
  name: 'Every group',
  render: () => (
    <RichTextEditor
      label="Policy"
      toolbar={['history', 'headings', 'inline', 'lists', 'align', 'blocks', 'link']}
      minHeight={60}
    />
  ),
};

export const NoToolbar: Story = {
  name: 'No toolbar',
  render: () => (
    <Stack className="gap-2">
      <RichTextEditor
        label="Note"
        toolbar={[]}
        minHeight={80}
        value="<p>Select text to format it. Shortcuts still work: <strong>⌘B</strong>, <em>⌘I</em>.</p>"
      />
      <Text variant="subhead" tone="muted">
        With no toolbar, a hardware keyboard’s shortcuts still format the text.
      </Text>
    </Stack>
  ),
};

export const InvalidDisabledAndReadOnly: Story = {
  name: 'Invalid, disabled and read-only',
  render: () => (
    <Stack className="gap-2.5">
      <Field invalid>
        <RichTextEditor
          label="Reason for leaving"
          toolbar={[]}
          minHeight={48}
          placeholder="Reason for leaving"
        />
        <FieldError>Add a reason before you submit.</FieldError>
      </Field>
      <RichTextEditor label="Notes, locked" disabled minHeight={48} />
      <RichTextEditor
        label="Approval"
        readOnly
        minHeight={48}
        value="<p>Approved by <strong>Nora Becker</strong> on 3 Oct.</p>"
      />
    </Stack>
  ),
};

export const WhatItStores: Story = {
  name: 'What it stores, and how it reads back',
  render: function StoresStory() {
    const initial =
      '<p>Hello <strong>team</strong>, see <a target="_blank" rel="noopener noreferrer nofollow" href="https://reach.co/policy">the policy</a>.</p>';
    const [html, setHtml] = useState(initial);
    return (
      <Stack className="gap-3">
        <RichTextEditor
          label="Announcement"
          toolbar={[]}
          minHeight={80}
          value={initial}
          onChange={setHtml}
        />
        <View className="rounded-[14px] bg-surface-sunken p-3.5">
          <CssText
            accessibilityLabel="Stored HTML"
            className="font-mono text-[12px] leading-[1.6] text-fg-muted"
          >
            {html}
          </CssText>
        </View>
      </Stack>
    );
  },
};
