import { Button } from '@reach/ui';
import Link from 'next/link';
import type { JSX } from 'react';

import { SearchBar } from '../components/search-bar';

/** J1: the search, and a few ways in. */
export default function Home(): JSX.Element {
  const shortcuts: readonly [string, string][] = [
    ['Remote in Spain', '/search?country=ES&workMode=remote'],
    ['Backend', '/search?q=backend'],
    ['Design', '/search?q=design'],
    ['Berlin', '/search?q=berlin&country=DE'],
    ['Part time', '/search?hours=part_time'],
  ];
  return (
    <section className="flex flex-col items-center gap-6 py-16 text-center">
      <h1 className="max-w-3xl text-4xl font-bold tracking-tight text-balance sm:text-5xl">
        Find work at companies that hire on Kithena
      </h1>
      <p className="text-lg text-fg-muted">No account needed to search or apply.</p>
      <SearchBar />
      <nav aria-label="Popular searches" className="flex flex-wrap justify-center gap-2">
        {shortcuts.map(([label, href]) => (
          <Button key={label} asChild variant="secondary" size="sm">
            <Link href={href}>{label}</Link>
          </Button>
        ))}
      </nav>
    </section>
  );
}
