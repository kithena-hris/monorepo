import type { Meta, StoryObj } from '@storybook/react-native-web-vite';
import { useState } from 'react';

import { designDocs } from '../../docs/design.ts';
import { pickOf, sampleDocument, samplePhoto } from '../../docs/files.ts';
import { Stack } from '../layout/layout.tsx';
import { FileUploader, type UploadItem } from './file-uploader.tsx';

const meta = {
  title: 'Forms/FileUploader',
  component: FileUploader,
  parameters: designDocs('file-uploader'),
} satisfies Meta<typeof FileUploader>;

export default meta;
type Story = StoryObj;

const MB = 1024 * 1024;
const DOCUMENTS = ['application/pdf', 'image/png', 'image/jpeg'];

const item = (
  name: string,
  type: string,
  size: number,
  extra: Partial<UploadItem> = {},
): UploadItem => ({
  id: name,
  name,
  type,
  size,
  status: 'done',
  ...extra,
});

/** Stands in for the app's uploads: whatever is accepted lands as done. */
function useUploads(initial: readonly UploadItem[]): {
  items: readonly UploadItem[];
  setItems: React.Dispatch<React.SetStateAction<readonly UploadItem[]>>;
  finish: (accepted: readonly UploadItem[]) => void;
  remove: (gone: UploadItem) => void;
  retry: (again: UploadItem) => void;
} {
  const [items, setItems] = useState(initial);
  return {
    items,
    setItems,
    finish: (accepted) => {
      const ids = new Set(accepted.map((a) => a.id));
      setItems((current) =>
        current.map((i) => (ids.has(i.id) ? { ...i, status: 'done' as const } : i)),
      );
    },
    remove: (gone) => {
      setItems((current) => current.filter((i) => i.id !== gone.id));
    },
    retry: (again) => {
      setItems((current) =>
        current.map((i) =>
          i.id === again.id
            ? {
                id: i.id,
                name: i.name,
                type: i.type,
                size: i.size,
                status: 'uploading' as const,
                progress: 10,
              }
            : i,
        ),
      );
    },
  };
}

export const Playground: Story = {
  render: function PlaygroundStory() {
    const u = useUploads([item('contract-priya-shah.pdf', 'application/pdf', 2.1 * MB)]);
    return (
      <FileUploader
        accept={DOCUMENTS}
        maxSize={10 * MB}
        value={u.items}
        onChange={u.setItems}
        onAccepted={u.finish}
        onRemove={u.remove}
        pick={pickOf(sampleDocument('offer-letter.pdf', 'application/pdf', 480 * 1024))}
      />
    );
  },
};

export const UploadingFailingRetrying: Story = {
  name: 'Uploading, failing, retrying',
  render: function FailingStory() {
    const u = useUploads([
      item('passport.jpg', 'image/jpeg', 1.9 * MB, {
        status: 'uploading',
        progress: 62,
        uri: samplePhoto(1),
        meta: '1.2 of 1.9 MB · 4 s left',
      }),
      item('payslip-august.pdf', 'application/pdf', 310 * 1024, {
        status: 'error',
        error: 'Upload failed: the connection dropped.',
      }),
      item('offer-letter.pdf', 'application/pdf', 480 * 1024),
    ]);
    return <FileUploaderRows u={u} />;
  },
};

/** The rows alone: the design shows them without the target above. */
function FileUploaderRows({ u }: { u: ReturnType<typeof useUploads> }): React.JSX.Element {
  return (
    <FileUploader
      accept={DOCUMENTS}
      value={u.items}
      onChange={u.setItems}
      onRetry={u.retry}
      onRemove={u.remove}
      variant="button"
      label="Add a file"
      hint="PDF, PNG or JPG"
      pick={pickOf(sampleDocument('id-card.pdf', 'application/pdf', 900 * 1024))}
    />
  );
}

export const EverythingRefusedSaysWhy: Story = {
  name: 'Everything refused says why',
  render: function RefusedStory() {
    const u = useUploads([
      item('holiday.mov', 'video/quicktime', 84 * MB, {
        status: 'refused',
        error: 'Videos aren’t accepted. Use PDF, PNG or JPG.',
      }),
      item('scan-all-pages.pdf', 'application/pdf', 38 * MB, {
        status: 'refused',
        error: '38 MB is over the 10 MB limit.',
      }),
      item('contract.pdf', 'application/pdf', 1.2 * MB, {
        status: 'refused',
        error: 'Already uploaded on 2 Sep.',
      }),
    ]);
    return (
      <FileUploader
        accept={DOCUMENTS}
        maxSize={10 * MB}
        validate={(file) => (file.name === 'contract.pdf' ? 'Already uploaded on 2 Sep.' : null)}
        value={u.items}
        onChange={u.setItems}
        onAccepted={u.finish}
        onRemove={u.remove}
        pick={pickOf(
          sampleDocument('holiday.mov', 'video/quicktime', 84 * MB),
          sampleDocument('scan-all-pages.pdf', 'application/pdf', 38 * MB),
          sampleDocument('contract.pdf', 'application/pdf', 1.2 * MB),
        )}
      />
    );
  },
};

export const OneFileAsAButton: Story = {
  name: 'One file, as a button',
  render: function OneStory() {
    const u = useUploads([item('cv-lucas-moreau.pdf', 'application/pdf', 820 * 1024)]);
    return (
      <FileUploader
        variant="button"
        label="Upload CV"
        hint="PDF, up to 5 MB"
        accept={['application/pdf']}
        maxSize={5 * MB}
        multiple={false}
        value={u.items}
        onChange={u.setItems}
        onAccepted={u.finish}
        onRemove={u.remove}
        pick={pickOf(sampleDocument('cv-lucas-moreau-2026.pdf', 'application/pdf', 760 * 1024))}
      />
    );
  },
};

export const HostileFilenames: Story = {
  name: 'Hostile filenames',
  render: function HostileStory() {
    const u = useUploads([
      item('<img src=x onerror=alert(1)>.pdf', 'application/pdf', 120 * 1024, {
        meta: 'Shown as plain text',
      }),
      item('invoice.pdf.exe', 'application/pdf', 2 * MB, {
        status: 'refused',
        error: 'Blocked: this is a program, not a PDF.',
      }),
      item(
        'a-very-long-file-name-that-keeps-going-and-going-until-it-truncates.pdf',
        'application/pdf',
        640 * 1024,
        { meta: 'Truncated in the middle' },
      ),
    ]);
    return (
      <FileUploader
        variant="button"
        label="Add a file"
        hint="Names are shown as text"
        value={u.items}
        onChange={u.setItems}
        onRemove={u.remove}
        pick={pickOf(sampleDocument('../../etc/passwd.pdf', 'application/pdf', 1024))}
      />
    );
  },
};

export const DisabledInvalidAndFull: Story = {
  name: 'Disabled, invalid and full',
  render: function StatesStory() {
    const off = useUploads([]);
    const missing = useUploads([]);
    const full = useUploads(
      ['a', 'b', 'c', 'd', 'e'].map((n) => item(`receipt-${n}.pdf`, 'application/pdf', 200 * 1024)),
    );
    return (
      <Stack className="gap-2.5">
        <FileUploader
          compact
          disabled
          hint="Uploads are off while payroll runs"
          value={off.items}
          onChange={off.setItems}
          pick={pickOf()}
          label="Choose files"
        />
        <FileUploader
          compact
          error="Add at least one receipt."
          value={missing.items}
          onChange={missing.setItems}
          onAccepted={missing.finish}
          pick={pickOf(sampleDocument('receipt.pdf', 'application/pdf', 300 * 1024))}
          label="Choose files"
        />
        <FullRow u={full} />
      </Stack>
    );
  },
};

/** Five of five: the target says so and steps aside; the rows are elsewhere on the screen. */
function FullRow({ u }: { u: ReturnType<typeof useUploads> }): React.JSX.Element {
  return (
    <FileUploader
      maxFiles={5}
      value={u.items}
      onChange={u.setItems}
      onRemove={u.remove}
      pick={pickOf()}
      label="Choose files"
    />
  );
}
