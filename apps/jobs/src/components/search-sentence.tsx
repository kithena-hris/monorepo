'use client';

import { Alert, Button, Input } from '@reach/ui';
import { useRouter } from 'next/navigation';
import { useState, useTransition, type JSX } from 'react';

import { planSearch } from '../lib/browser-api';

/**
 * J8 on search (PRD §10.6): a sentence becomes the search's filters, shown in
 * the address and the filter controls where the person can change them. An
 * AI fills the filters; the database searches.
 */
export function SearchSentence(): JSX.Element {
  const router = useRouter();
  const [sentence, setSentence] = useState('');
  const [failed, setFailed] = useState(false);
  const [pending, start] = useTransition();
  return (
    <form
      className="flex w-full max-w-3xl flex-col gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        start(async () => {
          const filters = await planSearch(sentence);
          if (filters === null) {
            setFailed(true);
            return;
          }
          const query = new URLSearchParams();
          for (const [k, v] of Object.entries(filters)) {
            if (k === 'page' || (k === 'sort' && v === 'relevance')) continue;
            query.set(k, Array.isArray(v) ? v.join(',') : String(v));
          }
          router.push(`/search?${query.toString()}`);
        });
      }}
    >
      <div className="flex gap-2">
        <Input
          aria-label="Describe the job you want"
          placeholder="Remote design jobs in Spain paying over 50k"
          value={sentence}
          onChange={(e) => {
            setSentence(e.target.value);
          }}
          className="flex-1"
        />
        <Button
          type="submit"
          variant="secondary"
          loading={pending}
          disabled={sentence.trim() === ''}
        >
          Describe it
        </Button>
      </div>
      <p className="text-xs text-fg-muted">
        An AI turns your words into the filters below; check them.
      </p>
      {failed ? <Alert tone="info" title="Use the filters for this one" /> : null}
    </form>
  );
}
