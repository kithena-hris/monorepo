import { useState } from 'react';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { fn } from 'storybook/test';

import { Badge } from '../badge/badge';
import { Card, CardContent, CardHeader, CardTitle } from '../card/card';
import { Dropzone } from './dropzone';

const meta = {
  title: 'Forms/Dropzone',
  component: Dropzone,
  parameters: {
    layout: 'padded',
    docs: {
      description: {
        component: [
          'The bare drop target: no queue, no progress, no validation UI. `FileUploader` is the full experience built on the same idea: reach for `Dropzone` when the drop **is** the interaction: a CSV onto an import screen, a photo onto a profile row, a payslip onto a case.',
          '',
          '### A drop target must also be a button',
          '',
          'Dragging a file is a pointer gesture with no keyboard equivalent, so the zone is a real `<button>` that opens the file picker. Without it the feature does not exist for anybody navigating by keyboard, and it is how most people on a trackpad prefer to do it anyway.',
          '',
          '### The counter, not the boolean',
          '',
          '`dragenter` and `dragleave` fire for **every child element** the pointer crosses, so a boolean flag makes the highlight flicker as the pointer moves over the contents. A depth counter fixes it: increment on enter, decrement on leave, highlight while it is above zero. This is the bug in most hand-rolled drop zones.',
          '',
          '### `preventDefault` on `dragover`',
          '',
          'Omit it and the browser navigates to the dropped file instead of handing it over, the single most common reason a drop target appears to do nothing.',
          '',
          '### `accept` is a filter, not a check',
          '',
          'It sets the picker’s filter and rejects obviously wrong drops early. That is a courtesy to the person, **not a security control**: an extension is a string somebody chose and a browser-reported MIME type is a guess. The server has to derive the real type from the bytes. During a drag the browser exposes only the MIME type, no name, no size, so extension rules cannot be judged until the drop, and the zone says so by staying neutral.',
        ].join('\n'),
      },
    },
  },
  argTypes: {
    label: { control: 'text', table: { category: 'Content' } },
    hint: { control: 'text', table: { category: 'Content' } },
    rejectMessage: { control: 'text', table: { category: 'Content' } },
    accept: { control: 'text', table: { category: 'Behaviour' } },
    multiple: { control: 'boolean', table: { category: 'Behaviour' } },
    disabled: { control: 'boolean', table: { category: 'Behaviour' } },
    variant: {
      control: 'inline-radio',
      options: ['panel', 'inline'],
      table: { defaultValue: { summary: "'panel'" }, category: 'Appearance' },
    },
    onFiles: { control: false, table: { category: 'Behaviour' } },
  },
  args: {
    label: 'Import employees',
    hint: 'CSV up to 10 MB',
    accept: '.csv,text/csv',
    onFiles: fn().mockName('onFiles(File[])'),
  },
} satisfies Meta<typeof Dropzone>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Playground: Story = {
  render: function PlaygroundStory(args) {
    const [names, setNames] = useState<string[]>([]);

    return (
      <Card className="max-w-lg">
        <CardHeader>
          <CardTitle>Import</CardTitle>
          {names.length > 0 ? <Badge size="sm">{names.length} received</Badge> : null}
        </CardHeader>
        <CardContent className="space-y-3">
          <Dropzone
            {...args}
            onFiles={(files) => {
              args.onFiles(files);
              setNames(files.map((file) => file.name));
            }}
          />
          <ul aria-live="polite" className="space-y-1 text-sm text-fg-muted">
            {names.length === 0 ? <li>Nothing dropped yet.</li> : null}
            {names.map((name) => (
              <li key={name}>{name}</li>
            ))}
          </ul>
        </CardContent>
      </Card>
    );
  },
};

export const Inline: Story = {
  name: 'Inline, in a row',
  args: {
    variant: 'inline',
    label: 'Attach a document',
    hint: 'PDF, PNG or JPEG',
    accept: '.pdf,image/*',
  },
  parameters: {
    docs: {
      description: {
        story:
          'A bar rather than a panel, for a drop target that sits inside a form row or a table cell. Same behaviour, a third of the height, a full panel next to a text input reads as the main event when it is a footnote.',
      },
    },
  },
  render: (args) => (
    <Card className="max-w-lg">
      <CardHeader>
        <CardTitle>Right to work</CardTitle>
      </CardHeader>
      <CardContent>
        <Dropzone {...args} />
      </CardContent>
    </Card>
  ),
};

export const Disabled: Story = {
  args: { disabled: true, hint: 'Import closes while a payroll run is open' },
  parameters: {
    docs: {
      description: {
        story:
          'Drops and clicks both refuse, and the hint says why. A disabled control with no explanation is a support ticket. The reason costs one line and saves the conversation.',
      },
    },
  },
  render: (args) => (
    <Card className="max-w-lg">
      <CardHeader>
        <CardTitle>Import</CardTitle>
      </CardHeader>
      <CardContent>
        <Dropzone {...args} />
      </CardContent>
    </Card>
  ),
};
