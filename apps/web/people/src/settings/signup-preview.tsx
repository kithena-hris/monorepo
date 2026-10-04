import {
  Alert,
  Button,
  KeyValues,
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Stack,
  Stepper,
} from '@reach/ui';
import { useState, type JSX } from 'react';

import { AttributeInput } from '../record/attribute-input';
import { DisplayValue } from '../record/display';
import { FieldFiles } from '../record/files';
import type { AttributeValue, RecordField, Values } from '../record/model';
import type { RegistryField } from './model';

/**
 * The sign-up flow as a new starter meets it from their email link, drawn
 * from the draft: the same steps and the same controls, with nothing sent.
 *
 * What the page itself asks (`signup: 'page'`) sits in its own step after the
 * name; what it may not hold — a file, confidential data — is asked on the
 * first screen after the passkey (`signup: 'after'`), and the preview shows
 * that step too, so an admin sees every question somebody will answer and
 * where.
 */

const asRecord = (f: RegistryField): RecordField => ({
  key: f.key,
  label: f.label,
  description: f.description,
  dataType: f.dataType,
  options: f.options.map((o) => ({ value: o, label: o })),
  required: f.requiredness !== 'never',
  readOnly: false,
});

const NAMES: readonly RecordField[] = [
  {
    key: 'given_name',
    label: 'Legal first name',
    description: null,
    dataType: 'text',
    options: [],
    required: true,
    readOnly: false,
  },
  {
    key: 'family_name',
    label: 'Legal family name',
    description: null,
    dataType: 'text',
    options: [],
    required: true,
    readOnly: false,
  },
  {
    key: 'preferred_name',
    label: 'Preferred name',
    description: 'What colleagues call you, if not your first name.',
    dataType: 'text',
    options: [],
    required: false,
    readOnly: false,
  },
];

type StepId = 'about' | 'details' | 'review' | 'passkey' | 'after';

export function SignupPreview({
  fields,
  open,
  onOpenChange,
}: {
  readonly fields: readonly RegistryField[];
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
}): JSX.Element {
  const page = fields.filter((f) => f.signup === 'page' && f.pending !== 'archived').map(asRecord);
  const after = fields
    .filter((f) => f.signup === 'after' && f.pending !== 'archived')
    .map(asRecord);
  const steps: { id: StepId; label: string; description?: string }[] = [
    { id: 'about', label: 'About you' },
    ...(page.length === 0 ? [] : [{ id: 'details' as const, label: 'Your details' }]),
    { id: 'review', label: 'Review' },
    { id: 'passkey', label: 'Your passkey' },
    ...(after.length === 0
      ? []
      : [{ id: 'after' as const, label: 'Finish setting up', description: 'After signing in' }]),
  ];
  const [at, setAt] = useState(0);
  const [values, setValues] = useState<Values>({});
  const step = steps[Math.min(at, steps.length - 1)]?.id ?? 'about';
  const set = (key: string) => (value: AttributeValue) => {
    setValues((v) => ({ ...v, [key]: value }));
  };
  const inputs = (list: readonly RecordField[]) => (
    <Stack gap={4}>
      {list.map((f) => (
        <AttributeInput key={f.key} field={f} value={values[f.key] ?? null} onChange={set(f.key)} />
      ))}
    </Stack>
  );

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        onOpenChange(next);
        if (!next) {
          setAt(0);
          setValues({});
        }
      }}
    >
      <DialogContent className="sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>Sign-up preview</DialogTitle>
          <DialogDescription>
            What somebody sees from their email link. Nothing here is saved or sent.
          </DialogDescription>
        </DialogHeader>
        <DialogBody>
          <div className="grid gap-6 sm:grid-cols-[12.5rem_minmax(0,1fr)]">
            <Stepper
              label="Sign-up steps"
              orientation="vertical"
              steps={steps}
              current={at}
              onStepChange={(index) => {
                setAt(index);
              }}
            />
            <section aria-labelledby="signup-step" className="flex min-w-0 flex-col gap-4">
              <h3 id="signup-step" className="text-md font-semibold text-fg">
                {steps[Math.min(at, steps.length - 1)]?.label}
              </h3>
              {step === 'about' ? inputs(NAMES) : null}
              {step === 'details' ? inputs(page) : null}
              {step === 'review' ? (
                <KeyValues
                  aria-label="Your answers"
                  items={[...NAMES, ...page].map((f) => ({
                    label: f.label,
                    value: <DisplayValue field={f} value={values[f.key]} />,
                  }))}
                />
              ) : null}
              {step === 'passkey' ? (
                <Alert tone="info" title="Your device asks for a fingerprint, a face or a PIN">
                  A passkey is made on their own device, so it is not part of this preview. They
                  sign in with it from then on.
                </Alert>
              ) : null}
              {step === 'after' ? (
                <FieldFiles.Provider
                  value={{
                    known: new Map(),
                    upload: () =>
                      Promise.resolve({ ok: false, message: 'Nothing is uploaded in a preview.' }),
                  }}
                >
                  <Stack gap={4}>
                    <p className="text-sm text-fg-muted">
                      Asked after sign-in. Sign-up never asks for files or confidential data.
                    </p>
                    {inputs(after)}
                  </Stack>
                </FieldFiles.Provider>
              ) : null}
            </section>
          </div>
        </DialogBody>
        <DialogFooter>
          <Button
            disabled={at === 0}
            onClick={() => {
              setAt((i) => Math.max(0, i - 1));
            }}
          >
            Back
          </Button>
          <Button
            variant="primary"
            onClick={() => {
              if (at >= steps.length - 1) onOpenChange(false);
              else setAt((i) => i + 1);
            }}
          >
            {at >= steps.length - 1 ? 'Close preview' : 'Next'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
