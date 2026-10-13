import type { Meta, StoryObj } from '@storybook/react-vite';
import { useState } from 'react';

import { PlacementLayer, type PlacedBox } from '../placement-layer/placement-layer';
import { Signature } from '../signature/signature';
import { PdfPages } from './pdf-pages';

const sample = new URL('./sample.pdf', import.meta.url).href;

const meta = {
  title: 'Data display/PdfPages',
  component: PdfPages,
  parameters: {
    layout: 'padded',
    docs: {
      description: {
        component:
          'A PDF drawn page by page, with something laid over each page: where to sign, where somebody signed. Pages are drawn as they near the screen, at its pixel density.',
      },
    },
  },
  args: { src: sample, label: 'Letter of agreement' },
} satisfies Meta<typeof PdfPages>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Pages: Story = {
  render: (args) => (
    <div className="max-w-2xl">
      <PdfPages {...args} />
    </div>
  ),
};

/** Preparing: press the page to place a box, drag it, resize it from its corner, Delete removes it. */
export const PlacingBoxes: Story = {
  render: function Placing(args) {
    const [boxes, setBoxes] = useState<(PlacedBox & { page: number })[]>([
      {
        id: 'a',
        page: 2,
        x: 0.25,
        y: 0.48,
        w: 0.36,
        h: 0.06,
        tone: 1,
        label: 'Signature, Ada Lovelace',
        hint: 'Sign',
      },
      {
        id: 'b',
        page: 2,
        x: 0.18,
        y: 0.53,
        w: 0.2,
        h: 0.03,
        tone: 2,
        label: 'Date, Grace Hopper',
        hint: 'Date',
      },
    ]);
    const [selected, setSelected] = useState<string | null>(null);
    return (
      <div className="max-w-2xl">
        <PdfPages
          {...args}
          overlay={(page) => (
            <PlacementLayer
              editable
              boxes={boxes.filter((b) => b.page === page.number)}
              selected={selected}
              onSelect={setSelected}
              onChange={(id, rect) => {
                setBoxes((all) => all.map((b) => (b.id === id ? { ...b, ...rect } : b)));
              }}
              onRemove={(id) => {
                setBoxes((all) => all.filter((b) => b.id !== id));
              }}
              onPlace={({ x, y }) => {
                const id = String(Date.now());
                setBoxes((all) => [
                  ...all,
                  {
                    id,
                    page: page.number,
                    x,
                    y,
                    w: 0.3,
                    h: 0.05,
                    tone: 1,
                    label: 'Signature, Ada Lovelace',
                    hint: 'Sign',
                  },
                ]);
                setSelected(id);
              }}
            />
          )}
        />
      </div>
    );
  },
};

/** Signing: only your boxes, each pressed in turn; a filled one shows the signature. */
export const Signing: Story = {
  render: function Signing(args) {
    const [signed, setSigned] = useState(false);
    const box: PlacedBox = {
      id: 'a',
      x: 0.25,
      y: 0.48,
      w: 0.36,
      h: 0.06,
      tone: 1,
      label: signed ? 'Signature, signed' : 'Sign here',
      hint: 'Sign',
      done: signed,
    };
    return (
      <div className="max-w-2xl">
        <PdfPages
          {...args}
          overlay={(page) =>
            page.number === 2 ? (
              <PlacementLayer
                boxes={[box]}
                onActivate={() => {
                  setSigned(true);
                }}
                render={(b) =>
                  b.done === true ? (
                    <Signature
                      value={{ kind: 'typed', text: 'Ada Lovelace', style: 'flowing' }}
                      label="Ada Lovelace’s signature"
                    />
                  ) : null
                }
              />
            ) : null
          }
        />
      </div>
    );
  },
};
