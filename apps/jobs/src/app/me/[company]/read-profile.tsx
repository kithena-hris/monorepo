'use client';

import { Alert, Button, Chip, ChipRow, Field, FieldControl, FieldLabel, Textarea } from '@reach/ui';
import { useEffect, useState, useTransition, type JSX } from 'react';

import { publicApi } from '../../../lib/browser-api';

interface Said {
  readonly value: string;
}
interface Mine {
  readonly profile: {
    readonly work: readonly {
      readonly employer: Said;
      readonly title: Said;
      readonly from: Said;
      readonly to: Said | null;
    }[];
    readonly skills: readonly Said[];
    readonly languages: readonly (Said & { readonly level: string | null })[];
  };
  readonly confirmedAt: string | null;
}

/** PRD §14.2: the candidate checks what was read from their CV, and says what is wrong. */
export function ReadProfile({
  company,
  token,
  applicationId,
}: {
  readonly company: string;
  readonly token: string;
  readonly applicationId: string;
}): JSX.Element | null {
  const [mine, setMine] = useState<Mine | null>(null);
  const [note, setNote] = useState('');
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  useEffect(() => {
    void publicApi<Mine | null>(company, `/me/applications/${applicationId}/profile`, {
      token,
    }).then((answer) => {
      if (answer.ok) setMine(answer.data);
    });
  }, [company, token, applicationId]);
  if (mine === null) return null;
  if (done || mine.confirmedAt !== null)
    return <Alert tone="success" title="You checked what we read from your CV" />;
  return (
    <div className="flex flex-col gap-3">
      <p className="font-medium">What we read from your CV</p>
      <p className="text-sm text-fg-muted">
        A program read your CV without your name or personal details. Check it; the hiring team sees
        what you say.
      </p>
      <ul className="flex flex-col gap-1 text-sm">
        {mine.profile.work.map((w) => (
          <li key={`${w.employer.value}:${w.from.value}`}>
            {`${w.title.value}, ${w.employer.value} · ${w.from.value} – ${w.to?.value ?? 'now'}`}
          </li>
        ))}
      </ul>
      <ChipRow>
        {mine.profile.skills.map((x) => (
          <Chip key={x.value}>{x.value}</Chip>
        ))}
        {mine.profile.languages.map((l) => (
          <Chip key={l.value}>{l.level === null ? l.value : `${l.value} ${l.level}`}</Chip>
        ))}
      </ChipRow>
      {error === null ? null : <Alert tone="danger" title={error} />}
      <Field>
        <FieldLabel>Anything wrong or missing? (optional)</FieldLabel>
        <FieldControl>
          <Textarea
            autoResize
            value={note}
            onChange={(e) => {
              setNote(e.target.value);
            }}
          />
        </FieldControl>
      </Field>
      <Button
        size="sm"
        loading={pending}
        onClick={() => {
          start(async () => {
            const answer = await publicApi(
              company,
              `/me/applications/${applicationId}/profile/confirm`,
              { method: 'POST', body: { note: note === '' ? null : note }, token },
            );
            if (answer.ok) setDone(true);
            else setError(answer.message);
          });
        }}
      >
        {note === '' ? 'It is right' : 'Send my corrections'}
      </Button>
    </div>
  );
}
