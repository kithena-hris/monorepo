import {
  Alert,
  Button,
  Checkbox,
  DatePicker,
  Field,
  FieldControl,
  FieldLabel,
  PageHeader,
  PageSection,
  RadioCard,
  RadioGroup,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Stack,
  type IsoDate,
} from '@reach/ui';
import { useState, type JSX } from 'react';

import { Loaded, type Loadable, type Outcome } from '../load';

export type ExportFormat = 'xlsx' | 'csv' | 'pdf';

export interface ExportState {
  readonly today: IsoDate;
  /** The current directory filter, a saved segment, a selection. */
  readonly who: readonly {
    readonly value: string;
    readonly label: string;
    readonly count: number;
  }[];
  /**
   * Only what the requester may read, by section — the same decision their
   * profile view is shaped by. There is no "everything" to pick from.
   */
  readonly sections: readonly {
    readonly key: string;
    readonly label: string;
    readonly fields: readonly { readonly key: string; readonly label: string }[];
  }[];
  /**
   * A scheduled report's file, when its email's link opened this page
   * (PEO-069). `missing` is somebody else's, or one that no longer exists.
   */
  readonly ready?: {
    readonly status: 'queued' | 'completed' | 'expired' | 'missing';
    readonly expiresAt: string | null;
    readonly links: readonly { readonly name: string; readonly url: string }[];
  };
}

export interface ExportChoice {
  readonly who: string;
  readonly fields: readonly string[];
  readonly asOf: IsoDate;
  readonly format: ExportFormat;
}

export interface ExportBuilderProps {
  readonly load: Loadable<ExportState>;
  readonly onExport: (choice: ExportChoice) => Promise<Outcome>;
}

const FORMATS: readonly { value: ExportFormat; label: string; description: string }[] = [
  { value: 'xlsx', label: 'Excel (.xlsx)', description: 'For a person to read and edit.' },
  { value: 'csv', label: 'CSV', description: 'For another system, or to import back.' },
  {
    value: 'pdf',
    label: 'PDF roster',
    description: 'To print or file. Landscape, with the headers and the filter on every page.',
  },
];

/**
 * Who, which fields, as of when, and what format (PRD §15.1, design screen 11).
 *
 * The field picker offers only what the requester can read: there is no
 * "export everything" path, because an export button that forgot the
 * permission model is the most common way one is defeated. People enforces
 * the same rule on the file it builds, so this is the screen agreeing with it
 * rather than the only guard.
 */
export function ExportBuilder({ load, onExport }: ExportBuilderProps): JSX.Element {
  return (
    <Stack gap={6}>
      <PageHeader
        title="Export"
        description="Columns come from the published schema, with the label on row 1 and the key the re-importer reads on row 2."
      />
      <Loaded load={load} what="the export builder">
        {(state) => (
          <Stack gap={6}>
            {state.ready === undefined ? null : <Ready ready={state.ready} />}
            <Builder state={state} onExport={onExport} />
          </Stack>
        )}
      </Loaded>
    </Stack>
  );
}

/** The file a scheduled report's email pointed at: the recipient's own, for 24 hours. */
function Ready({ ready }: { readonly ready: NonNullable<ExportState['ready']> }): JSX.Element {
  if (ready.status === 'completed') {
    return (
      <Alert tone="success" title="Your scheduled report is ready">
        <Stack gap={3}>
          <p>
            It holds only what you can see in People. The link stops working 24 hours after the
            report was made.
          </p>
          <div className="flex flex-wrap gap-2">
            {ready.links.map((link) => (
              <Button key={link.url} asChild size="sm" variant="primary">
                <a href={link.url}>Download {link.name}</a>
              </Button>
            ))}
          </div>
        </Stack>
      </Alert>
    );
  }
  if (ready.status === 'queued') {
    return (
      <Alert tone="info">
        Your scheduled report is still being prepared. Try again in a minute.
      </Alert>
    );
  }
  return (
    <Alert tone="warning" title="This report is no longer available">
      {ready.status === 'expired'
        ? 'Scheduled reports are deleted 24 hours after they are made. The next one arrives as scheduled.'
        : 'It was made for somebody else, or it no longer exists.'}
    </Alert>
  );
}

function Builder({
  state,
  onExport,
}: {
  readonly state: ExportState;
  readonly onExport: ExportBuilderProps['onExport'];
}): JSX.Element {
  const [who, setWho] = useState(state.who[0]?.value ?? '');
  const [asOf, setAsOf] = useState<IsoDate>(state.today);
  const [format, setFormat] = useState<ExportFormat>('xlsx');
  const [fields, setFields] = useState<ReadonlySet<string>>(
    () => new Set(state.sections.flatMap((s) => s.fields.map((f) => f.key))),
  );
  const [busy, setBusy] = useState(false);
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const count = state.who.find((w) => w.value === who)?.count ?? 0;

  const toggle = (keys: readonly string[], on: boolean): void => {
    setFields((current) => {
      const next = new Set(current);
      for (const k of keys) {
        if (on) next.add(k);
        else next.delete(k);
      }
      return next;
    });
  };

  const run = async (): Promise<void> => {
    setBusy(true);
    setOutcome(null);
    const result = await onExport({ who, fields: [...fields], asOf, format });
    setBusy(false);
    setOutcome(result);
  };

  return (
    <Stack gap={6}>
      <PageSection surface title="Who">
        <Field className="max-w-sm">
          <FieldLabel>People</FieldLabel>
          <Select value={who} onValueChange={setWho}>
            <FieldControl>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
            </FieldControl>
            <SelectContent>
              {state.who.map((w) => (
                <SelectItem key={w.value} value={w.value}>
                  {w.label} ({w.count})
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
      </PageSection>

      <PageSection surface title="As of" description="Any past date works. History makes it free.">
        <DatePicker
          label="As of"
          value={asOf}
          max={state.today}
          onChange={(next) => {
            if (next !== null) setAsOf(next);
          }}
        />
      </PageSection>

      <PageSection surface title="Fields" description={`${String(fields.size)} selected`}>
        <Stack gap={5}>
          {state.sections.map((section) => {
            const keys = section.fields.map((f) => f.key);
            const picked = keys.filter((k) => fields.has(k)).length;
            return (
              <fieldset key={section.key} className="flex flex-col gap-2">
                <legend className="sr-only">{section.label}</legend>
                <Field orientation="horizontal" className="justify-start">
                  <FieldControl>
                    <Checkbox
                      checked={
                        picked === keys.length ? true : picked === 0 ? false : 'indeterminate'
                      }
                      onCheckedChange={(on) => {
                        toggle(keys, on === true);
                      }}
                    />
                  </FieldControl>
                  <FieldLabel className="font-semibold">{section.label}</FieldLabel>
                </Field>
                <div className="flex flex-col gap-2 ps-7">
                  {section.fields.map((f) => (
                    <Field key={f.key} orientation="horizontal" className="justify-start">
                      <FieldControl>
                        <Checkbox
                          checked={fields.has(f.key)}
                          onCheckedChange={(on) => {
                            toggle([f.key], on === true);
                          }}
                        />
                      </FieldControl>
                      <FieldLabel>{f.label}</FieldLabel>
                    </Field>
                  ))}
                </div>
              </fieldset>
            );
          })}
        </Stack>
      </PageSection>

      <PageSection surface title="Format">
        <RadioGroup
          aria-label="Format"
          value={format}
          onValueChange={(value) => {
            setFormat(value as ExportFormat);
          }}
        >
          {FORMATS.map((f) => (
            <RadioCard key={f.value} value={f.value} description={f.description}>
              {f.label}
            </RadioCard>
          ))}
        </RadioGroup>
      </PageSection>

      <Alert tone="info">
        Bank accounts and national identifiers export masked. Health and diversity answers are not
        in a standard export at all.
      </Alert>
      {outcome === null ? null : outcome.ok ? (
        <Alert tone="success">
          Your export is being prepared. A large one arrives as a notification with a link that
          expires in 24 hours.
        </Alert>
      ) : (
        <Alert tone="danger" title="No export was made">
          {outcome.message}
        </Alert>
      )}
      <div>
        <Button
          variant="primary"
          disabled={fields.size === 0 || who === ''}
          loading={busy}
          loadingLabel="Exporting"
          onClick={() => {
            void run();
          }}
        >
          Export {count} {count === 1 ? 'person' : 'people'}
        </Button>
      </div>
    </Stack>
  );
}
