import type { Meta, StoryObj } from '@storybook/react-vite';
import { useState } from 'react';

import { Button } from '../button/button';
import { Card, CardContent, CardHeader, CardTitle } from '../card/card';
import { Alert } from '../feedback/feedback';
import { FileUploader, type FileRejection, type UploadItem } from './file-uploader';

/** A stand-in `File`, so the stories have something to show without a picker. */
function fakeFile(name: string, bytes: number, type = 'application/pdf'): File {
  const file = new File(['x'], name, { type });
  Object.defineProperty(file, 'size', { value: bytes });
  return file;
}

const meta = {
  title: 'Forms/FileUploader',
  component: FileUploader,
  parameters: {
    layout: 'padded',
    docs: {
      description: {
        component: [
          'File upload, for anything.',
          '',
          '### Security: what this does, and what it explicitly does not',
          '',
          'Everything here is a **usability** filter. None of it is a security control, and treating it as one is how a malicious file reaches a server.',
          '',
          '| Check | Why it is not security |',
          '| --- | --- |',
          '| `accept` | A hint to the picker. Switchable off in the dialog, and a drop bypasses it entirely. |',
          '| `File.type` | Derived from the extension by the browser. Renaming `payload.exe` to `payload.pdf` changes it. |',
          '| `maxSize` | Runs after the whole file is already in memory here, and says nothing about the contents. |',
          '',
          'The server re-derives the type from the **magic bytes**, enforces the size at the connection, stores the file outside the web root under a **generated** name, and serves it back with `Content-Disposition: attachment` and a restrictive `Content-Type`. This component stops a 40 MB TIFF before it is uploaded; it does not stop an attacker.',
          '',
          'Two things it *does* do, because they are display concerns and so genuinely its business:',
          '',
          '- **Filenames render as text.** `<img onerror>` in a name is shown, not run.',
          "- **Path segments are stripped from the displayed name.** A directory upload or a hostile client can hand back `././etc/passwd`, and echoing that into the interface misrepresents what was uploaded. The `File` itself is untouched: naming the *stored* file is the server's decision.",
          '',
          'Links to a finished upload carry `rel="noopener noreferrer"` and open in a new tab: an uploaded file is untrusted content served from your own origin.',
          '',
          '### Accessibility',
          '',
          'A real `<input type="file">` does the work. It is what Tab reaches, what Space activates, what assistive tech announces, and what a phone turns into a camera. The drop zone sits behind it at `opacity-0` and is decoration; dropping is a shortcut, never the only way in.',
          '',
          'Each file is a list item with its own status and its own labelled controls. *"Remove contract.pdf"*, never *"Remove"*. Forty identically-named buttons is forty identical rows in a screen reader\'s control list. Additions, rejections, completions and failures all pass through one polite live region.',
          '',
          '### Controlled, always',
          '',
          "The list is yours. `onAccepted` hands you the files that passed so you can start the upload; you set `status`, `progress`, `error` and `url` as it goes. The component never uploads anything itself, because retry, cancellation and auth are all the caller's problem.",
        ].join('\n'),
      },
    },
  },
  argTypes: {
    value: {
      control: false,
      table: { type: { summary: 'readonly UploadItem[]' }, category: 'Data' },
    },
    onChange: {
      control: false,
      table: { type: { summary: '(items: readonly UploadItem[]) => void' }, category: 'Data' },
    },
    onAccepted: {
      description: 'The files that passed validation. Start the upload here.',
      control: false,
      table: { type: { summary: '(files: readonly File[]) => void' }, category: 'Data' },
    },
    onReject: {
      description: 'Everything refused, with a reason. Never silently dropped.',
      control: false,
      table: {
        type: { summary: '(rejections: readonly FileRejection[]) => void' },
        category: 'Data',
      },
    },
    onRetry: {
      description: 'Shows a retry control on a failed row. Without it, a failure is a dead end.',
      control: false,
      table: { type: { summary: '(item: UploadItem) => void' }, category: 'Data' },
    },
    onRemove: {
      description: 'Fires before the item leaves the list: abort the in-flight request here.',
      control: false,
      table: { type: { summary: '(item: UploadItem) => void' }, category: 'Data' },
    },
    label: { control: 'text', table: { type: { summary: 'string' }, category: 'Accessibility' } },
    hint: { control: 'text', table: { type: { summary: 'ReactNode' }, category: 'Content' } },
    accept: {
      description:
        'MIME types or extensions. `["application/pdf", ".csv"]`. **A hint, not a control.**',
      control: 'object',
      table: { type: { summary: 'readonly string[]' }, category: 'Validation' },
    },
    maxSize: {
      description: 'Bytes, per file.',
      control: { type: 'number' },
      table: {
        type: { summary: 'number' },
        defaultValue: { summary: '10485760' },
        category: 'Validation',
      },
    },
    maxTotalSize: {
      description: 'Bytes, across the list. The limit a server actually enforces.',
      control: { type: 'number' },
      table: { type: { summary: 'number' }, category: 'Validation' },
    },
    maxFiles: {
      control: { type: 'number' },
      table: {
        type: { summary: 'number' },
        defaultValue: { summary: '10' },
        category: 'Validation',
      },
    },
    validate: {
      description: 'Extra per-file check. Return a message to reject.',
      control: false,
      table: { type: { summary: '(file: File) => string | null' }, category: 'Validation' },
    },
    multiple: {
      control: 'boolean',
      table: {
        type: { summary: 'boolean' },
        defaultValue: { summary: 'true' },
        category: 'Behaviour',
      },
    },
    variant: {
      description: '`dropzone` is the full target; `button` is one control for a toolbar or a row.',
      control: 'inline-radio',
      options: ['dropzone', 'button'],
      table: {
        type: { summary: "'dropzone' | 'button'" },
        defaultValue: { summary: 'dropzone' },
        category: 'Appearance',
      },
    },
    disabled: { control: 'boolean', table: { type: { summary: 'boolean' }, category: 'State' } },
    invalid: { control: 'boolean', table: { type: { summary: 'boolean' }, category: 'State' } },
    className: {
      control: 'text',
      table: { type: { summary: 'string' }, category: 'Escape hatches' },
    },
  },
  args: {
    label: 'Supporting documents',
    hint: 'Contracts, right-to-work scans, signed policies.',
    accept: ['application/pdf', '.doc', '.docx', 'image/*'],
    maxSize: 10 * 1024 * 1024,
    maxFiles: 5,
    multiple: true,
    variant: 'dropzone',
    disabled: false,
    invalid: false,
    value: [],
    onChange: () => undefined,
  },
} satisfies Meta<typeof FileUploader>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Playground: Story = {
  render: function PlaygroundStory(args) {
    const [items, setItems] = useState<readonly UploadItem[]>([]);
    return (
      <div className="max-w-lg">
        <FileUploader {...args} value={items} onChange={setItems} />
      </div>
    );
  },
};

export const Uploading: Story = {
  name: 'Uploading, failing, retrying',
  parameters: {
    docs: {
      description: {
        story: [
          'The whole lifecycle, faked. Press the button to add three files and watch them go.',
          '',
          'The second one fails on purpose. Note what a failed row does: it says what went wrong, keeps the file in the list, and offers **Retry**, a failure with no way forward is a dead end that ends in a support ticket. The remove control on an in-flight row says *Cancel*, and `onRemove` fires before the item leaves so the request can actually be aborted.',
          '',
          'Uploads start **indeterminate**: until the request is open there is no total to divide by, and a bar that creeps to 90% and stops made a promise the network could not keep.',
        ].join('\n'),
      },
    },
  },
  render: function UploadingStory(args) {
    const [items, setItems] = useState<readonly UploadItem[]>([]);

    const start = (): void => {
      const seeded: UploadItem[] = [
        {
          id: '1',
          file: fakeFile('employment-contract.pdf', 842_000),
          status: 'uploading',
          progress: null,
        },
        {
          id: '2',
          file: fakeFile('right-to-work.jpg', 2_400_000, 'image/jpeg'),
          status: 'uploading',
          progress: null,
        },
        {
          id: '3',
          file: fakeFile('policy-ack.docx', 121_000),
          status: 'uploading',
          progress: null,
        },
      ];
      setItems(seeded);

      let tick = 0;
      const timer = setInterval(() => {
        tick += 6;
        setItems((current) =>
          current.map((item, index) => {
            if (item.status !== 'uploading') return item;
            const progress = Math.min(100, tick - index * 12);
            if (progress < 0) return item;
            if (progress < 100) return { ...item, progress };
            // The second file fails, so the story shows the path that matters.
            return index === 1
              ? {
                  ...item,
                  status: 'error' as const,
                  error: 'The server rejected this file: the contents are not a JPEG.',
                }
              : { ...item, status: 'done' as const, progress: 100, url: '#' };
          }),
        );
        if (tick > 140) clearInterval(timer);
      }, 140);
    };

    return (
      <div className="max-w-lg space-y-3">
        <FileUploader
          {...args}
          value={items}
          onChange={setItems}
          onRetry={(item) => {
            setItems((current) =>
              current.map((entry) =>
                entry.id === item.id
                  ? { id: entry.id, file: entry.file, status: 'uploading', progress: null }
                  : entry,
              ),
            );
            setTimeout(() => {
              setItems((current) =>
                current.map((entry) =>
                  entry.id === item.id
                    ? { ...entry, status: 'done', progress: 100, url: '#' }
                    : entry,
                ),
              );
            }, 900);
          }}
        />
        <Button onClick={start}>Simulate three uploads</Button>
      </div>
    );
  },
};

export const Rejections: Story = {
  name: 'Everything refused says why',
  parameters: {
    docs: {
      description: {
        story:
          'Try a `.exe`, a file over the size limit, the same file twice, and a sixth file. Each refusal names the file and the reason, a file that silently does not appear is indistinguishable from a broken upload, and the user will simply try again.',
      },
    },
  },
  render: function RejectionStory(args) {
    const [items, setItems] = useState<readonly UploadItem[]>([]);
    const [refused, setRefused] = useState<readonly FileRejection[]>([]);

    return (
      <div className="max-w-lg space-y-3">
        <FileUploader
          {...args}
          value={items}
          onChange={setItems}
          onReject={setRefused}
          maxSize={512 * 1024}
          maxTotalSize={2 * 1024 * 1024}
          maxFiles={5}
          validate={(file) =>
            file.name.startsWith('~$') ? `${file.name} is a temporary Office lock file.` : null
          }
        />
        {refused.length > 0 ? (
          <Alert tone="warning" title={`${String(refused.length)} refused`}>
            <ul className="list-disc ps-4">
              {refused.map((rejection) => (
                <li key={`${rejection.file.name}-${rejection.reason}`}>{rejection.message}</li>
              ))}
            </ul>
          </Alert>
        ) : null}
      </div>
    );
  },
};

export const SingleFile: Story = {
  name: 'One file, as a button',
  args: {
    variant: 'button',
    multiple: false,
    maxFiles: 1,
    label: 'Signed contract',
    hint: 'PDF only. Replaces whatever is attached.',
    accept: ['application/pdf'],
  },
  parameters: {
    docs: {
      description: {
        story:
          'For a toolbar or a table row, where a full drop zone would dominate a screen it is not the subject of. The input is still the control. It is `sr-only` here and driven by a `<label>`, so Tab reaches it and the phone still offers the camera.',
      },
    },
  },
  render: function SingleStory(args) {
    const [items, setItems] = useState<readonly UploadItem[]>([]);
    return (
      <Card className="max-w-md">
        <CardHeader>
          <CardTitle>Grace Hopper: onboarding</CardTitle>
        </CardHeader>
        <CardContent>
          <FileUploader {...args} value={items} onChange={setItems} />
        </CardContent>
      </Card>
    );
  },
};

export const Filenames: Story = {
  name: 'Hostile filenames',
  parameters: {
    docs: {
      description: {
        story: [
          'Three names that would each cause a problem somewhere. All three are rendered as characters and shown with their path stripped.',
          '',
          'What the component **cannot** do is protect the next boundary. That first name still needs escaping if it reaches an HTML email; the third still needs quoting before it becomes a `Content-Disposition` header or a filename on disk. A component escapes what it renders. It has no idea what you will do with the value afterwards.',
        ].join('\n'),
      },
    },
  },
  render: function FilenameStory(args) {
    const [items, setItems] = useState<readonly UploadItem[]>([
      {
        id: 'a',
        file: fakeFile('<img src=x onerror=alert(1)>.pdf', 84_000),
        status: 'done',
        url: '#',
      },
      { id: 'b', file: fakeFile('../../etc/passwd', 1_200), status: 'done', url: '#' },
      {
        id: 'c',
        file: fakeFile('report";rm -rf /.csv', 4_800, 'text/csv'),
        status: 'done',
        url: '#',
      },
    ]);

    return (
      <div className="max-w-lg space-y-3">
        <FileUploader {...args} value={items} onChange={setItems} label="Uploaded" hint="" />
        <Alert tone="info" title="What you are looking at">
          The second row was <code className="font-mono text-xs">../../etc/passwd</code> and is
          displayed as <code className="font-mono text-xs">passwd</code>. The original `File` is
          untouched: naming the stored file is the server&rsquo;s decision, not this
          component&rsquo;s.
        </Alert>
      </div>
    );
  },
};

export const States: Story = {
  name: 'Disabled, invalid and full',
  render: function StatesStory(args) {
    const full: UploadItem[] = [
      { id: '1', file: fakeFile('contract.pdf', 842_000), status: 'done', url: '#' },
    ];
    return (
      <div className="grid max-w-4xl gap-6 md:grid-cols-3">
        <div className="space-y-1.5">
          <FileUploader
            {...args}
            invalid
            label="Required"
            hint="A signed contract is required before the start date."
            value={[]}
            onChange={() => undefined}
          />
          <p role="alert" className="text-xs font-medium text-danger-fg">
            Attach the signed contract.
          </p>
        </div>
        <FileUploader
          {...args}
          disabled
          label="Locked"
          hint="Locked once the contract is countersigned."
          value={[]}
          onChange={() => undefined}
        />
        <FileUploader
          {...args}
          label="At the limit"
          hint="One file only."
          maxFiles={1}
          multiple={false}
          value={full}
          onChange={() => undefined}
        />
      </div>
    );
  },
};
