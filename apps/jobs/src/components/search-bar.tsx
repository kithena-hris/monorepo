import {
  Button,
  Input,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@reach/ui';
import type { JSX } from 'react';

import { countryName } from '../lib/format';

/** The search: a GET form, so every search is an address and the first page is the server's. */
export function SearchBar({
  q = '',
  country = '',
}: {
  readonly q?: string;
  readonly country?: string;
}): JSX.Element {
  return (
    <form
      action="/search"
      method="get"
      role="search"
      className="flex w-full max-w-3xl flex-col gap-2 sm:flex-row"
    >
      <Input
        name="q"
        defaultValue={q}
        aria-label="Job title, skill or company"
        placeholder="Job title, skill or company"
        className="flex-1"
      />
      <Select name="country" defaultValue={country === '' ? 'any' : country}>
        <SelectTrigger aria-label="Country" className="sm:w-48">
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
      <Button type="submit">Search</Button>
    </form>
  );
}
