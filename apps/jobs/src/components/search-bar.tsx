'use client';

import {
  Button,
  Input,
  SegmentedControl,
  SegmentedControlItem,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  icons,
} from '@reach/ui';
import { useRouter } from 'next/navigation';
import { useState, useTransition, type JSX } from 'react';

import { planSearch } from '../lib/browser-api';
import { countryName } from '../lib/format';

/**
 * The search (J1, J2, J8): one bar, two ways to say it. Keywords and a
 * country are a GET form, so every search is an address and the first page
 * is the server's. "Describe it" takes a sentence ("remote design jobs in
 * Spain paying over 50k"): an AI turns it into the same filters, which land
 * in the address where the person can see and change them, and the database
 * searches. Nothing the model says is a result.
 */
export function SearchBar({
  q = '',
  country = '',
  said = '',
  size = 'md',
}: {
  readonly q?: string;
  readonly country?: string;
  /** What the AI understood the last time, shown under the bar. */
  readonly said?: string;
  readonly size?: 'md' | 'lg';
}): JSX.Element {
  const router = useRouter();
  const [mode, setMode] = useState<'keywords' | 'describe'>(said === '' ? 'keywords' : 'describe');
  const [sentence, setSentence] = useState(said);
  const [failed, setFailed] = useState(false);
  const [pending, start] = useTransition();
  const control = size === 'lg' ? 'lg' : 'md';
  return (
    <div className="flex w-full max-w-3xl flex-col gap-3">
      <SegmentedControl
        aria-label="How to search"
        size="sm"
        value={mode}
        onValueChange={(v) => {
          if (v === 'keywords' || v === 'describe') setMode(v);
        }}
      >
        <SegmentedControlItem value="keywords">Keywords</SegmentedControlItem>
        <SegmentedControlItem value="describe">Describe it</SegmentedControlItem>
      </SegmentedControl>
      {mode === 'keywords' ? (
        <form
          action="/search"
          method="get"
          role="search"
          className="flex w-full flex-col gap-2 sm:flex-row"
        >
          <Input
            name="q"
            size={control}
            defaultValue={q}
            aria-label="Job title, skill or company"
            placeholder="Job title, skill or company"
            className="flex-1"
          />
          <Select name="country" defaultValue={country === '' ? 'any' : country}>
            <SelectTrigger aria-label="Country" size={control} className="sm:w-48">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="any">Anywhere</SelectItem>
              {['DE', 'ES', 'GB', 'IN', 'US'].map((c) => (
                <SelectItem key={c} value={c}>
                  {countryName(c)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button type="submit" size={control} startIcon={<icons.search aria-hidden />}>
            Search
          </Button>
        </form>
      ) : (
        <form
          role="search"
          className="flex w-full flex-col gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            setFailed(false);
            start(async () => {
              const plan = await planSearch(sentence);
              if (plan === null) {
                setFailed(true);
                return;
              }
              const query = new URLSearchParams();
              for (const [k, v] of Object.entries(plan.filters)) {
                if (k === 'page' || (k === 'sort' && v === 'relevance')) continue;
                query.set(k, Array.isArray(v) ? v.join(',') : String(v));
              }
              if (plan.say !== '') query.set('said', plan.say);
              router.push(`/search?${query.toString()}`);
            });
          }}
        >
          <div className="flex flex-col gap-2 sm:flex-row">
            <Input
              size={control}
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
              size={control}
              startIcon={<icons.assistant aria-hidden />}
              loading={pending}
              disabled={sentence.trim().length < 3}
            >
              Find jobs
            </Button>
          </div>
          <p className="text-sm text-fg-muted">
            {failed
              ? 'That one did not turn into filters. Try keywords, or say it another way.'
              : 'An AI turns your words into filters you can see and change. It never ranks you.'}
          </p>
        </form>
      )}
    </div>
  );
}
