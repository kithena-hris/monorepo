import {
  Avatar,
  Button,
  Card,
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  List,
  ListItem,
  Progress,
  Stack,
  Text,
} from '@reach/ui-native';
import { useState } from 'react';

import { useAct } from '../act';
import { ask, formInputs, useSigned, type Finding, type RecordField, type Value } from '../api';
import { AttributeInput } from '../attribute-input';
import type { CompletenessState, GapField, GapRow } from './model';

/** A gap's field as the form's field: People sends the gap its type and choices. */
const asField = (f: GapField): RecordField => ({
  key: f.key,
  label: f.label,
  description: null,
  dataType: f.person ? 'person_ref' : (f.dataType ?? (f.options.length > 0 ? 'select' : 'text')),
  options: f.options,
  required: true,
  missing: true,
  readOnly: false,
  currency: f.currency,
  ownedBy: null,
  keptIn: null,
  sensitive: f.sensitive,
  askable: null,
});

/** HR fills in one person's missing details: checked first, then saved (`SaveCompletenessGrid`). */
function FillIn({
  row,
  fields,
  onClose,
  onDone,
}: {
  row: GapRow;
  fields: readonly GapField[];
  onClose: () => void;
  onDone: () => void;
}) {
  const signed = useSigned();
  const { act, busy } = useAct();
  const [values, setValues] = useState<Readonly<Record<string, Value>>>({});
  const [warnings, setWarnings] = useState<readonly Finding[] | null>(null);
  const missing = fields.filter((f) => row.missing.includes(f.key));
  const changes = [{ personId: row.personId, values: formInputs(values) }];

  const save = async (): Promise<void> => {
    if (warnings === null) {
      const checked = await ask<{ findings: (Finding & { personId: string })[] }>(
        signed,
        'GridCheck',
        { changes },
      );
      if (checked.ok && checked.data.findings.length > 0) {
        setWarnings(checked.data.findings);
        return;
      }
    }
    const saved = await act<{ held: number | null }>('SaveCompletenessGrid', { changes }, (d) =>
      d.held === null || d.held === 0 ? 'Saved' : 'Sent to HR for approval',
    );
    if (saved === null) return;
    onClose();
    onDone();
  };

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{`Fill in for ${row.name}`}</DialogTitle>
          <DialogDescription>What HR owns and is missing.</DialogDescription>
        </DialogHeader>
        <DialogBody>
          <Stack gap={3}>
            {missing.map((f) => (
              <AttributeInput
                key={f.key}
                field={asField(f)}
                value={values[f.key]}
                onChange={(value) => {
                  setValues((v) => ({ ...v, [f.key]: value }));
                  setWarnings(null);
                }}
                warning={warnings?.find((w) => w.key === f.key)?.message}
              />
            ))}
          </Stack>
        </DialogBody>
        <DialogFooter>
          <Button className="flex-1" onPress={onClose}>
            Cancel
          </Button>
          <Button
            className="flex-1"
            variant="primary"
            disabled={Object.keys(values).length === 0}
            loading={busy !== null}
            onPress={() => void save()}
          >
            {warnings !== null && warnings.length > 0 ? 'Save anyway' : 'Save'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/**
 * Missing details (design E5): the four desktop figures as one card, then a
 * row each — Remind for what the person fills in themselves, Fill in for
 * what HR owns. Remind-all is desktop only.
 */
export function Missing({
  completeness,
  complete,
  onOpen,
  onDone,
}: {
  completeness: CompletenessState;
  complete: { percent: number; incomplete: number } | null;
  onOpen: (personId: string, name: string) => void;
  onDone: () => void;
}): React.JSX.Element {
  const signed = useSigned();
  const { act, busy } = useAct();
  const [rows, setRows] = useState(completeness.rows);
  const [next, setNext] = useState(completeness.next);
  const [more, setMore] = useState(false);
  const [filling, setFilling] = useState<GapRow | null>(null);
  const [reminded, setReminded] = useState<readonly string[]>([]);
  const labelOf = (key: string): string =>
    completeness.fields.find((f) => f.key === key)?.label ?? key;

  return (
    <Stack gap={3}>
      <Card>
        <Stack gap={2}>
          {complete === null ? null : (
            <>
              <Text variant="title1">{`${String(complete.percent)}% complete`}</Text>
              <Progress value={complete.percent} label="Records complete" />
            </>
          )}
          <Text tone="muted">
            {`${String(completeness.waiting.people)} waiting on employees · ${String(completeness.toFill)} for HR`}
          </Text>
          {completeness.blocking === null || completeness.blocking === 0 ? null : (
            <Text variant="footnote" tone="warning">
              {`${String(completeness.blocking)} missing bank, tax or ID details payroll needs.`}
            </Text>
          )}
        </Stack>
      </Card>
      <List>
        {rows.map((row) => {
          const done = reminded.includes(row.personId);
          return (
            <ListItem
              key={row.personId}
              leading={<Avatar name={row.name} size={40} decorative />}
              description={`Missing: ${row.missing.map(labelOf).join(', ')}`}
              onPress={() => {
                onOpen(row.personId, row.name);
              }}
              trailing={
                row.owner === 'hr' ? (
                  <Button
                    size="sm"
                    variant="primary"
                    onPress={() => {
                      setFilling(row);
                    }}
                  >
                    Fill in
                  </Button>
                ) : done ? (
                  <Button size="sm" variant="ghost" disabled>
                    Reminded
                  </Button>
                ) : (
                  <Button
                    size="sm"
                    loading={busy === 'RequestDetails'}
                    onPress={() => {
                      void act(
                        'RequestDetails',
                        { personId: row.personId, keys: row.missing },
                        `Reminded ${row.name.split(' ')[0] ?? row.name}`,
                      ).then((sent) => {
                        if (sent !== null) setReminded((held) => [...held, row.personId]);
                      });
                    }}
                  >
                    Remind
                  </Button>
                )
              }
            >
              {row.name}
            </ListItem>
          );
        })}
      </List>
      {next === null ? null : (
        <Button
          loading={more}
          onPress={() => {
            setMore(true);
            void ask<CompletenessState>(signed, 'Completeness', { after: next }).then((page) => {
              setMore(false);
              if (!page.ok) return;
              setRows((held) => [...held, ...page.data.rows]);
              setNext(page.data.next);
            });
          }}
        >
          Show more people
        </Button>
      )}
      {filling === null ? null : (
        <FillIn
          row={filling}
          fields={completeness.fields}
          onClose={() => {
            setFilling(null);
          }}
          onDone={onDone}
        />
      )}
    </Stack>
  );
}
