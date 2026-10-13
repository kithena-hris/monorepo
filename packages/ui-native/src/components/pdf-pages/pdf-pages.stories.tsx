import type { Meta, StoryObj } from '@storybook/react-native-web-vite';
import { useState } from 'react';
import { View } from 'react-native-css/components';

import { PlacementLayer, type PlacedBox } from '../placement-layer/placement-layer.tsx';
import { Signature } from '../signature/signature.tsx';
import { PdfPages } from './pdf-pages.tsx';

const sample = new URL('../../../../ui/src/components/pdf-pages/sample.pdf', import.meta.url).href;

const meta = {
  title: 'Components/PdfPages',
  component: PdfPages,
  args: { src: sample, label: 'Letter of agreement' },
  decorators: [
    (Story) => (
      <View className="h-[640px] w-full">
        <Story />
      </View>
    ),
  ],
} satisfies Meta<typeof PdfPages>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Pages: Story = {};

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
      label: signed ? 'Signature, filled' : 'Signature',
      hint: 'Sign',
      done: signed,
    };
    return (
      <PdfPages
        {...args}
        overlay={(page) =>
          page.number === 2 ? (
            <PlacementLayer
              boxes={[box]}
              focus="a"
              onActivate={() => {
                setSigned(true);
              }}
              render={(b) =>
                b.done === true ? (
                  <Signature
                    value={{ kind: 'typed', text: 'Ada Lovelace', style: 'flowing' }}
                    label="Ada Lovelace’s signature"
                    className="text-[var(--reach-neutral-900)]"
                  />
                ) : null
              }
            />
          ) : null
        }
      />
    );
  },
};
