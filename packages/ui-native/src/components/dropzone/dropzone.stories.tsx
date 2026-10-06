import type { Meta, StoryObj } from '@storybook/react-native-web-vite';
import { useState } from 'react';

import { designDocs } from '../../docs/design.ts';
import { pickOf, sampleDocument } from '../../docs/files.ts';
import { Stack } from '../layout/layout.tsx';
import { Text } from '../text/text.tsx';
import { Dropzone, formatBytes, type PickedFile } from './dropzone.tsx';

const meta = {
  title: 'Forms/Dropzone',
  component: Dropzone,
  parameters: designDocs('dropzone'),
} satisfies Meta<typeof Dropzone>;

export default meta;
type Story = StoryObj;

const pick = pickOf(sampleDocument('contract-priya-shah.pdf', 'application/pdf', 2_200_000));

function Picked({ files }: { files: readonly PickedFile[] }): React.JSX.Element | null {
  if (!files.length) return null;
  return (
    <Text variant="footnote" tone="muted">
      {files.map((f) => `${f.name} · ${formatBytes(f.size)}`).join(', ')}
    </Text>
  );
}

export const Playground: Story = {
  render: function PlaygroundStory() {
    const [files, setFiles] = useState<readonly PickedFile[]>([]);
    return (
      <Stack className="gap-2.5">
        <Dropzone pick={pick} onFiles={setFiles} />
        <Dropzone pick={pick} onFiles={setFiles} over />
        <Picked files={files} />
      </Stack>
    );
  },
};

export const InlineInARow: Story = {
  name: 'Inline, in a row',
  render: function InlineStory() {
    const [files, setFiles] = useState<readonly PickedFile[]>([]);
    return (
      <Stack className="gap-2.5">
        <Dropzone
          variant="inline"
          label="Attach receipts"
          hint="PDF or image, up to 10 MB each"
          pick={pick}
          onFiles={setFiles}
        />
        <Picked files={files} />
      </Stack>
    );
  },
};

export const Disabled: Story = {
  render: () => (
    <Dropzone
      disabled
      hint="Uploads are closed for this payroll run"
      pick={pick}
      onFiles={() => undefined}
    />
  ),
};
