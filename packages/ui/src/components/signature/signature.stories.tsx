import type { Meta, StoryObj } from '@storybook/react-vite';
import { useState } from 'react';

import { SignatureInput } from './adopt-signature';

import {
  Signature,
  SIGNATURE_STYLE_LABEL,
  type SignatureStyle,
  type SignatureValue,
} from './signature';

const meta = {
  title: 'Forms/Signature',
  component: Signature,
  parameters: {
    layout: 'padded',
    docs: {
      description: {
        component:
          'A signature as it is shown: typed in one of three handwriting faces, or drawn, in the middle of its box and as large as the box allows. Nothing is measured, so a page of them stays fast.',
      },
    },
  },
  args: {
    value: { kind: 'typed', text: 'Ada Lovelace', style: 'flowing' },
    label: 'Ada Lovelace’s signature',
  },
} satisfies Meta<typeof Signature>;

export default meta;
type Story = StoryObj<typeof meta>;

const box = 'h-20 w-72 rounded-sm border border-dashed border-border';

export const Styles: Story = {
  render: (args) => (
    <div className="flex flex-col gap-3">
      {(Object.keys(SIGNATURE_STYLE_LABEL) as SignatureStyle[]).map((style) => (
        <div key={style} className={box}>
          <Signature
            {...args}
            value={{ kind: 'typed', text: 'Ada Lovelace', style }}
            label={`Ada Lovelace’s signature, ${SIGNATURE_STYLE_LABEL[style]}`}
          />
        </div>
      ))}
    </div>
  ),
};

/** The same name in a wide box, a narrow one and a short one: always centred, never cut off. */
export const AnyBox: Story = {
  render: (args) => (
    <div className="flex flex-wrap items-start gap-3">
      <div className="h-24 w-96 rounded-sm border border-dashed border-border">
        <Signature {...args} />
      </div>
      <div className="h-24 w-32 rounded-sm border border-dashed border-border">
        <Signature {...args} label="Ada Lovelace’s signature, narrow" />
      </div>
      <div className="h-8 w-72 rounded-sm border border-dashed border-border">
        <Signature {...args} label="Ada Lovelace’s signature, short" />
      </div>
      <div className="h-12 w-16 rounded-sm border border-dashed border-border">
        <Signature {...args} initials label="Ada Lovelace’s initials" />
      </div>
    </div>
  ),
};

export const Drawn: Story = {
  render: (args) => (
    <div className={box}>
      <Signature
        {...args}
        value={{
          kind: 'drawn',
          path: 'M 40 80 L 70 40 L 95 85 L 120 50 L 150 82 L 190 45 L 230 78 M 250 60 L 330 60',
        }}
        label="Ada Lovelace’s drawn signature"
      />
    </div>
  ),
};

/** A signature kept as a field's value: adopted once, changed from here. */
export const AsAField: Story = {
  render: function AsAField() {
    const [value, setValue] = useState<SignatureValue | null>(null);
    return (
      <div className="max-w-sm">
        <SignatureInput name="Ada Lovelace" value={value} onChange={setValue} />
      </div>
    );
  },
};
