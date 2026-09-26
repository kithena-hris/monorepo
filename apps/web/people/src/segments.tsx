import {
  Alert,
  Button,
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Field,
  FieldControl,
  FieldLabel,
  Input,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Stack,
  Switch,
} from '@reach/ui';
import { useState, type JSX } from 'react';

import type { Outcome } from './load';

/**
 * Saved segments (PEO-068, PRD §16.3): one filter, saved once, applied in the
 * directory, the export builder and analytics.
 *
 * People decides which segments are offered — only those this viewer could
 * use here — and applies each as this viewer, so a picker never needs to know
 * why one is missing.
 */

export interface SegmentRef {
  readonly id: string;
  readonly name: string;
}

const NONE = '__none';

/** Pick a saved segment, or none. */
export function SegmentSelect({
  segments,
  value,
  onChange,
}: {
  readonly segments: readonly SegmentRef[];
  readonly value: string | null;
  readonly onChange: (id: string | null) => void;
}): JSX.Element | null {
  if (segments.length === 0 && value === null) return null;
  return (
    <Select
      value={value ?? NONE}
      onValueChange={(next) => {
        onChange(next === NONE ? null : next);
      }}
    >
      <SelectTrigger aria-label="Segment" className="w-auto min-w-40">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={NONE}>Segment: none</SelectItem>
        {segments.map((s) => (
          <SelectItem key={s.id} value={s.id}>
            Segment: {s.name}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

/** Save the filters in force as a named segment, for oneself or the tenant. */
export function SaveSegment({
  onSave,
}: {
  readonly onSave: (segment: { name: string; shared: boolean }) => Promise<Outcome>;
}): JSX.Element {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [shared, setShared] = useState(false);
  const [busy, setBusy] = useState(false);
  const [refused, setRefused] = useState<string | null>(null);
  const close = () => {
    setOpen(false);
    setName('');
    setShared(false);
    setRefused(null);
  };

  return (
    <>
      <Button
        onClick={() => {
          setOpen(true);
        }}
      >
        Save as segment
      </Button>
      <Dialog
        open={open}
        onOpenChange={(next) => {
          if (!next) close();
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Save as segment</DialogTitle>
            <DialogDescription>
              The filters, not the people: whoever uses it sees only the people they may see.
            </DialogDescription>
          </DialogHeader>
          <DialogBody>
            <Stack gap={4}>
              <Field required>
                <FieldLabel>Name</FieldLabel>
                <FieldControl>
                  <Input
                    value={name}
                    maxLength={80}
                    onChange={(e) => {
                      setName(e.target.value);
                    }}
                  />
                </FieldControl>
              </Field>
              <Field orientation="horizontal" className="justify-start">
                <FieldControl>
                  <Switch checked={shared} onCheckedChange={setShared} />
                </FieldControl>
                <FieldLabel>Share with everybody in the company</FieldLabel>
              </Field>
              <p className="text-xs text-fg-muted">
                It can be used in the directory, the export builder and analytics.
              </p>
              {refused === null ? null : (
                <Alert tone="danger" title="Not saved">
                  {refused}
                </Alert>
              )}
            </Stack>
          </DialogBody>
          <DialogFooter>
            <Button onClick={close}>Cancel</Button>
            <Button
              variant="primary"
              disabled={name.trim() === ''}
              loading={busy}
              loadingLabel="Saving"
              onClick={() => {
                setBusy(true);
                setRefused(null);
                void onSave({ name: name.trim(), shared }).then((outcome) => {
                  setBusy(false);
                  if (outcome.ok) close();
                  else setRefused(outcome.message);
                });
              }}
            >
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
