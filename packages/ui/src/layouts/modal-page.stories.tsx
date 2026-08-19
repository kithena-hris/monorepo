import type { Meta, StoryObj } from '@storybook/react-vite';
import { useState, type JSX } from 'react';

import { Badge } from '../components/badge/badge';
import { Button } from '../components/button/button';
import { Card } from '../components/card/card';
import { Alert } from '../components/feedback/feedback';
import { Field, FieldControl, FieldDescription, FieldLabel } from '../components/field/field';
import { Input } from '../components/input/input';
import { Container, Stack } from '../components/layout/layout';
import {
  ModalPage,
  ModalPageBody,
  ModalPageClose,
  ModalPageContent,
  ModalPageFooter,
  ModalPageHeader,
  ModalPageTrigger,
} from '../components/modal-page/modal-page';
import { Money } from '../components/money/money';
import { PageSection } from '../components/page-layout/page-layout';
import { Progress } from '../components/progress/progress';
import { RichTextEditor } from '../components/rich-text/rich-text';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '../components/table/table';

const meta = {
  title: 'Layouts/Modal page',
  component: ModalPageContent,
  parameters: {
    layout: 'centered',
    docs: {
      description: {
        component: [
          'A whole page, presented over the one behind it.',
          '',
          'The shape every product eventually needs and few build deliberately: an editor, an onboarding flow, a document viewer: something that deserves the full screen and a URL, but that the user is *inside* rather than having navigated to. Closing it returns them exactly where they were, with their filters and scroll position intact.',
          '',
          '### It is a route **and** a dialog',
          '',
          'In a real app the route is what makes it linkable and survivable across a refresh. This component supplies the other half, which is the half people skip:',
          '',
          '- focus is trapped, so Tab cannot wander into the page underneath;',
          '- the page underneath is `aria-hidden`, so a screen reader does not read two pages at once;',
          '- Escape closes, and focus returns to whatever opened it;',
          '- the body behind does not scroll.',
          '',
          'A route-as-modal without those four is a full-screen div that a keyboard user tabs straight out of and a screen-reader user never learns they are in.',
          '',
          '### Against `Dialog` and `Sheet`',
          '',
          '| | Use for |',
          '| --- | --- |',
          '| `Dialog` | A decision or a short form. Sized to its content. |',
          '| `Sheet` | Detail beside a list you want to keep seeing. |',
          '| `ModalPage` | A task with its own header, its own scroll and its own actions. Fills the screen. |',
          '',
          '### Sizes',
          '',
          '`full` is edge to edge everywhere. `inset` and `column` are full on a phone and become an inset surface from `md`, which keeps a sliver of the page behind visible, that sliver is what tells the user this is *over* their work rather than instead of it.',
        ].join('\n'),
      },
    },
  },
  argTypes: {
    size: {
      description:
        'How much of the screen it takes at `md` and above. All three are edge to edge on a phone, where there is no "behind" to show.',
      control: 'inline-radio',
      options: ['full', 'inset', 'column'],
      table: {
        type: { summary: "'full' | 'inset' | 'column'" },
        defaultValue: { summary: 'full' },
        category: 'Appearance',
      },
    },
    onEscapeKeyDown: {
      description:
        'Call `preventDefault()` to guard unsaved work. Release the guard once the form is clean, or the page becomes a trap.',
      control: false,
      table: { type: { summary: '(event: KeyboardEvent) => void' }, category: 'Behaviour' },
    },
    onPointerDownOutside: {
      description: 'Only fires for `inset` and `column`; `full` has no outside.',
      control: false,
      table: { type: { summary: '(event) => void' }, category: 'Behaviour' },
    },
    onOpenAutoFocus: {
      description:
        'Where focus lands. By default the first tabbable element, usually the dismiss control, which is the right answer.',
      control: false,
      table: { type: { summary: '(event: Event) => void' }, category: 'Behaviour' },
    },
    className: {
      control: 'text',
      table: { type: { summary: 'string' }, category: 'Escape hatches' },
    },
  },
  args: { size: 'full' },
} satisfies Meta<typeof ModalPageContent>;

export default meta;
type Story = StoryObj<typeof meta>;

/** The page underneath, so the overlay has something to be over. */
function Behind({ children }: { children: JSX.Element }): JSX.Element {
  return (
    <div className="w-[min(64rem,90vw)] rounded-lg border border-border bg-canvas p-4">
      <Stack gap={4}>
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-lg font-semibold text-fg">Requisitions</h1>
            <p className="text-sm text-fg-muted">
              Filtered to Platform · sorted by opened date · page 3
            </p>
          </div>
          {children}
        </div>
        <Table aria-label="Requisitions">
          <TableHeader>
            <TableRow>
              <TableHead>Role</TableHead>
              <TableHead>Team</TableHead>
              <TableHead>Status</TableHead>
              <TableHead numeric>Budget</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {[
              ['Principal Engineer', 'Platform', 'Open', '14200000'],
              ['Staff Engineer', 'Platform', 'Interviewing', '12850000'],
              ['Payroll Specialist', 'Payroll', 'Draft', '6400000'],
            ].map(([role, team, status, budget]) => (
              <TableRow key={role}>
                <TableCell className="font-medium">{role}</TableCell>
                <TableCell className="text-fg-muted">{team}</TableCell>
                <TableCell>
                  <Badge size="sm" tone={status === 'Open' ? 'success' : 'neutral'} dot>
                    {status}
                  </Badge>
                </TableCell>
                <TableCell numeric>
                  <Money minorUnits={budget ?? '0'} currency="EUR" locale="en-IE" />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
        <p className="text-xs text-fg-subtle">
          Open the page above, then close it: this list, its filters and its scroll position are
          untouched. That is the whole argument for a modal page over a route change.
        </p>
      </Stack>
    </div>
  );
}

export const Playground: Story = {
  render: (args) => (
    <Behind>
      <ModalPage>
        <ModalPageTrigger asChild>
          <Button variant="primary">Open the editor</Button>
        </ModalPageTrigger>
        <ModalPageContent {...args}>
          <ModalPageHeader
            title="Principal Engineer, Platform"
            description="Draft · last saved 2 minutes ago"
            meta={
              <Badge size="sm" tone="warning" dot>
                Unpublished
              </Badge>
            }
            actions={
              <>
                <Button size="sm">Preview</Button>
                <ModalPageClose asChild>
                  <Button size="sm" variant="primary">
                    Save and close
                  </Button>
                </ModalPageClose>
              </>
            }
          />
          <ModalPageBody className="p-4 sm:p-6">
            <Container size="md">
              <Stack gap={5}>
                <PageSection surface title="Basics">
                  <Stack gap={4}>
                    <Field>
                      <FieldLabel>Job title</FieldLabel>
                      <FieldControl>
                        <Input defaultValue="Principal Engineer" />
                      </FieldControl>
                    </Field>
                    <Field>
                      <FieldLabel>Team</FieldLabel>
                      <FieldDescription>Determines the approval chain.</FieldDescription>
                      <FieldControl>
                        <Input defaultValue="Platform" />
                      </FieldControl>
                    </Field>
                  </Stack>
                </PageSection>

                <PageSection surface title="Description">
                  <RichTextEditor
                    label="Job description"
                    hint="Shown on the careers site and in the offer letter."
                    minHeight="14rem"
                    value="<h2>About the role</h2><p>You will own the payroll calculation engine end to end.</p><ul><li>Effective-dated aggregates</li><li>Retroactive deltas that reconcile</li></ul>"
                  />
                </PageSection>
              </Stack>
            </Container>
          </ModalPageBody>
          <ModalPageFooter>
            <ModalPageClose asChild>
              <Button>Discard</Button>
            </ModalPageClose>
            <Button variant="primary">Publish</Button>
          </ModalPageFooter>
        </ModalPageContent>
      </ModalPage>
    </Behind>
  ),
};

export const Sizes: Story = {
  name: 'The three sizes',
  parameters: {
    docs: {
      description: {
        story:
          'Open each in turn. `full` commits to the task and hides everything else. `inset` and `column` leave a margin of the page behind visible, which is what tells the user this is over their work rather than instead of it: worth the loss of a few rem when the task is short.',
      },
    },
  },
  render: (args) => (
    <Behind>
      <div className="flex gap-2">
        {(['full', 'inset', 'column'] as const).map((size) => (
          <ModalPage key={size}>
            <ModalPageTrigger asChild>
              <Button>{size}</Button>
            </ModalPageTrigger>
            <ModalPageContent {...args} size={size}>
              <ModalPageHeader
                title={`Size: ${size}`}
                description="Resize the canvas below 768px, all three become edge to edge."
              />
              <ModalPageBody className="p-6">
                <Container size="sm">
                  <Stack gap={3}>
                    {Array.from({ length: 12 }, (_, i) => (
                      <Card key={i} padded className="text-sm text-fg-muted">
                        The body is the only scroll container. Row {i + 1}.
                      </Card>
                    ))}
                  </Stack>
                </Container>
              </ModalPageBody>
              <ModalPageFooter>
                <ModalPageClose asChild>
                  <Button>Close</Button>
                </ModalPageClose>
              </ModalPageFooter>
            </ModalPageContent>
          </ModalPage>
        ))}
      </div>
    </Behind>
  ),
};

export const AsAFlow: Story = {
  name: 'A stepped flow',
  parameters: {
    docs: {
      description: {
        story:
          'The dismiss control is a labelled **←**, not an ✕, because it steps back a level rather than discarding. Pick the glyph by what the control actually does: ✕ throws work away, ← does not. The progress bar is in the header, where it survives the body scrolling.',
      },
    },
  },
  render: function FlowStory(args) {
    const steps = ['Contract', 'Compensation', 'Equipment', 'Review'];
    const [step, setStep] = useState(0);

    return (
      <Behind>
        <ModalPage
          onOpenChange={(open) => {
            if (!open) setStep(0);
          }}
        >
          <ModalPageTrigger asChild>
            <Button variant="primary">Start onboarding</Button>
          </ModalPageTrigger>
          <ModalPageContent {...args} size="column">
            <ModalPageHeader
              dismiss={step === 0 ? 'close' : 'back'}
              dismissLabel={step === 0 ? 'Cancel onboarding' : (steps[step - 1] ?? 'Back')}
              title={`Onboarding, ${steps[step] ?? ''}`}
              description={`Step ${String(step + 1)} of ${String(steps.length)}`}
              meta={<Badge size="sm">Grace Hopper</Badge>}
            />
            <div className="shrink-0 px-4 pb-2">
              <Progress
                value={((step + 1) / steps.length) * 100}
                label={`Onboarding progress, step ${String(step + 1)} of ${String(steps.length)}`}
                size="sm"
              />
            </div>
            <ModalPageBody className="p-4 sm:p-6">
              <Stack gap={4}>
                <h2 className="text-md font-semibold text-fg">{steps[step]}</h2>
                {step === 3 ? (
                  <Alert tone="warning" title="Nothing is saved until you finish">
                    Closing now discards every step.
                  </Alert>
                ) : null}
                <Field>
                  <FieldLabel>{steps[step]} detail</FieldLabel>
                  <FieldControl>
                    <Input placeholder={`Something about ${steps[step]?.toLowerCase() ?? ''}`} />
                  </FieldControl>
                </Field>
              </Stack>
            </ModalPageBody>
            <ModalPageFooter>
              <Button
                disabled={step === 0}
                onClick={() => {
                  setStep((current) => Math.max(0, current - 1));
                }}
              >
                Back
              </Button>
              {step === steps.length - 1 ? (
                <ModalPageClose asChild>
                  <Button variant="primary">Finish</Button>
                </ModalPageClose>
              ) : (
                <Button
                  variant="primary"
                  onClick={() => {
                    setStep((current) => Math.min(steps.length - 1, current + 1));
                  }}
                >
                  Continue
                </Button>
              )}
            </ModalPageFooter>
          </ModalPageContent>
        </ModalPage>
      </Behind>
    );
  },
};

export const GuardingUnsavedWork: Story = {
  name: 'Guarding unsaved work',
  parameters: {
    docs: {
      description: {
        story:
          'Type in the field, then press Escape or click outside: both are intercepted while the form is dirty. This is one of the few legitimate reasons to block a dismissal, and the guard must be released once the form is clean, or the page becomes a trap with no keyboard way out.',
      },
    },
  },
  render: function GuardStory(args) {
    const [text, setText] = useState('');
    const [warned, setWarned] = useState(false);
    const dirty = text.trim().length > 0;

    return (
      <Behind>
        <ModalPage
          onOpenChange={(open) => {
            if (!open) {
              setText('');
              setWarned(false);
            }
          }}
        >
          <ModalPageTrigger asChild>
            <Button variant="primary">Edit the policy</Button>
          </ModalPageTrigger>
          <ModalPageContent
            {...args}
            size="column"
            onEscapeKeyDown={(event) => {
              if (dirty) {
                event.preventDefault();
                setWarned(true);
              }
            }}
            onPointerDownOutside={(event) => {
              if (dirty) {
                event.preventDefault();
                setWarned(true);
              }
            }}
          >
            <ModalPageHeader
              title="Leave policy. Spain"
              description={dirty ? 'Unsaved changes' : 'No changes'}
              meta={
                dirty ? (
                  <Badge size="sm" tone="warning" dot>
                    Draft
                  </Badge>
                ) : null
              }
            />
            <ModalPageBody className="p-4 sm:p-6">
              <Stack gap={3}>
                {warned ? (
                  <Alert tone="warning" title="This policy has unsaved changes">
                    Save it, or clear the field to discard.
                  </Alert>
                ) : null}
                <Field>
                  <FieldLabel>Policy note</FieldLabel>
                  <FieldDescription>Type here, then try Escape.</FieldDescription>
                  <FieldControl>
                    <Input
                      value={text}
                      onChange={(event) => {
                        setText(event.target.value);
                        setWarned(false);
                      }}
                    />
                  </FieldControl>
                </Field>
              </Stack>
            </ModalPageBody>
            <ModalPageFooter>
              <ModalPageClose asChild>
                <Button
                  onClick={() => {
                    setText('');
                  }}
                >
                  Discard
                </Button>
              </ModalPageClose>
              <ModalPageClose asChild>
                <Button variant="primary" disabled={!dirty}>
                  Save
                </Button>
              </ModalPageClose>
            </ModalPageFooter>
          </ModalPageContent>
        </ModalPage>
      </Behind>
    );
  },
};
