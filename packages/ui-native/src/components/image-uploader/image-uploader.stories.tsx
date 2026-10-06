import type { Meta, StoryObj } from '@storybook/react-native-web-vite';
import { useState } from 'react';

import { designDocs } from '../../docs/design.ts';
import { pickOf, sampleDocument, sampleImage, samplePhoto } from '../../docs/files.ts';
import { Inline, Stack } from '../layout/layout.tsx';
import { Text } from '../text/text.tsx';
import { AvatarUploader, ImageUploader, type UploadedImage } from './image-uploader.tsx';

const meta = {
  title: 'Forms/ImageUploader',
  component: ImageUploader,
  parameters: designDocs('image-uploader'),
} satisfies Meta<typeof ImageUploader>;

export default meta;
type Story = StoryObj;

const stored = (
  name: string,
  index: number,
  extra: Partial<UploadedImage> = {},
): UploadedImage => ({
  id: name,
  uri: samplePhoto(index),
  name,
  ...extra,
});

export const Playground: Story = {
  render: function PlaygroundStory() {
    const [images, setImages] = useState<readonly UploadedImage[]>([]);
    return (
      <ImageUploader
        label="Office photo"
        value={images}
        onChange={setImages}
        pick={pickOf(sampleImage('office.jpg', 1))}
      />
    );
  },
};

export const SeveralFiles: Story = {
  name: 'Several files',
  render: function SeveralStory() {
    const [images, setImages] = useState<readonly UploadedImage[]>([
      stored('kitchen.jpg', 1),
      stored('desks.jpg', 2),
      stored('terrace.jpg', 3),
    ]);
    return (
      <ImageUploader
        label="Office photos"
        multiple
        maxFiles={6}
        value={images}
        onChange={setImages}
        pick={pickOf(sampleImage('lobby.jpg', 4))}
      />
    );
  },
};

export const WithADimensionFloor: Story = {
  name: 'With a dimension floor',
  render: function FloorStory() {
    const [images, setImages] = useState<readonly UploadedImage[]>([
      stored('office.jpg', 4, { invalid: true, width: 640, height: 480 }),
    ]);
    const small = images.find((i) => i.invalid);
    return (
      <ImageUploader
        label="Cover photo"
        minDimensions={{ width: 1200, height: 800 }}
        value={images}
        onChange={setImages}
        error={small ? 'office.jpg is 640 × 480. Use at least 1200 × 800.' : undefined}
        addLabel=""
        pick={pickOf(sampleImage('office-wide.jpg', 2))}
      />
    );
  },
};

export const InFlight: Story = {
  name: 'In flight',
  render: function FlightStory() {
    const [images, setImages] = useState<readonly UploadedImage[]>([
      stored('desks.jpg', 1, { progress: 64 }),
      stored('lobby.jpg', 5, { progress: 22 }),
      stored('terrace.jpg', 2),
    ]);
    return (
      <ImageUploader
        label="Office photos"
        multiple
        maxFiles={3}
        value={images}
        onChange={setImages}
        pick={pickOf()}
      />
    );
  },
};

export const InvalidAndDisabled: Story = {
  name: 'Invalid and disabled',
  render: function InvalidStory() {
    const [images, setImages] = useState<readonly UploadedImage[]>([]);
    return (
      <Inline className="flex-nowrap items-start gap-2.5">
        <ImageUploader
          className="flex-1"
          label="Badge photo"
          invalid
          error="notes.pdf is a PDF. Use PNG, JPG or WebP."
          addLabel="Not an image"
          value={images}
          onChange={setImages}
          pick={pickOf(sampleDocument('notes.pdf', 'application/pdf', 220_000))}
        />
        <ImageUploader
          label="Badge photo, locked"
          disabled
          addLabel="Disabled"
          value={[]}
          onChange={() => undefined}
          pick={pickOf()}
        />
      </Inline>
    );
  },
};

export const Avatar: Story = {
  name: 'AvatarUploader',
  render: function AvatarStory() {
    const [src, setSrc] = useState<string | null>(null);
    return (
      <AvatarUploader
        name="Priya Shah"
        src={src}
        pick={pickOf(sampleImage('priya.jpg', 0))}
        onPick={(file) => {
          setSrc(file.uri);
        }}
        onRemove={() => {
          setSrc(null);
        }}
      />
    );
  },
};

export const AvatarShapes: Story = {
  name: 'AvatarUploader — shapes and ratios',
  render: function ShapesStory() {
    const [srcs, setSrcs] = useState<Record<string, string>>({
      person: samplePhoto(1),
      team: samplePhoto(1),
      cover: samplePhoto(1),
    });
    const set = (key: string) => (file: { uri: string }) => {
      setSrcs({ ...srcs, [key]: file.uri });
    };
    const pick = pickOf(sampleImage('new.jpg', 2));
    return (
      <Stack className="gap-3">
        <Inline className="items-center gap-3">
          {(
            [
              ['person', 'circle', 'square', 'Priya Shah'],
              ['team', 'rounded', 'square', 'Design team'],
              ['cover', 'rounded', 'wide', 'Team cover'],
            ] as const
          ).map(([key, shape, ratio, name]) => (
            <AvatarUploader
              key={key}
              name={name}
              size={80}
              shape={shape}
              ratio={ratio}
              src={srcs[key] ?? null}
              pick={pick}
              controls="photo"
              onPick={set(key)}
            />
          ))}
        </Inline>
        <Text variant="subhead" tone="muted">
          Circle for people, rounded square for teams and apps, 16:10 for covers.
        </Text>
      </Stack>
    );
  },
};

export const AvatarStored: Story = {
  name: 'AvatarUploader — an already-stored image',
  render: function StoredStory() {
    const [src, setSrc] = useState<string | null>(samplePhoto(3));
    return (
      <AvatarUploader
        name="Priya Shah"
        size={88}
        src={src}
        pick={pickOf(sampleImage('photo.jpg', 2))}
        onPick={(file) => {
          setSrc(file.uri);
        }}
      >
        <Stack className="gap-0.5">
          <Text weight="semibold">photo.jpg</Text>
          <Text variant="subhead" tone="muted">
            Uploaded 3 Mar 2025 · 240 KB
          </Text>
        </Stack>
      </AvatarUploader>
    );
  },
};

export const AvatarAsControl: Story = {
  name: 'AvatarUploader — the photo is the control',
  render: function ControlStory() {
    const [src, setSrc] = useState<string | null>(samplePhoto(3));
    return (
      <Stack className="items-center gap-2.5">
        <AvatarUploader
          name="Priya Shah"
          size={112}
          controls="photo"
          src={src}
          pick={pickOf(sampleImage('photo.jpg', 2))}
          onPick={(file) => {
            setSrc(file.uri);
          }}
          onRemove={() => {
            setSrc(null);
          }}
        />
        <Text variant="subhead" tone="muted" className="text-center">
          Tapping the photo opens the options: a new one, or none.
        </Text>
      </Stack>
    );
  },
};
