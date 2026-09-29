import type { Meta, StoryObj } from '@storybook/react-vite';
import { Pencil } from 'lucide-react';
import { useState } from 'react';

import { Button } from '../button/button';
import { Card } from '../card/card';
import { Alert } from '../feedback/feedback';
import { Field, FieldControl, FieldError, FieldLabel } from '../field/field';
import { Input } from '../input/input';
import { FormSaveBar, FormSection, FormSections } from './form-sections';

const meta = {
  title: 'Forms/Form sections',
  component: FormSections,
  parameters: {
    layout: 'padded',
    docs: {
      description: {
        component: [
          'How long forms are laid out: titled sections, one column on phones, and a save bar that only appears once something has changed.',
          '',
          '- **Sections, not cards.** A rule under each section keeps them chapters of one form.',
          '- **Two columns where the form has room**, measured on the form itself with a container query, so a settings page in a side panel stacks like it does on a phone.',
          '- **One Save, in reach.** `FormSaveBar` sticks to the bottom of whatever scrolls and exists only while there is something to save.',
        ].join('\n'),
      },
    },
  },
} satisfies Meta<typeof FormSections>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Sections: Story = {
  render: () => (
    <FormSections className="max-w-3xl">
      <FormSection title="Personal" description="Shown on your profile">
        <Field>
          <FieldLabel>Preferred name</FieldLabel>
          <FieldControl>
            <Input defaultValue="Priya" />
          </FieldControl>
        </Field>
        <Field>
          <FieldLabel>Pronouns</FieldLabel>
          <FieldControl>
            <Input placeholder="Optional" />
          </FieldControl>
        </Field>
      </FormSection>
      <FormSection title="Emergency contact" description="Only HR can see this">
        <Field>
          <FieldLabel>Name</FieldLabel>
          <FieldControl>
            <Input defaultValue="Arjun Shah" autoComplete="off" />
          </FieldControl>
        </Field>
        <Field>
          <FieldLabel>Phone</FieldLabel>
          <FieldControl>
            <Input type="tel" defaultValue="+49 151 000 2233" autoComplete="off" />
          </FieldControl>
        </Field>
      </FormSection>
    </FormSections>
  ),
};

export const UnsavedChanges: Story = {
  name: 'Unsaved changes bar',
  parameters: {
    docs: {
      description: {
        story:
          'It rises in once the first change is made, and leaving the page asks you to confirm. Edit the title to see it.',
      },
    },
  },
  render: function UnsavedStory() {
    const saved = 'Staff Engineer';
    const [title, setTitle] = useState('Senior Staff Engineer');
    const [stored, setStored] = useState(saved);
    return (
      <div className="flex max-w-md flex-col gap-5">
        <Field>
          <FieldLabel>Job title</FieldLabel>
          <FieldControl>
            <Input
              value={title}
              onChange={(event) => {
                setTitle(event.target.value);
              }}
            />
          </FieldControl>
        </Field>
        <FormSaveBar
          open={title !== stored}
          onDiscard={() => {
            setTitle(stored);
          }}
          onSave={() => {
            setStored(title);
          }}
        />
      </div>
    );
  },
};

const contact = [
  ['Email', 'priya@reach.co'],
  ['Phone', '+49 151 2345 6789'],
  ['Address', 'Torstraße 1, Berlin'],
] as const;

export const ReadThenEdit: Story = {
  name: 'Read, then edit',
  parameters: {
    docs: {
      description: {
        story:
          'Most profile data is read far more often than it is edited, so show values first and edit in place.',
      },
    },
  },
  render: () => (
    <Card className="max-w-md p-5">
      <div className="mb-2 flex items-center justify-between gap-2">
        <h2 className="text-base font-bold text-fg">Contact</h2>
        <Button size="sm" variant="ghost" startIcon={<Pencil />}>
          Edit
        </Button>
      </div>
      <dl className="grid grid-cols-[6rem_minmax(0,1fr)] gap-x-4 gap-y-2 text-sm">
        {contact.map(([term, value]) => (
          <div key={term} className="contents">
            <dt className="text-fg-muted">{term}</dt>
            <dd className="min-w-0 truncate text-fg">{value}</dd>
          </div>
        ))}
      </dl>
    </Card>
  ),
};

export const ValidationSummary: Story = {
  name: 'Validation summary',
  parameters: {
    docs: {
      description: {
        story:
          'On submit, one summary at the top links to each field that needs fixing; each field still carries its own message.',
      },
    },
  },
  render: () => (
    <div className="flex max-w-md flex-col gap-3">
      <Alert tone="danger" title="2 things to fix before saving">
        <ul className="mt-1 flex flex-col gap-1">
          <li>
            <a href="#work-email" className="underline underline-offset-2">
              Work email isn&rsquo;t a full address
            </a>
          </li>
          <li>
            <a href="#start-date" className="underline underline-offset-2">
              Start date is missing
            </a>
          </li>
        </ul>
      </Alert>
      <Field invalid id="work-email">
        <FieldLabel>Work email</FieldLabel>
        <FieldControl>
          <Input type="email" defaultValue="priya@reach" />
        </FieldControl>
        <FieldError>Use a full address, like priya@reach.co.</FieldError>
      </Field>
    </div>
  ),
};
