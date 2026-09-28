import type { Meta, StoryObj } from '@storybook/react-vite';
import { useState } from 'react';

import { Button } from '../button/button';
import { Card, CardContent, CardHeader, CardTitle } from '../card/card';
import { ImageUploader, type ImageUploadRejection, type UploadedImage } from './image-uploader';
import { AvatarUploader } from './image-uploader';

const meta = {
  title: 'Forms/ImageUploader',
  component: ImageUploader,
  parameters: {
    layout: 'padded',
    docs: {
      description: {
        component: [
          'Image upload: drop, browse, or paste.',
          '',
          '### The input is the control; the dropzone is decoration',
          '',
          'A `<div>` with `onDrop` is invisible to a keyboard and to a screen reader. Here a real `<input type="file">` does the work. It is what Tab reaches, what Space activates, what assistive tech announces, and what a mobile browser turns into *Take Photo or Choose from Library*. It is stretched over the zone at `opacity-0` rather than hidden with `sr-only`, so the whole area is clickable and it still keeps its place in the tab order.',
          '',
          'Dropping is a **shortcut**. Pasting is a shortcut. Neither is ever the only way in.',
          '',
          '### Validation here is the cheap half',
          '',
          "Type, size and dimensions are checked so the user hears about a 40 MB TIFF before it is uploaded rather than after. **None of it is a security control.** `accept` is a hint, the extension is a lie, and `File.type` comes from the client. The server re-checks the magic bytes, re-encodes, and strips EXIF, which is also what removes the GPS coordinates a phone put in an employee's profile photo.",
          '',
          '### Object URLs are revoked',
          '',
          '`URL.createObjectURL` pins the whole file in memory until it is revoked. A form where someone swaps a photo eight times leaks eight files. Every preview here is revoked when it is replaced, when it is removed, and on unmount.',
          '',
          '### Rejections are reported, never swallowed',
          '',
          'A file that silently does not appear is indistinguishable from a broken upload. Each rejection names the file and the reason, and the count goes through a live region, because a grid that did not change is not something a screen-reader user can notice.',
        ].join('\n'),
      },
    },
  },
  argTypes: {
    value: {
      description: 'The current files. Controlled, this component never holds the list.',
      control: false,
      table: { type: { summary: 'readonly UploadedImage[]' }, category: 'Data' },
    },
    onChange: {
      description: 'Fires with the new list, after validation.',
      control: false,
      table: { type: { summary: '(images: readonly UploadedImage[]) => void' }, category: 'Data' },
    },
    label: {
      description: 'Visible label. Required, a file input with no label is an unnamed button.',
      control: 'text',
      table: { type: { summary: 'string' }, category: 'Accessibility' },
    },
    hint: {
      description: 'Help text, wired through `aria-describedby`.',
      control: 'text',
      table: { type: { summary: 'ReactNode' }, category: 'Content' },
    },
    accept: {
      description:
        'MIME types. Feeds the picker and the first validation pass. **Not a security control.**',
      control: 'object',
      table: {
        type: { summary: 'readonly string[]' },
        defaultValue: { summary: "['image/png','image/jpeg','image/webp','image/avif']" },
        category: 'Validation',
      },
    },
    maxSize: {
      description: 'Bytes. Oversized files are reported by name and size, not dropped.',
      control: { type: 'number' },
      table: {
        type: { summary: 'number' },
        defaultValue: { summary: '5242880' },
        category: 'Validation',
      },
    },
    minDimensions: {
      description:
        'Pixel floor, measured after decode. The case a byte limit misses: a 4 kB 60×60 JPEG passes every size check and looks like porridge at 200px.',
      control: 'object',
      table: { type: { summary: '{ width: number; height: number }' }, category: 'Validation' },
    },
    multiple: {
      description: 'Accept several files. Switches the preview to a grid.',
      control: 'boolean',
      table: {
        type: { summary: 'boolean' },
        defaultValue: { summary: 'false' },
        category: 'Behaviour',
      },
    },
    maxFiles: {
      description: 'Upper bound on the list. Extra files are rejected with a reason.',
      control: { type: 'number' },
      table: {
        type: { summary: 'number' },
        defaultValue: { summary: '1, or 8 when multiple' },
        category: 'Behaviour',
      },
    },
    progress: {
      description:
        '0–100 while a file is in flight, or `null` when the length is unknown. Setting it at all replaces the dropzone with the bar.',
      control: { type: 'range', min: 0, max: 100 },
      table: { type: { summary: 'number | null' }, category: 'State' },
    },
    layout: {
      description:
        '`tiles`: square previews with their own remove button and upload ring, ending in an "Add" tile that is the file input. `list`: a dropzone with a card per image.',
      control: 'inline-radio',
      options: ['tiles', 'list'],
      table: {
        type: { summary: "'list' | 'tiles'" },
        defaultValue: { summary: 'list' },
        category: 'Appearance',
      },
    },
    aspect: {
      description:
        'Preview shape in the `list` layout. `square` for an avatar, `wide` for a banner.',
      control: 'inline-radio',
      options: ['square', 'wide', 'auto'],
      table: {
        type: { summary: "'square' | 'wide' | 'auto'" },
        defaultValue: { summary: 'auto' },
        category: 'Appearance',
      },
    },
    disabled: {
      control: 'boolean',
      table: {
        type: { summary: 'boolean' },
        defaultValue: { summary: 'false' },
        category: 'State',
      },
    },
    invalid: {
      description: 'Red border and `aria-invalid`. Pair it with a message the field points at.',
      control: 'boolean',
      table: {
        type: { summary: 'boolean' },
        defaultValue: { summary: 'false' },
        category: 'State',
      },
    },
    onReject: {
      description: 'Everything that failed validation, so the screen can explain or log it.',
      control: false,
      table: { type: { summary: '(rejections) => void' }, category: 'Behaviour' },
    },
    className: {
      control: 'text',
      table: { type: { summary: 'string' }, category: 'Escape hatches' },
    },
  },
  args: {
    label: 'Profile photo',
    hint: 'Shown in the directory and on the employee record.',
    multiple: false,
    maxSize: 5 * 1024 * 1024,
    disabled: false,
    invalid: false,
    aspect: 'auto',
    layout: 'tiles',
    value: [],
    onChange: () => undefined,
  },
} satisfies Meta<typeof ImageUploader>;

export default meta;
type Story = StoryObj<typeof meta>;

/**
 * A stand-in photograph: a sky, a sun and two hills, as an SVG data URI. The
 * stories run in Chromium with no network, so the image has to be inline.
 */
function samplePhoto(
  name: string,
  [sky, hill]: readonly [string, string],
  extra: Partial<UploadedImage> = {},
): UploadedImage {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 96 96"><rect width="96" height="96" fill="${sky}"/><circle cx="68" cy="30" r="10" fill="#fff" fill-opacity="0.8"/><path d="M0 70 30 44 56 66 74 52 96 68V96H0Z" fill="${hill}"/></svg>`;
  return {
    id: name,
    file: new File([svg], name, { type: 'image/svg+xml' }),
    previewUrl: `data:image/svg+xml,${encodeURIComponent(svg)}`,
    ...extra,
  };
}

const BLUE = ['#9cc3f0', '#3f6fb5'] as const;
const GREEN = ['#bfe3c8', '#3d8a5a'] as const;
const AMBER = ['#f6d9a8', '#b8741f'] as const;
const PLUM = ['#dcc6ee', '#7a4fa6'] as const;

export const Playground: Story = {
  render: function PlaygroundStory(args) {
    const [images, setImages] = useState<readonly UploadedImage[]>([]);
    return (
      <div className="max-w-md">
        <ImageUploader {...args} value={images} onChange={setImages} />
      </div>
    );
  },
};

export const Dropzone: Story = {
  name: 'As a dropzone',
  args: { layout: 'list' },
  parameters: {
    docs: {
      description: {
        story:
          'The `list` layout: a dropzone with a card per image under it, for a document scan where the file name and size matter as much as the picture.',
      },
    },
  },
  render: function DropzoneStory(args) {
    const [images, setImages] = useState<readonly UploadedImage[]>([]);
    return (
      <div className="max-w-md">
        <ImageUploader {...args} value={images} onChange={setImages} />
      </div>
    );
  },
};

export const Multiple: Story = {
  name: 'Several files',
  args: {
    multiple: true,
    maxFiles: 6,
    label: 'Office photos',
    hint: 'Shown on the careers page. Up to 6 images.',
  },
  parameters: {
    docs: {
      description: {
        story:
          'Each tile has its own remove button, and the "Add" tile at the end is the file input. Try adding four more: the seventh is rejected by name with the reason, because a file that silently vanishes reads as a broken upload.',
      },
    },
  },
  render: function MultiStory(args) {
    const [images, setImages] = useState<readonly UploadedImage[]>(() => [
      samplePhoto('lobby.jpg', BLUE),
      samplePhoto('garden.jpg', GREEN),
      samplePhoto('kitchen.jpg', AMBER),
    ]);
    return (
      <div className="max-w-2xl">
        <ImageUploader {...args} value={images} onChange={setImages} />
      </div>
    );
  },
};

export const Constrained: Story = {
  name: 'With a dimension floor',
  args: {
    label: 'Office photo',
    hint: 'At least 1200 × 800, so it stays sharp on the careers page.',
    minDimensions: { width: 1200, height: 800 },
  },
  parameters: {
    docs: {
      description: {
        story:
          'A byte limit does not catch a 4 kB 60×60 JPEG, it passes every size check and looks like porridge at 200px. The floor is enforced after decode, which is the only place the intrinsic size exists. In the tile layout a refused image stays on screen, ringed, until it is dismissed, so it is obvious which one was wrong. The one here is marked by the caller with `invalid`; drop a small image to see the uploader do it.',
      },
    },
  },
  render: function ConstrainedStory(args) {
    const [images, setImages] = useState<readonly UploadedImage[]>(() => [
      samplePhoto('office.jpg', PLUM, { invalid: true, width: 640, height: 480 }),
    ]);
    const [rejected, setRejected] = useState<readonly ImageUploadRejection[]>([]);
    const flagged = images.find((image) => image.invalid);

    return (
      <div className="max-w-md space-y-2">
        <ImageUploader
          {...args}
          multiple
          maxFiles={2}
          value={images}
          onChange={setImages}
          onReject={setRejected}
        />
        {flagged && rejected.length === 0 ? (
          <p className="text-sm text-danger-fg">
            {flagged.file.name} is 640 × 480. Use at least 1200 × 800.
          </p>
        ) : null}
      </div>
    );
  },
};

export const Uploading: Story = {
  name: 'In flight',
  args: { multiple: true, maxFiles: 6, label: 'Office photos', hint: undefined },
  parameters: {
    docs: {
      description: {
        story:
          'Each image carries its own `progress`, and its tile shows a ring over a dimmed preview until it lands. `null` spins while the request is still opening: a ring that creeps to 90% and stops made a promise the network could not keep. A tile in flight has no remove button.',
      },
    },
  },
  render: function UploadingStory(args) {
    const [images, setImages] = useState<readonly UploadedImage[]>(() => [
      samplePhoto('lobby.jpg', BLUE, { progress: 64 }),
      samplePhoto('terrace.jpg', PLUM, { progress: 22 }),
      samplePhoto('kitchen.jpg', AMBER),
    ]);
    return (
      <div className="max-w-md">
        <ImageUploader {...args} value={images} onChange={setImages} />
      </div>
    );
  },
};

export const ListUploading: Story = {
  name: 'In flight, as a dropzone',
  args: { layout: 'list' },
  parameters: {
    docs: {
      description: {
        story:
          'In the `list` layout one `progress` for the whole uploader replaces the dropzone with a bar. It starts **indeterminate** while the request is opening, and only becomes a percentage once bytes are actually moving.',
      },
    },
  },
  render: function ListUploadingStory(args) {
    const [images, setImages] = useState<readonly UploadedImage[]>([]);
    const [progress, setProgress] = useState<number | null | undefined>(undefined);

    const run = (): void => {
      setProgress(null);
      setTimeout(() => {
        let value = 0;
        const id = setInterval(() => {
          value += 7;
          setProgress(Math.min(100, value));
          if (value >= 100) {
            clearInterval(id);
            setTimeout(() => {
              setProgress(undefined);
            }, 500);
          }
        }, 120);
      }, 700);
    };

    return (
      <div className="max-w-md space-y-3">
        <ImageUploader
          {...args}
          value={images}
          onChange={setImages}
          {...(progress === undefined ? {} : { progress })}
        />
        <Button onClick={run} disabled={progress !== undefined}>
          Simulate an upload
        </Button>
      </div>
    );
  },
};

export const States: Story = {
  name: 'Invalid and disabled',
  parameters: {
    docs: {
      description: {
        story:
          'The invalid state pairs the red border with `aria-invalid` **and** a message, a colour alone is not a validation message. When the uploader itself refuses a file for its type, the "Add" tile says "Not an image" as well. Disabled says why, because an uploader that refuses files without explaining generates a support ticket.',
      },
    },
  },
  render: function StatesStory(args) {
    const [images, setImages] = useState<readonly UploadedImage[]>([]);
    return (
      <div className="grid max-w-4xl gap-6 grid-cols-[repeat(auto-fit,minmax(min(100%,16rem),1fr))]">
        <div className="space-y-1.5">
          <ImageUploader
            {...args}
            invalid
            label="Right-to-work document"
            hint="Required before the start date."
            value={images}
            onChange={setImages}
          />
          <p role="alert" className="text-sm text-danger-fg">
            notes.pdf is a PDF. Use PNG, JPG or WebP.
          </p>
        </div>
        <ImageUploader
          {...args}
          disabled
          label="Signed contract"
          hint="Locked once the contract is countersigned."
          value={[]}
          onChange={() => undefined}
        />
      </div>
    );
  },
};

export const Avatar: Story = {
  name: 'AvatarUploader',
  parameters: {
    docs: {
      description: {
        story:
          'The single-image case, as a round target beside the person it belongs to. There is no dropzone: the photo itself is the control, replacing is one click rather than remove-then-add, and the label is a real `<label htmlFor>` so the whole circle is the hit area.',
      },
    },
  },
  render: function AvatarStory() {
    const [images, setImages] = useState<readonly UploadedImage[]>([]);
    const [rejected, setRejected] = useState<ImageUploadRejection | null>(null);

    return (
      <Card className="max-w-lg">
        <CardHeader>
          <CardTitle>Grace Hopper</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <AvatarUploader
            label="Profile photo"
            hint="Square, at least 200×200. Visible to everyone in the directory."
            value={images}
            onChange={setImages}
            onReject={(rejections) => {
              setRejected(rejections[0] ?? null);
            }}
            fallback={<span className="text-md font-medium">GH</span>}
          />
          {rejected ? (
            <p role="alert" className="text-xs font-medium text-danger-fg">
              {rejected.message}
            </p>
          ) : null}
        </CardContent>
      </Card>
    );
  },
};

/**
 * A 1×1 transparent GIF, inline.
 *
 * Stories are rendered in Chromium by `pnpm test-stories` with no network, so a
 * remote URL would be a broken image in the one place the design system is
 * checked. This is the smallest thing that proves `src` renders.
 */
const STORED_IMAGE =
  'data:image/gif;base64,R0lGODlhAQABAIAAAMLCwgAAACH5BAAAAAAALAAAAAABAAEAAAICRAEAOw==';

export const AvatarShapes: Story = {
  name: 'AvatarUploader — shapes and ratios',
  parameters: {
    docs: {
      description: {
        story:
          'A circle crops to a disc, which is right for a face and wrong for a wordmark — half of one disappears. `shape="rounded"` keeps the corners, and `ratio="wide"` widens the target without changing its height, so two of these side by side line up whatever they are holding. `fit="contain"` is for a mark that should not be cropped at all.',
      },
    },
  },
  render: function ShapesStory() {
    const [logo, setLogo] = useState<readonly UploadedImage[]>([]);
    const [cover, setCover] = useState<readonly UploadedImage[]>([]);

    return (
      <Card className="max-w-2xl">
        <CardHeader>
          <CardTitle>Company images</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-6 grid-cols-[repeat(auto-fit,minmax(min(100%,16rem),1fr))]">
          <AvatarUploader
            label="Logo"
            hint="The mark, beside their name in lists."
            orientation="stacked"
            shape="rounded"
            ratio="square"
            fit="contain"
            value={logo}
            onChange={setLogo}
          />
          <AvatarUploader
            label="Company image"
            hint="Fills half their sign-in page."
            orientation="stacked"
            shape="rounded"
            ratio="wide"
            fit="cover"
            value={cover}
            onChange={setCover}
          />
        </CardContent>
      </Card>
    );
  },
};

export const AvatarStored: Story = {
  name: 'AvatarUploader — an already-stored image',
  parameters: {
    docs: {
      description: {
        story:
          '`src` shows an image the component is not holding — one already uploaded, or loaded from a previous visit. Without it a caller whose value lives on a server had to swap the whole component out for a different layout once an upload finished, which read as the picker disappearing. Replace and Remove are offered for a stored image exactly as they are for a picked one; a locally picked file takes precedence, because it is what the person just did.',
      },
    },
  },
  render: function StoredStory() {
    const [images, setImages] = useState<readonly UploadedImage[]>([]);
    const [stored, setStored] = useState<string | null>(STORED_IMAGE);

    return (
      <Card className="max-w-lg">
        <CardHeader>
          <CardTitle>Acme Corp</CardTitle>
        </CardHeader>
        <CardContent>
          <AvatarUploader
            label="Logo"
            hint="Already uploaded. Replacing it uploads a new one."
            shape="rounded"
            fit="contain"
            src={stored}
            value={images}
            onChange={(next) => {
              setImages(next);
              // Clearing both is the caller's job: the component reports the
              // change and does not know where the stored copy came from.
              if (next.length === 0) setStored(null);
            }}
          />
        </CardContent>
      </Card>
    );
  },
};

export const AvatarPhotoIsTheControl: Story = {
  name: 'AvatarUploader — the photo is the control',
  parameters: {
    docs: {
      description: {
        story:
          'On hover or focus the photo shows "Change". On touch, tapping it opens the options. There is no separate button to find: the thing you want to change is the thing you press.',
      },
    },
  },
  render: function PhotoControlStory() {
    const [images, setImages] = useState<readonly UploadedImage[]>([]);
    return (
      <AvatarUploader
        label="Profile photo"
        hint="Square works best. At least 400 × 400."
        src={STORED_IMAGE}
        value={images}
        onChange={setImages}
      />
    );
  },
};
