import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

/** Every variable a file reads: `process.env['X']`, or `required('X')`. */
const envRead = async (path: string): Promise<Set<string>> =>
  new Set(
    [
      ...(await readFile(new URL(path, import.meta.url), 'utf8')).matchAll(
        /(?:process\.env\[|required\()'(\w+)'/g,
      ),
    ].map((m) => m[1] ?? ''),
  );

describe('the Vercel entry', () => {
  // Twice a pair's secret was read by `main.ts` and not by the Vercel entry,
  // and every email under it was refused with a 401 in production only.
  it('reads every variable main.ts reads, bar the local mail catcher', async () => {
    const vercel = await envRead('../api/gateway.ts');
    const local = [...(await envRead('./main.ts'))].filter(
      (name) => !['SMTP_URL', 'MAILBOX_URL', 'NODE_ENV', 'PORT', 'HOST'].includes(name),
    );
    expect(local.filter((name) => !vercel.has(name))).toEqual([]);
  });
});
