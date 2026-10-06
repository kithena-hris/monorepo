import type { Meta, StoryObj } from '@storybook/react-native-web-vite';
import { Pencil } from 'lucide-react-native';
import { useRef, useState } from 'react';
import type { TextInput } from 'react-native';
import { View } from 'react-native-css/components';

import { designDocs, designNote } from '../../docs/design.ts';
import { Button } from '../button/button.tsx';
import { Card } from '../card/card.tsx';
import { Alert } from '../feedback/feedback.tsx';
import { Field, FieldError, FieldLabel } from '../field/field.tsx';
import { Icon } from '../icon/icon.tsx';
import { Input } from '../input/input.tsx';
import { Inline, Stack } from '../layout/layout.tsx';
import { Separator } from '../separator/separator.tsx';
import { Text } from '../text/text.tsx';
import { FormSaveBar, FormSection, FormSections } from './form-sections.tsx';

const meta = {
  title: 'Forms/Form sections',
  component: FormSection,
  parameters: designDocs('form-sections'),
} satisfies Meta<typeof FormSection>;

export default meta;
type Story = StoryObj;

function NamedField({ label, initial }: { label: string; initial: string }): React.JSX.Element {
  const [value, setValue] = useState(initial);
  return (
    <Field>
      <FieldLabel>{label}</FieldLabel>
      <Input value={value} onChange={setValue} />
    </Field>
  );
}

export const Sections: Story = {
  render: function SectionsStory() {
    const [pronouns, setPronouns] = useState('');
    return (
      <FormSections>
        <FormSection title="Personal" description="Shown on your profile">
          <NamedField label="Preferred name" initial="Priya" />
          <Field optional>
            <FieldLabel>Pronouns</FieldLabel>
            <Input value={pronouns} onChange={setPronouns} placeholder="Optional" />
          </Field>
        </FormSection>
        <FormSection title="Emergency contact" description="Only HR can see this">
          <NamedField label="Name" initial="Arjun Shah" />
          <NamedField label="Phone" initial="+49 151 000 2233" />
        </FormSection>
      </FormSections>
    );
  },
};

export const UnsavedChangesBar: Story = {
  name: 'Unsaved changes bar',
  render: function SaveBarStory() {
    const saved = 'Senior Engineer';
    const [title, setTitle] = useState('Staff Engineer');
    const [stored, setStored] = useState(saved);
    const [saving, setSaving] = useState(false);
    return (
      <Stack className="gap-2.5">
        <Field>
          <FieldLabel>Job title</FieldLabel>
          <Input value={title} onChange={setTitle} />
        </Field>
        <Stack className="mt-5">
          <FormSaveBar
            open={title !== stored}
            saving={saving}
            onDiscard={() => {
              setTitle(stored);
            }}
            onSave={() => {
              setSaving(true);
              setTimeout(() => {
                setStored(title);
                setSaving(false);
              }, 600);
            }}
          />
        </Stack>
        <Text variant="subhead" tone="muted">
          It rises in once the first change is made, and leaving the page asks you to confirm.
        </Text>
      </Stack>
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
  parameters: designNote('form-sections', 'Read, then edit'),
  render: function ReadStory() {
    const [editing, setEditing] = useState(false);
    const [values, setValues] = useState<Record<string, string>>(Object.fromEntries(contact));
    const [draft, setDraft] = useState(values);
    return (
      <Card>
        <Stack className="gap-2">
          <Inline className="items-center justify-between">
            <Text weight="bold" className="text-[16px]">
              Contact
            </Text>
            {editing ? null : (
              <Button
                variant="ghost"
                size="sm"
                startIcon={<Icon icon={Pencil} />}
                accessibilityLabel="Edit contact"
                onPress={() => {
                  setDraft(values);
                  setEditing(true);
                }}
              >
                Edit
              </Button>
            )}
          </Inline>
          {editing ? (
            <Stack className="gap-3">
              {contact.map(([term]) => (
                <Field key={term}>
                  <FieldLabel>{term}</FieldLabel>
                  <Input
                    value={draft[term] ?? ''}
                    onChange={(next) => {
                      setDraft({ ...draft, [term]: next });
                    }}
                  />
                </Field>
              ))}
              <Inline className="justify-end gap-2">
                <Button
                  size="sm"
                  onPress={() => {
                    setEditing(false);
                  }}
                >
                  Cancel
                </Button>
                <Button
                  size="sm"
                  variant="primary"
                  onPress={() => {
                    setValues(draft);
                    setEditing(false);
                  }}
                >
                  Save
                </Button>
              </Inline>
            </Stack>
          ) : (
            <Stack className="gap-0">
              {contact.map(([term], index) => (
                <Stack key={term} className="gap-0">
                  {index ? <Separator /> : null}
                  <View className="min-h-[52px] flex-row items-center justify-between gap-4 py-2.5">
                    <Text variant="subhead" tone="muted" className="text-[16px]">
                      {term}
                    </Text>
                    <Text weight="medium" className="min-w-0 shrink text-right text-[16px]">
                      {values[term] ?? ''}
                    </Text>
                  </View>
                </Stack>
              ))}
            </Stack>
          )}
        </Stack>
      </Card>
    );
  },
};

export const ValidationSummary: Story = {
  name: 'Validation summary',
  render: function SummaryStory() {
    const email = useRef<TextInput>(null);
    const start = useRef<TextInput>(null);
    const [address, setAddress] = useState('priya@reach');
    const [date, setDate] = useState('');
    return (
      <Stack className="gap-3">
        <Alert tone="danger" title="2 things to fix before saving">
          <Stack className="items-start gap-1.5 pt-1">
            <Button
              variant="link"
              size="sm"
              onPress={() => {
                email.current?.focus();
              }}
            >
              Work email isn’t a full address
            </Button>
            <Button
              variant="link"
              size="sm"
              onPress={() => {
                start.current?.focus();
              }}
            >
              Start date is missing
            </Button>
          </Stack>
        </Alert>
        <Field invalid>
          <FieldLabel>Work email</FieldLabel>
          <Input ref={email} type="email" value={address} onChange={setAddress} />
          <FieldError>Use a full address, like priya@reach.co.</FieldError>
        </Field>
        <Field invalid>
          <FieldLabel>Start date</FieldLabel>
          <Input ref={start} type="date" value={date} onChange={setDate} />
          <FieldError>Add the day they start.</FieldError>
        </Field>
      </Stack>
    );
  },
};
