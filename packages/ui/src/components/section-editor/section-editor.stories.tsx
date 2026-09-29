import type { Meta, StoryObj } from '@storybook/react-vite';
import { Globe, MessageSquareQuote, User, UserRoundCheck, Users } from 'lucide-react';
import { useState } from 'react';

import { AccessMatrix, type AccessValue } from '../access-matrix/access-matrix';
import { Button } from '../button/button';
import { Card, CardContent, CardHeader, CardTitle } from '../card/card';
import { Alert } from '../feedback/feedback';
import { Field, FieldControl, FieldLabel } from '../field/field';
import { Input } from '../input/input';
import { RadioCard, RadioGroup } from '../radio-group/radio-group';
import {
  Sheet,
  SheetBody,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from '../sheet/sheet';
import { Switch } from '../switch/switch';
import { SectionEditor, SectionEditorPart } from './section-editor';

const sections = [
  { id: 'field', label: 'The field', status: 'success' as const },
  { id: 'access', label: 'Access', status: 'success' as const },
  { id: 'when', label: 'When it’s asked', status: 'warning' as const },
  { id: 'sensitivity', label: 'Sensitivity' },
];

function Editor() {
  const [access, setAccess] = useState<AccessValue>({ see: ['self', 'manager'], change: ['hr'] });
  return (
    <SectionEditor
      label="Field sections"
      sections={sections}
      aside={
        <>
          <Alert tone="accent" title="In plain words" icon={<MessageSquareQuote />}>
            HR fills in <b>Employee number</b>. The employee and their manager can see it, and only
            HR can change it.
          </Alert>
          <Card>
            <CardHeader>
              <CardTitle>Preview</CardTitle>
            </CardHeader>
            <CardContent>
              <Field>
                <FieldLabel>Employee number</FieldLabel>
                <FieldControl>
                  <Input placeholder="ES-00000" />
                </FieldControl>
              </Field>
            </CardContent>
          </Card>
        </>
      }
    >
      <SectionEditorPart id="field" title="The field">
        <Field>
          <FieldLabel>Field name</FieldLabel>
          <FieldControl>
            <Input defaultValue="Employee number" />
          </FieldControl>
        </Field>
      </SectionEditorPart>
      <SectionEditorPart
        id="access"
        title="Access"
        description="Tap a cell to change it. Changing always includes seeing."
      >
        <AccessMatrix
          audiences={[
            { id: 'self', label: 'The employee', icon: <User /> },
            { id: 'manager', label: 'Their manager', icon: <UserRoundCheck /> },
            { id: 'hr', label: 'HR', icon: <Users /> },
            { id: 'everyone', label: 'Everyone', icon: <Globe />, canChange: false },
          ]}
          value={access}
          onChange={setAccess}
        />
      </SectionEditorPart>
      <SectionEditorPart id="when" title="When it’s asked">
        <RadioGroup
          defaultValue="hr"
          aria-label="When it’s asked"
          className="grid-cols-1 gap-2 @lg:grid-cols-2"
        >
          <RadioCard value="signup" description="Before the passkey. Nothing confidential.">
            At sign-up
          </RadioCard>
          <RadioCard value="hr" description="The employee never sees a form.">
            Only HR fills it in
          </RadioCard>
        </RadioGroup>
      </SectionEditorPart>
      <SectionEditorPart id="sensitivity" title="Sensitivity">
        <Field orientation="horizontal">
          <FieldLabel>Changes need a second approver</FieldLabel>
          <FieldControl>
            <Switch />
          </FieldControl>
        </Field>
      </SectionEditorPart>
    </SectionEditor>
  );
}

const meta = {
  title: 'Components/Section editor',
  component: SectionEditor,
  parameters: {
    layout: 'padded',
    docs: {
      description: {
        component: [
          'One page with a section list, in place of a step-by-step wizard. Sections show their status, the list follows the scroll, you can jump straight to one, and Save is always available in the footer.',
          '',
          'The `aside` carries a live preview or a plain-words summary (an `Alert` with `tone="accent"`) that is rewritten as the choices change. Under a finger the list becomes a row of pills and the aside follows the sections.',
        ].join('\n'),
      },
    },
  },
  args: { label: 'Field sections', sections, children: null },
} satisfies Meta<typeof SectionEditor>;

export default meta;
type Story = StoryObj<typeof meta>;

export const InASheet: Story = {
  name: 'In a sheet',
  render: () => (
    <Sheet>
      <SheetTrigger asChild>
        <Button variant="primary">Edit Employee number</Button>
      </SheetTrigger>
      <SheetContent size="full" className="sm:max-w-[65rem]">
        <SheetHeader>
          <SheetTitle>Employee number</SheetTitle>
          <SheetDescription>Employment · type and key are fixed</SheetDescription>
        </SheetHeader>
        <SheetBody className="flex min-h-0 flex-1 flex-col">
          <Editor />
        </SheetBody>
        <SheetFooter>
          <p className="me-auto text-sm text-fg-muted">1 change · saved as a draft</p>
          <Button variant="ghost">Discard</Button>
          <Button variant="primary">Save to draft</Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  ),
};

export const SectionList: Story = {
  render: () => (
    <div className="h-[34rem]">
      <Editor />
    </div>
  ),
};

export const PlainWordsSummary: Story = {
  name: 'Plain-words summary',
  render: () => (
    <Alert tone="accent" title="In plain words" icon={<MessageSquareQuote />} className="max-w-sm">
      HR fills in <b>Employee number</b>. The employee and their manager can see it.
    </Alert>
  ),
};
