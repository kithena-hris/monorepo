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
  FieldDescription,
  FieldLabel,
  Input,
  List,
  ListItem,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  icons,
} from '@reach/ui';
import { useState, type JSX } from 'react';

import type { Outcome } from '../load';
import { keyOf } from './add-leave-type';
import { Toggle, shortDate } from './shared';

/**
 * One holiday calendar, new or changed (T36's "Add calendar", TOF-099a): its
 * name, whether it is national, regional or a city's, whether a holiday on a
 * weekend moves to Monday, and its days in the year on show. Other years'
 * days are kept as they are. Time Off checks every day again.
 */

export interface Layer {
  readonly key: string;
  readonly name: string;
  readonly level: 'national' | 'regional' | 'city';
  readonly weekendRule: 'move_to_monday' | 'none';
  readonly holidays: readonly { readonly date: string; readonly name: string }[];
}

export function HolidayCalendar({
  layer,
  year,
  onSave,
  onRemove,
  onClose,
}: {
  /** `null` for a new one. */
  readonly layer: Layer | null;
  readonly year: number;
  readonly onSave: (key: string, layer: Omit<Layer, 'key'>) => Promise<Outcome>;
  readonly onRemove?: (key: string) => Promise<Outcome>;
  readonly onClose: () => void;
}): JSX.Element {
  const [name, setName] = useState(layer?.name ?? '');
  const [level, setLevel] = useState<Layer['level']>(layer?.level ?? 'city');
  const [moves, setMoves] = useState(layer?.weekendRule === 'move_to_monday');
  const [days, setDays] = useState(layer?.holidays ?? []);
  const [date, setDate] = useState('');
  const [dayName, setDayName] = useState('');
  const [busy, setBusy] = useState(false);
  const [refused, setRefused] = useState<string | null>(null);
  const key = layer?.key ?? keyOf(name);
  const shown = days
    .filter((d) => d.date.startsWith(String(year)))
    .toSorted((a, b) => a.date.localeCompare(b.date));
  const act = (run: () => Promise<Outcome>): void => {
    setBusy(true);
    setRefused(null);
    void run().then((outcome) => {
      setBusy(false);
      if (outcome.ok) onClose();
      else setRefused(outcome.message);
    });
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
          <DialogTitle>{layer === null ? 'Add a calendar' : layer.name}</DialogTitle>
          <DialogDescription>
            {`Its days in ${String(year)}. A location keeps it once it is ticked there.`}
          </DialogDescription>
        </DialogHeader>
        <DialogBody className="flex flex-col gap-4">
          <Field required>
            <FieldLabel>Name</FieldLabel>
            <FieldControl>
              <Input
                value={name}
                maxLength={200}
                placeholder="For example, Valencia city"
                onChange={(e) => {
                  setName(e.target.value);
                }}
              />
            </FieldControl>
          </Field>
          <Field>
            <FieldLabel>Level</FieldLabel>
            <Select
              value={level}
              onValueChange={(l) => {
                setLevel(l as Layer['level']);
              }}
            >
              <FieldControl>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
              </FieldControl>
              <SelectContent>
                <SelectItem value="national">National</SelectItem>
                <SelectItem value="regional">Regional</SelectItem>
                <SelectItem value="city">City</SelectItem>
              </SelectContent>
            </Select>
          </Field>
          <Toggle
            kind="checkbox"
            label="A holiday on a Sunday moves to Monday"
            checked={moves}
            onChange={setMoves}
          />
          {shown.length === 0 ? (
            <p className="text-sm text-fg-muted">{`No days in ${String(year)} yet.`}</p>
          ) : (
            <List aria-label={`Days in ${String(year)}`}>
              {shown.map((d) => (
                <ListItem
                  key={`${d.date} ${d.name}`}
                  description={shortDate(d.date)}
                  trailing={
                    <Button
                      variant="ghost"
                      aria-label={`Remove ${d.name}`}
                      startIcon={<icons.delete aria-hidden />}
                      onClick={() => {
                        setDays(days.filter((x) => x !== d));
                      }}
                    />
                  }
                >
                  {d.name}
                </ListItem>
              ))}
            </List>
          )}
          <fieldset className="flex min-w-0 flex-col gap-3">
            <legend className="mb-1 text-sm font-medium">Add a day</legend>
            <Field>
              <FieldLabel>Date</FieldLabel>
              <FieldControl>
                <Input
                  type="date"
                  value={date}
                  min={`${String(year)}-01-01`}
                  max={`${String(year)}-12-31`}
                  onChange={(e) => {
                    setDate(e.target.value);
                  }}
                />
              </FieldControl>
            </Field>
            <Field>
              <FieldLabel>Holiday</FieldLabel>
              <FieldControl>
                <Input
                  value={dayName}
                  maxLength={200}
                  onChange={(e) => {
                    setDayName(e.target.value);
                  }}
                />
              </FieldControl>
              <FieldDescription>As people will read it on their calendar.</FieldDescription>
            </Field>
            <div>
              <Button
                size="sm"
                variant="secondary"
                startIcon={<icons.add aria-hidden />}
                disabled={date === '' || dayName.trim() === ''}
                onClick={() => {
                  setDays([...days, { date, name: dayName.trim() }]);
                  setDate('');
                  setDayName('');
                }}
              >
                Add day
              </Button>
            </div>
          </fieldset>
          {refused === null ? null : (
            <Alert tone="danger" title="Not saved">
              {refused}
            </Alert>
          )}
        </DialogBody>
        <DialogFooter>
          {layer === null || onRemove === undefined ? null : (
            <Button
              variant="ghost"
              className="mr-auto"
              disabled={busy}
              onClick={() => {
                act(() => onRemove(layer.key));
              }}
            >
              Remove calendar
            </Button>
          )}
          <Button onClick={onClose}>Cancel</Button>
          <Button
            variant="primary"
            startIcon={<icons.confirm aria-hidden />}
            disabled={key === '' || name.trim() === ''}
            loading={busy}
            loadingLabel="Saving"
            onClick={() => {
              act(() =>
                onSave(key, {
                  name: name.trim(),
                  level,
                  weekendRule: moves ? 'move_to_monday' : 'none',
                  holidays: days.toSorted((a, b) => a.date.localeCompare(b.date)),
                }),
              );
            }}
          >
            Save calendar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
