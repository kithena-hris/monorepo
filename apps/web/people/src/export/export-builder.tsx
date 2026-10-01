import {
  Alert,
  AssistantCard,
  Button,
  Card,
  Checkbox,
  Chip,
  ChipGroup,
  ChipGroupItem,
  DatePicker,
  Field,
  FieldControl,
  FieldDescription,
  FieldLabel,
  KeyValues,
  PageHeader,
  PageSection,
  RadioCard,
  RadioGroup,
  SearchField,
  Stack,
  Textarea,
  icons,
  type IsoDate,
} from '@reach/ui';
import { useState, type JSX } from 'react';

import { Loaded, type Loadable, type Outcome } from '../load';
import { ExportDone, ShareWaiting, type ExportRecord, type ShareRequest } from './export-done';
import { SendPanel, type SendPreview } from './send-panel';
import {
  FORMAT_LABEL,
  firstName,
  listed,
  spokenDate,
  type AddressPatch,
  type ExportChoice,
  type ExportFormat,
} from './words';

export type { AddressPatch, ExportChoice, ExportFormat } from './words';

export interface ExportState {
  readonly today: IsoDate;
  /** Everybody, each saved view, and the directory's conditions when the address carries them. */
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
  /** Whom the export in the address would go to, and what they could not read. */
  readonly preview?: SendPreview | null;
  /** The finished export a link opened the page with (design AI14). */
  readonly record?: ExportRecord | { readonly status: 'missing' };
  /** A request to send one, waiting for a People administrator. */
  readonly share?: ShareRequest | { readonly state: 'missing' };
}

/** The page's state as its address carries it (design AI13). Absent values are defaults. */
export interface ExportAddress {
  readonly q?: string | null;
  readonly read?: 'assistant' | 'rules' | null;
  readonly who?: string | null;
  readonly fields?: readonly string[] | null;
  readonly asOf?: string | null;
  readonly format?: ExportFormat | null;
  readonly photos?: boolean;
  readonly reason?: string | null;
  readonly to?: string | null;
  readonly send?: 'download' | 'send' | 'schedule' | null;
  readonly hand?: boolean;
}

export interface ExportBuilderProps {
  readonly load: Loadable<ExportState>;
  readonly address?: ExportAddress;
  /** Changes the address: a chip or a send mode pushes, typing replaces. */
  readonly onAddress?: (patch: AddressPatch, mode?: 'push' | 'replace') => void;
  /** Download now, as the requester. */
  readonly onExport: (choice: ExportChoice) => Promise<Outcome>;
  /**
   * An export described in words, read as these choices and a drafted reason
   * (docs/ai-settings.md); the host puts them in the address. Absent: no
   * prompt.
   */
  readonly onDescribe?: (sentence: string) => Promise<ExportDescribed>;
  /** Send it to somebody: the host goes to the sent export, or to the request waiting. */
  readonly onShare?: (choice: ExportChoice, recipient: string) => Promise<Outcome>;
  readonly onDecide?: (requestId: string, approve: boolean, note: string) => Promise<Outcome>;
  /** Make it a monthly scheduled report, to the recipient (or the requester). */
  readonly onSchedule?: (choice: ExportChoice, recipient: string) => Promise<Outcome>;
}

/** What People made of an export described in words, once the host has applied it. */
export type ExportDescribed =
  | {
      readonly ok: true;
      readonly by: 'assistant' | 'rules';
      /** Why the assistant did not read it, when it did not. */
      readonly note: string | null;
      /** What was changed from what was asked ("1 November is still to come"). */
      readonly notes: readonly string[];
    }
  | { readonly ok: false; readonly message: string };

const FORMATS: readonly { value: ExportFormat; label: string; description: string }[] = [
  { value: 'csv', label: 'CSV', description: 'For another system, or to import back.' },
  { value: 'xlsx', label: 'Excel', description: 'For a person to read and edit.' },
  {
    value: 'pdf',
    label: 'PDF roster',
    description: 'To print or file, with the filter on every page.',
  },
];

/** How each format carries its About (design AI14). */
const FORMAT_NOTE: Record<ExportFormat, string> = {
  xlsx: 'One sheet, plus About',
  csv: 'One file, plus About',
  pdf: 'A roster, About on top',
};

/** Name, family name, preferred name: what "Mask names" leaves out. */
const isName = (f: { key: string; label: string }) =>
  /(^|_)name($|_)/u.test(f.key) || /\bname\b/iu.test(f.label);

export interface Suggestion {
  readonly id: string;
  readonly label: string;
  readonly patch: AddressPatch;
}

/**
 * What the file could also be, by People's own rules (design AI13's chips):
 * one more field beside the sensitive ones, the names left out, the other
 * file format. Each is a change to the choices, shown before anything runs.
 */
export function suggestionsFor(
  state: Pick<ExportState, 'sections'>,
  chosen: readonly string[],
  format: ExportFormat,
  sensitive: readonly string[],
): Suggestion[] {
  const all = state.sections.flatMap((s) => s.fields.map((f) => ({ ...f, section: s.key })));
  const picked = new Set(chosen);
  const out: Suggestion[] = [];
  const anchor = all.find((f) => sensitive.includes(f.key)) ?? all.find((f) => picked.has(f.key));
  const more = all.find((f) => !picked.has(f.key) && f.section === anchor?.section);
  if (more !== undefined) {
    out.push({
      id: 'add',
      label: `Also add ${more.label.toLowerCase()}`,
      patch: { fields: [...chosen, more.key].join(',') },
    });
  }
  const names = all.filter((f) => picked.has(f.key) && isName(f));
  if (names.length > 0 && names.length < chosen.length) {
    const number = all.find((f) => f.key === 'employee_number');
    const kept = chosen.filter((k) => !names.some((n) => n.key === k));
    out.push({
      id: 'mask',
      label: 'Mask names',
      patch: {
        fields: [...kept, ...(number && !picked.has(number.key) ? [number.key] : [])].join(','),
      },
    });
  }
  out.push(
    format === 'csv'
      ? { id: 'format', label: 'As Excel', patch: { format: 'xlsx' } }
      : { id: 'format', label: 'As CSV', patch: { format: 'csv' } },
  );
  return out;
}

/**
 * Export (design AI13, AI14, MA10): describe it in a sentence, check what was
 * built, then download it, send it to somebody, or schedule it.
 *
 * The field picker offers only what the requester can read: there is no
 * "export everything" path, because an export button that forgot the
 * permission model is the most common way one is defeated. People enforces
 * the same rule on the file it builds, and checks a file sent to somebody
 * against what they could read themselves.
 */
export function ExportBuilder({
  load,
  address = {},
  onAddress = () => undefined,
  onExport,
  onDescribe,
  onShare,
  onDecide,
  onSchedule,
}: ExportBuilderProps): JSX.Element {
  return (
    <Stack gap={6}>
      <PageHeader
        title="Export"
        description="Describe what you need. Kithena builds the export, and you check it."
      />
      <Loaded load={load} what="the export builder">
        {(state) =>
          state.record !== undefined ? (
            <ExportDone
              record={state.record}
              canSchedule={state.preview?.canSchedule === true && address.fields != null}
              {...(onSchedule === undefined
                ? {}
                : {
                    onSchedule: () =>
                      onSchedule(
                        choiceOf(state, address),
                        state.record !== undefined && 'sentTo' in state.record
                          ? (state.record.sentTo?.accountId ?? state.preview?.self ?? '')
                          : (state.preview?.self ?? ''),
                      ),
                  })}
            />
          ) : state.share !== undefined ? (
            <ShareWaiting share={state.share} {...(onDecide === undefined ? {} : { onDecide })} />
          ) : (
            <Builder
              state={state}
              address={address}
              onAddress={onAddress}
              onExport={onExport}
              {...(onDescribe === undefined ? {} : { onDescribe })}
              {...(onShare === undefined ? {} : { onShare })}
              {...(onSchedule === undefined ? {} : { onSchedule })}
            />
          )
        }
      </Loaded>
    </Stack>
  );
}

/** The choices the address makes, of what is offered: all fields when none are asked for. */
export function choiceOf(state: ExportState, address: ExportAddress): ExportChoice {
  const offered = state.sections.flatMap((s) => s.fields.map((f) => f.key));
  const asked = offered.filter((k) => address.fields?.includes(k) === true);
  const who = state.who.find((w) => w.value === address.who)?.value ?? state.who[0]?.value ?? '';
  const asOf = address.asOf != null && address.asOf <= state.today ? address.asOf : state.today;
  const format = address.format ?? 'xlsx';
  return {
    who,
    fields: asked.length > 0 ? asked : offered,
    asOf,
    format,
    ...(address.photos === true && format !== 'pdf' ? { photos: true } : {}),
    ...(address.reason == null ? {} : { reason: address.reason }),
  };
}

function Builder({
  state,
  address,
  onAddress,
  onExport,
  onDescribe,
  onShare,
  onSchedule,
}: {
  readonly state: ExportState;
  readonly address: ExportAddress;
  readonly onAddress: (patch: AddressPatch, mode?: 'push' | 'replace') => void;
  readonly onExport: ExportBuilderProps['onExport'];
  readonly onDescribe?: NonNullable<ExportBuilderProps['onDescribe']>;
  readonly onShare?: NonNullable<ExportBuilderProps['onShare']>;
  readonly onSchedule?: NonNullable<ExportBuilderProps['onSchedule']>;
}): JSX.Element {
  const choice = choiceOf(state, address);
  const preview = state.preview ?? null;
  // Whom the sentence named, People read on this load: sending is then the default.
  const mode =
    address.send ?? (address.to == null && preview?.recipient == null ? 'download' : 'send');
  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-4 @5xl/page:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)] @5xl/page:items-start">
      <Stack gap={3}>
        {onDescribe === undefined ? null : (
          <Describe sentence={address.q ?? ''} onDescribe={onDescribe} />
        )}
        <Built
          state={state}
          choice={choice}
          address={address}
          preview={preview}
          mode={mode}
          onAddress={onAddress}
        />
        {address.hand === true ? (
          <ByHand state={state} choice={choice} onAddress={onAddress} />
        ) : null}
      </Stack>
      <SendPanel
        className="@5xl/page:sticky @5xl/page:top-6"
        choice={choice}
        preview={preview}
        mode={mode}
        recipient={address.to ?? preview?.recipient?.accountId ?? null}
        onAddress={onAddress}
        onExport={onExport}
        {...(onShare === undefined ? {} : { onShare })}
        {...(onSchedule === undefined ? {} : { onSchedule })}
      />
    </div>
  );
}

/**
 * "salaries for everyone in Madrid engineering as of 30 June, for Finance's
 * 2027 budget": the choices below filled in from it, for the person to check
 * and change. Nothing is exported until they press a button.
 */
function Describe({
  sentence,
  onDescribe,
}: {
  readonly sentence: string;
  readonly onDescribe: NonNullable<ExportBuilderProps['onDescribe']>;
}): JSX.Element {
  const [typed, setTyped] = useState(sentence);
  const [busy, setBusy] = useState(false);
  const [answer, setAnswer] = useState<ExportDescribed | null>(null);
  return (
    <Stack gap={2}>
      <SearchField
        variant="prompt"
        label="Describe the export"
        placeholder="Ask in plain English, like “salaries in Madrid as of 30 June, for Finance”"
        shortcut="page.search"
        enterKeyHint="go"
        maxLength={300}
        loading={busy}
        value={typed}
        onValueChange={setTyped}
        onSearch={(value) => {
          if (value.trim() === '') return;
          setBusy(true);
          void onDescribe(value.trim()).then((a) => {
            setBusy(false);
            setAnswer(a);
          });
        }}
      />
      {answer === null ? null : answer.ok ? (
        [...(answer.note === null ? [] : [answer.note]), ...answer.notes].map((n) => (
          <p key={n} className="text-sm text-fg-muted">
            {n}
          </p>
        ))
      ) : (
        <Alert tone="danger" title="Nothing was built">
          {answer.message}
        </Alert>
      )}
    </Stack>
  );
}

/** "Here's the export I've built": who, which fields, as of when, the format, and why. */
function Built({
  state,
  choice,
  address,
  preview,
  mode,
  onAddress,
}: {
  readonly state: ExportState;
  readonly choice: ExportChoice;
  readonly address: ExportAddress;
  readonly preview: SendPreview | null;
  readonly mode: 'download' | 'send' | 'schedule';
  readonly onAddress: (patch: AddressPatch, mode?: 'push' | 'replace') => void;
}): JSX.Element {
  const audience = state.who.find((w) => w.value === choice.who);
  const labels = state.sections
    .flatMap((s) => s.fields)
    .filter((f) => choice.fields.includes(f.key))
    .map((f) => f.label);
  const sensitive = preview?.sensitive.length ?? 0;
  const count = preview?.people ?? audience?.count ?? 0;
  const people = `${String(count)} ${count === 1 ? 'person' : 'people'}`;
  const adjust = (
    <Button
      variant="ghost"
      size="sm"
      startIcon={<icons.adjust aria-hidden />}
      aria-pressed={address.hand === true}
      onClick={() => {
        onAddress({ hand: address.hand === true ? null : '1' });
      }}
    >
      Adjust by hand
    </Button>
  );
  const tiles: readonly [string, string, string][] = [
    ['Who', audience?.label ?? 'Everybody you can see', people],
    [
      'Fields',
      listed(labels),
      `${String(labels.length)} ${labels.length === 1 ? 'field' : 'fields'}`,
    ],
    ['As of', spokenDate(choice.asOf), 'Values at end of day'],
    ['Format', FORMAT_LABEL[choice.format], FORMAT_NOTE[choice.format]],
  ];
  const body = (
    <Stack gap={3}>
      {/* At a desk, four tiles; under a finger, a list (MA10). */}
      <div className="hidden gap-2.5 @2xl/page:grid @2xl/page:grid-cols-4">
        {tiles.map(([k, v, sub]) => (
          <Card key={k} variant="fill" padded className="flex min-w-0 flex-col gap-1.5">
            <span className="text-xs text-fg-subtle">{k}</span>
            <span className="text-sm font-semibold text-fg">{v}</span>
            <span className="text-xs text-fg-muted">{sub}</span>
          </Card>
        ))}
      </div>
      <KeyValues
        className="@2xl/page:hidden"
        layout="split"
        items={[
          { label: 'Who', value: people },
          {
            label: 'Fields',
            value: `${String(labels.length)}${sensitive === 0 ? '' : ` · ${String(sensitive)} sensitive`}`,
          },
          { label: 'As of', value: spokenDate(choice.asOf) },
        ]}
      />
      <Reason
        reason={choice.reason ?? ''}
        onSave={(reason) => {
          onAddress({ reason: reason.trim() === '' ? null : reason.trim() }, 'replace');
        }}
      />
      {mode === 'download' ? null : <Gap preview={preview} scheduled={mode === 'schedule'} />}
      <Suggestions
        state={state}
        choice={choice}
        sensitive={preview?.sensitive ?? []}
        onAddress={onAddress}
      />
    </Stack>
  );
  if (address.q == null) {
    return (
      <Card padded className="flex flex-col gap-3.5">
        <div className="flex items-center gap-2.5">
          <h2 className="min-w-0 flex-1 text-base font-semibold text-fg">Your export</h2>
          {adjust}
        </div>
        {body}
      </Card>
    );
  }
  return (
    <AssistantCard
      level={2}
      title="Here’s the export I’ve built"
      action={adjust}
      note={
        address.read === 'assistant'
          ? 'Built by the assistant from your sentence, with the same field permissions as the builder. Check it before it goes anywhere.'
          : 'Built by People’s own rules from your sentence. Check it before it goes anywhere.'
      }
    >
      {body}
    </AssistantCard>
  );
}

/** "Reason, for the audit log": shown, and edited in place. */
function Reason({
  reason,
  onSave,
}: {
  readonly reason: string;
  readonly onSave: (reason: string) => void;
}): JSX.Element {
  const [editing, setEditing] = useState(reason === '');
  const [draft, setDraft] = useState(reason);
  return (
    <Card variant="outline" padded className="flex items-start gap-3">
      <icons.message aria-hidden className="mt-0.5 size-4.5 shrink-0 text-fg-subtle" />
      {editing ? (
        <form
          className="flex min-w-0 flex-1 flex-col gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            onSave(draft);
            if (draft.trim() !== '') setEditing(false);
          }}
        >
          <Field required>
            <FieldLabel>Reason, for the audit log</FieldLabel>
            <FieldControl>
              <Textarea
                value={draft}
                maxLength={500}
                placeholder="Budget planning for 2027, requested by Finance"
                onChange={(e) => {
                  setDraft(e.target.value);
                }}
              />
            </FieldControl>
            <FieldDescription>
              Required. Saved with the export and shown in the audit log.
            </FieldDescription>
          </Field>
          <div>
            <Button type="submit" size="sm" variant="secondary">
              Save reason
            </Button>
          </div>
        </form>
      ) : (
        <>
          <div className="min-w-0 flex-1">
            <p className="text-xs text-fg-subtle">Reason, for the audit log</p>
            <p className="mt-1.5 text-sm font-medium text-fg">{reason}</p>
          </div>
          <Button
            variant="ghost"
            size="xs"
            aria-label="Edit the reason"
            onClick={() => {
              setEditing(true);
            }}
          >
            Edit
          </Button>
        </>
      )}
    </Card>
  );
}

/**
 * The recipient's missing access, spotted before the file exists: which
 * fields they could not see, on how many people, and who would approve
 * sending it anyway.
 */
function Gap({
  preview,
  scheduled,
}: {
  readonly preview: SendPreview | null;
  /** A schedule is built as its recipient each time: nothing waits, the fields are left out. */
  readonly scheduled: boolean;
}): JSX.Element | null {
  const gap = preview?.gap ?? null;
  const recipient = preview?.recipient ?? null;
  if (gap === null || recipient === null) return null;
  const them = firstName(recipient.name);
  const fields = gap.fields.map((f) => f.label);
  const top = gap.fields[0];
  const approvers = preview?.approvers.map((a) => a.name ?? 'a People administrator') ?? [];
  const title =
    fields.length > 0
      ? `${listed(fields)} ${fields.length === 1 ? 'needs' : 'need'} ${them}’s access`
      : `${them} can’t see ${String(gap.unlisted)} of these people`;
  return (
    <Alert tone="warning" icon={<icons.locked aria-hidden />} title={title}>
      {top === undefined
        ? `You can export them, but ${them} can’t see them in People.`
        : `You can export it, but sending it to ${them} means ${them} would see ${top.label.toLowerCase()} for ${String(top.people)} ${top.people === 1 ? 'person' : 'people'} ${them} can’t see it for in People.`}
      {gap.unlisted > 0 && top !== undefined
        ? ` ${String(gap.unlisted)} of them ${them} can’t see at all.`
        : ''}{' '}
      {scheduled
        ? `A schedule is built as ${them} can see it each month, so that is left out of ${them}’s.`
        : approvers.length === 0
          ? `Nobody else here can approve sending it: that takes a People administrator who is neither you nor ${them}.`
          : `So it waits for ${listed(approvers)} to approve sending this one file.`}
    </Alert>
  );
}

function Suggestions({
  state,
  choice,
  sensitive,
  onAddress,
}: {
  readonly state: ExportState;
  readonly choice: ExportChoice;
  readonly sensitive: readonly string[];
  readonly onAddress: (patch: AddressPatch, mode?: 'push' | 'replace') => void;
}): JSX.Element {
  return (
    <div className="flex flex-wrap gap-2" role="group" aria-label="Suggestions">
      {suggestionsFor(state, choice.fields, choice.format, sensitive).map((s) => (
        <Chip
          key={s.id}
          variant="dashed"
          startIcon={<icons.add aria-hidden />}
          onClick={() => {
            onAddress(s.patch);
          }}
        >
          {s.label}
        </Chip>
      ))}
    </div>
  );
}

/** The builder by hand: who, which fields, as of when, and the format, each in the address. */
function ByHand({
  state,
  choice,
  onAddress,
}: {
  readonly state: ExportState;
  readonly choice: ExportChoice;
  readonly onAddress: (patch: AddressPatch, mode?: 'push' | 'replace') => void;
}): JSX.Element {
  const fields = new Set(choice.fields);
  const toggle = (keys: readonly string[], on: boolean): void => {
    const next = new Set(fields);
    for (const k of keys) {
      if (on) next.add(k);
      else next.delete(k);
    }
    const offered = state.sections.flatMap((s) => s.fields.map((f) => f.key));
    onAddress({ fields: offered.filter((k) => next.has(k)).join(',') || null }, 'replace');
  };
  return (
    <Stack gap={4}>
      <PageSection surface title="Who">
        {state.who.length === 1 ? (
          <p className="text-base text-fg">
            <span className="font-semibold">{state.who[0]?.label}</span>
            {', '}
            <span className="tabular-nums">{state.who[0]?.count}</span>
          </p>
        ) : (
          <ChipGroup
            type="single"
            aria-label="Who to export"
            value={choice.who}
            onValueChange={(next) => {
              if (next !== '') onAddress({ who: next === 'everyone' ? null : next }, 'replace');
            }}
          >
            {state.who.map((w) => (
              <ChipGroupItem key={w.value} value={w.value} variant="view">
                {w.label} <span className="font-medium tabular-nums">{w.count}</span>
              </ChipGroupItem>
            ))}
          </ChipGroup>
        )}
      </PageSection>
      <PageSection surface title="Which fields" description={`${String(fields.size)} selected`}>
        <div className="grid gap-5 @container @2xl:grid-cols-3">
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
        </div>
      </PageSection>
      <PageSection
        surface
        title="As of when"
        description="Values as they were at the end of that day. Any past date works."
      >
        <DatePicker
          label="As of"
          value={choice.asOf}
          max={state.today}
          onChange={(next) => {
            if (next !== null) onAddress({ asOf: next === state.today ? null : next }, 'replace');
          }}
        />
      </PageSection>
      <PageSection surface title="Format">
        <RadioGroup
          aria-label="Format"
          value={choice.format}
          onValueChange={(value) => {
            onAddress({ format: value === 'xlsx' ? null : value }, 'replace');
          }}
          className="grid-cols-1 @container @xl:grid-cols-3"
        >
          {FORMATS.map((f) => (
            <RadioCard key={f.value} value={f.value} description={f.description}>
              {f.label}
            </RadioCard>
          ))}
        </RadioGroup>
        <Field
          orientation="horizontal"
          className="mt-4 justify-start"
          disabled={choice.format === 'pdf'}
        >
          <FieldControl>
            <Checkbox
              checked={choice.photos === true}
              disabled={choice.format === 'pdf'}
              onCheckedChange={(on) => {
                onAddress({ photos: on === true ? 'true' : null }, 'replace');
              }}
            />
          </FieldControl>
          <div>
            <FieldLabel>Include profile photos</FieldLabel>
            <FieldDescription>
              {choice.format === 'pdf'
                ? 'Not available for PDF.'
                : 'Adds a ZIP of photos, named by employee number.'}
            </FieldDescription>
          </div>
        </Field>
      </PageSection>
    </Stack>
  );
}
