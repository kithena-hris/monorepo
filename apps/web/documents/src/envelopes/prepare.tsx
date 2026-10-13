import {
  Alert,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  ChartLegend,
  Checkbox,
  Field,
  FieldControl,
  FieldLabel,
  PdfPages,
  PlacementLayer,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  ToggleGroup,
  ToggleGroupItem,
  icons,
  type PlacedBox,
} from '@reach/ui';
import { useEffect, useState, type JSX } from 'react';

import type { FieldKind, FileLink } from '../types';

/**
 * K2, as DocuSign does it: the sender puts each box on the document itself —
 * a signature, initials, the date, a name, a line of text, a tick — and says
 * whose it is. Kithena starts each signer with a signature and its date on
 * the last page; they are moved, resized, removed or added to on the page.
 *
 * Positions are fractions of their page, so the box the sender drew is where
 * the signer signs and where the sealed PDF carries it.
 */

export interface PlacedField {
  readonly id: string;
  /** The signer it is for: `DraftSigner.key`, until the request is sent. */
  readonly signer: string;
  readonly kind: FieldKind;
  readonly page: number;
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
  readonly required: boolean;
}

export interface Placing {
  readonly key: string;
  readonly name: string;
}

export const KIND_LABEL: Readonly<Record<FieldKind, string>> = {
  signature: 'Signature',
  initials: 'Initials',
  date: 'Date signed',
  name: 'Full name',
  title: 'Job title',
  text: 'Text',
  checkbox: 'Tick box',
};

/** A new box's size, as a fraction of an A4-shaped page. */
const SIZE: Readonly<Record<FieldKind, { readonly w: number; readonly h: number }>> = {
  signature: { w: 0.3, h: 0.055 },
  initials: { w: 0.1, h: 0.045 },
  date: { w: 0.18, h: 0.028 },
  name: { w: 0.26, h: 0.028 },
  title: { w: 0.26, h: 0.028 },
  text: { w: 0.26, h: 0.028 },
  checkbox: { w: 0.028, h: 0.02 },
};

const CHART_TONE = {
  1: 'chart-1',
  2: 'chart-2',
  3: 'chart-3',
  4: 'chart-4',
  5: 'chart-5',
  6: 'chart-6',
} as const;

/** Whose box it is shows in its colour: the six chart colours, in signing order. */
export const toneOf = (index: number): PlacedBox['tone'] => ((index % 6) + 1) as PlacedBox['tone'];

let counter = 0;
const nextId = () => `f${String(Date.now())}-${String(++counter)}`;

/** Kithena's start for a signer: a signature and its date on the last page, two to a row. */
export function startingFields(signer: string, index: number, pages: number): PlacedField[] {
  const x = index % 2 === 0 ? 0.08 : 0.54;
  const y = Math.max(0.05, 0.78 - Math.floor(index / 2) * 0.12);
  return [
    {
      id: nextId(),
      signer,
      kind: 'signature',
      page: pages,
      x,
      y,
      ...SIZE.signature,
      required: true,
    },
    {
      id: nextId(),
      signer,
      kind: 'date',
      page: pages,
      x,
      y: y + SIZE.signature.h + 0.008,
      ...SIZE.date,
      required: true,
    },
  ];
}

export function WhereTheySign({
  documentId,
  title,
  signers,
  fields,
  onFields,
  onFileLink,
}: {
  readonly documentId: string;
  readonly title: string;
  readonly signers: readonly Placing[];
  readonly fields: readonly PlacedField[];
  readonly onFields: (next: readonly PlacedField[]) => void;
  readonly onFileLink: FileLink | undefined;
}): JSX.Element {
  const [url, setUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const [tool, setTool] = useState<FieldKind>('signature');
  const [forWhom, setForWhom] = useState(signers[0]?.key ?? '');
  const [selected, setSelected] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    void onFileLink?.(documentId, 'view').then((got) => {
      if (!live) return;
      if (got.ok) setUrl(got.url);
      else setFailed(got.message);
    });
    return () => {
      live = false;
    };
  }, [documentId, onFileLink]);

  const index = new Map(signers.map((s, i) => [s.key, i]));
  const nameOf = (key: string) => signers.find((s) => s.key === key)?.name ?? 'Nobody';
  const chosen = fields.find((f) => f.id === selected) ?? null;
  const unplaced = signers.filter(
    (s) => !fields.some((f) => f.signer === s.key && f.kind === 'signature'),
  );
  const change = (id: string, patch: Partial<PlacedField>) => {
    onFields(fields.map((f) => (f.id === id ? { ...f, ...patch } : f)));
  };

  return (
    <div className="grid gap-6 lg:grid-cols-[18rem_minmax(0,1fr)]">
      <div className="flex flex-col gap-4 lg:sticky lg:top-4 lg:self-start">
        <Card>
          <CardHeader>
            <CardTitle level={2}>Add a box</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <Field>
              <FieldLabel>For</FieldLabel>
              <Select value={forWhom} onValueChange={setForWhom}>
                <FieldControl>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                </FieldControl>
                <SelectContent>
                  {signers.map((s) => (
                    <SelectItem key={s.key} value={s.key}>
                      {s.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <ToggleGroup
              type="single"
              aria-label="Kind of box"
              orientation="vertical"
              className="flex flex-col items-stretch"
              value={tool}
              onValueChange={(v) => {
                if (v !== '') setTool(v as FieldKind);
              }}
            >
              {(Object.keys(KIND_LABEL) as FieldKind[]).map((k) => (
                <ToggleGroupItem key={k} value={k} className="justify-start">
                  {KIND_LABEL[k]}
                </ToggleGroupItem>
              ))}
            </ToggleGroup>
            <p className="text-sm text-fg-muted">
              Press the page where it goes. Drag a box to move it, its corner to resize it; Delete
              removes it.
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle level={2}>Who signs</CardTitle>
          </CardHeader>
          <CardContent>
            <ChartLegend
              items={signers.map((s, i) => ({
                label: `${s.name} · ${String(fields.filter((f) => f.signer === s.key).length)} ${fields.filter((f) => f.signer === s.key).length === 1 ? 'box' : 'boxes'}`,
                tone: CHART_TONE[toneOf(i)],
              }))}
            />
          </CardContent>
        </Card>
        {chosen === null ? null : (
          <Card>
            <CardHeader>
              <CardTitle
                level={3}
              >{`${KIND_LABEL[chosen.kind]}, page ${String(chosen.page)}`}</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-4">
              <Field>
                <FieldLabel>Whose box</FieldLabel>
                <Select
                  value={chosen.signer}
                  onValueChange={(v) => {
                    change(chosen.id, { signer: v });
                  }}
                >
                  <FieldControl>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                  </FieldControl>
                  <SelectContent>
                    {signers.map((s) => (
                      <SelectItem key={s.key} value={s.key}>
                        {s.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
              {chosen.kind === 'signature' || chosen.kind === 'date' ? null : (
                <Field orientation="horizontal">
                  <FieldControl>
                    <Checkbox
                      checked={chosen.required}
                      onCheckedChange={(v) => {
                        change(chosen.id, { required: v === true });
                      }}
                    />
                  </FieldControl>
                  <FieldLabel>They must fill it in</FieldLabel>
                </Field>
              )}
              <Button
                variant="secondary"
                startIcon={<icons.delete aria-hidden />}
                onClick={() => {
                  onFields(fields.filter((f) => f.id !== chosen.id));
                  setSelected(null);
                }}
              >
                Remove the box
              </Button>
            </CardContent>
          </Card>
        )}
        {unplaced.length === 0 ? null : (
          <Alert tone="warning" title="Nowhere to sign yet">
            {`${unplaced.map((s) => s.name).join(', ')} ${unplaced.length === 1 ? 'needs' : 'need'} a signature box.`}
          </Alert>
        )}
      </div>
      <Card variant="fill" padded>
        {failed !== null ? (
          <Alert tone="danger" title="The document could not be opened">
            {failed}
          </Alert>
        ) : url === null ? (
          <div className="grid min-h-[36rem] place-items-center text-sm text-fg-muted">
            Opening the document
          </div>
        ) : (
          <PdfPages
            src={url}
            label={title}
            overlay={(page) => (
              <PlacementLayer
                editable
                selected={selected}
                onSelect={setSelected}
                boxes={fields
                  .filter((f) => f.page === page.number)
                  .map((f) => ({
                    id: f.id,
                    x: f.x,
                    y: f.y,
                    w: f.w,
                    h: f.h,
                    tone: toneOf(index.get(f.signer) ?? 0),
                    label: `${KIND_LABEL[f.kind]}, ${nameOf(f.signer)}`,
                    hint: `${KIND_LABEL[f.kind]} · ${nameOf(f.signer)}`,
                  }))}
                onChange={(id, rect) => {
                  change(id, rect);
                }}
                onRemove={(id) => {
                  onFields(fields.filter((f) => f.id !== id));
                  setSelected(null);
                }}
                onPlace={({ x, y }) => {
                  if (forWhom === '') return;
                  const size = SIZE[tool];
                  const id = nextId();
                  onFields([
                    ...fields,
                    {
                      id,
                      signer: forWhom,
                      kind: tool,
                      page: page.number,
                      x: Math.min(Math.max(x - size.w / 2, 0), 1 - size.w),
                      y: Math.min(Math.max(y - size.h / 2, 0), 1 - size.h),
                      ...size,
                      required: tool !== 'checkbox' && tool !== 'text',
                    },
                  ]);
                  setSelected(id);
                }}
              />
            )}
          />
        )}
      </Card>
    </div>
  );
}
