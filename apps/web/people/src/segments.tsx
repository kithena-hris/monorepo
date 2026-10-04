import {
  Alert,
  Button,
  Field,
  FieldControl,
  FieldLabel,
  Input,
  Popover,
  PopoverContent,
  PopoverTrigger,
  RadioGroup,
  RadioGroupItem,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Stack,
  icons,
} from '@reach/ui';
import { useState, type JSX } from 'react';

import { useHeld } from './held';
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

/**
 * Save the filters in force as a named view (W5), for oneself or the company:
 * a small panel beside the button rather than a dialog over the list, so the
 * people being saved stay in sight. A shared view is checked as whoever opens
 * it, so sharing never widens what anybody sees.
 */
export function SaveSegment({
  onSave,
  label = 'Save view',
  open: heldOpen,
  onOpenChange,
}: {
  readonly onSave: (segment: { name: string; shared: boolean }) => Promise<Outcome>;
  /** The button's words: "Save as view" beside a question's results. */
  readonly label?: string;
  /** Open, held by the host (`?save=view`), so a link opens it. */
  readonly open?: boolean;
  readonly onOpenChange?: (open: boolean) => void;
}): JSX.Element {
  const [open, setOpen] = useHeld(heldOpen, onOpenChange, false);
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
    <Popover
      open={open}
      onOpenChange={(next) => {
        if (next) setOpen(true);
        else close();
      }}
    >
      <PopoverTrigger asChild>
        <Button variant="ghost" size="sm" startIcon={<icons.starred aria-hidden />}>
          {label}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-85">
        <Stack gap={4}>
          <h2 className="text-md font-bold text-fg">Save this view</h2>
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
          <RadioGroup
            aria-label="Who can use it"
            value={shared ? 'company' : 'me'}
            onValueChange={(next) => {
              setShared(next === 'company');
            }}
          >
            <RadioGroupItem value="me">Only me</RadioGroupItem>
            <RadioGroupItem
              value="company"
              description="Others see only the people and fields they can already see."
            >
              Share with the company
            </RadioGroupItem>
          </RadioGroup>
          {refused === null ? null : (
            <Alert tone="danger" title="Not saved">
              {refused}
            </Alert>
          )}
          <div className="flex justify-end gap-2">
            <Button variant="ghost" size="sm" onClick={close}>
              Cancel
            </Button>
            <Button
              variant="primary"
              size="sm"
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
              Save view
            </Button>
          </div>
        </Stack>
      </PopoverContent>
    </Popover>
  );
}
