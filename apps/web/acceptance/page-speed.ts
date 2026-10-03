import { randomUUID } from 'node:crypto';
import { appendFileSync, existsSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium, type Browser, type Page } from 'playwright';

import { ROOT, startStack, type Stack } from './stack';

/**
 * Every page, timed, as an administrator at a company of a thousand meets it:
 * the acceptance stack (production builds, server rendering on), the file
 * given imported, and `ACCEPTANCE_LATENCY_MS` (120 by default) in front of
 * identity, the router and People.
 *
 *   npx tsx apps/web/acceptance/page-speed.ts <out.json> [employees.csv]
 *
 * Per page: the median of three loads in a browser that has loaded it once
 * (TTFB, first paint, LCP, interactive), the sizes from that first load, and
 * the shell's own calls (`KITHENA_TIMING=1`) during the last load.
 */

const OUT = process.argv[2] ?? join(tmpdir(), 'page-speed.json');
const CSV =
  process.argv[3] ?? join(ROOT, 'services/people/src/http/meridian-freight.fixture.csv');
const SHELL_LOG = join(tmpdir(), `page-speed-shell-${randomUUID()}.log`);
process.env['ACCEPTANCE_LATENCY_MS'] ??= '120';
process.env['KITHENA_TIMING'] = '1';
process.env['ACCEPTANCE_SHELL_LOG'] = SHELL_LOG;
/** What only the router holds for People, as `stack.ts` sets it. */
const PEOPLE_TOKEN = 'acceptance-people-token';

interface Graph {
  data?: Record<string, unknown>;
  errors?: { message: string }[];
}

/** People's graph, as the router would call it for `account`: the import's setup. */
function graphAs(stack: Stack, tenantId: string, account: string) {
  return async (query: string, variables: Record<string, unknown> = {}): Promise<unknown> => {
    const answer = (await (
      await fetch(`${stack.peopleUrl}/graphql`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-internal-token': PEOPLE_TOKEN,
          'x-kithena-principal': JSON.stringify({
            userId: account,
            tenantId,
            roles: [],
            entitlements: ['module.people'],
          }),
          'x-correlation-id': randomUUID(),
        },
        body: JSON.stringify({ query, variables }),
      })
    ).json()) as Graph;
    const error = answer.errors?.[0];
    if (error !== undefined) throw new Error(`${query.slice(0, 60)}: ${error.message}`);
    return Object.values(answer.data ?? {})[0];
  };
}

/** The file, through People's own import: upload, map, propose, approve, wait. */
async function importFile(
  graph: ReturnType<typeof graphAs>,
  file: Uint8Array<ArrayBuffer>,
): Promise<void> {
  await graph(
    `mutation { confirmSetupEntity(name: "Meridian Freight", country: "US", idempotencyKey: "speed-entity") { __typename } }`,
  );
  const target = (await graph(
    `mutation ($name: String!, $size: Int!) {
      startImportUpload(name: $name, size: $size) { uploadId url method headers { name value } }
    }`,
    { name: 'meridian.csv', size: file.byteLength },
  )) as { uploadId: string; url: string; method: string; headers: { name: string; value: string }[] };
  await fetch(target.url, {
    method: target.method,
    headers: Object.fromEntries(
      target.headers.filter((h) => h.name !== 'content-length').map((h) => [h.name, h.value]),
    ),
    body: file,
  });
  const stage = (await graph(
    `mutation ($id: ID!) { completeImportUpload(uploadId: $id) {
      __typename ... on ImportMapStage { columns { index status key } }
    } }`,
    { id: target.uploadId },
  )) as { columns: { index: number; status: string; key: string | null }[] };
  const step = {
    uploadId: target.uploadId,
    mapping: Object.fromEntries(
      stage.columns.map((c) => [c.index, c.status === 'mapped' ? c.key : null]),
    ),
  };
  const proposed = JSON.parse(
    (await graph(`mutation ($step: String!) { proposeImportFields(step: $step) }`, {
      step: JSON.stringify(step),
    })) as string,
  ) as { proposals: { counts: unknown; sensitive: unknown }[] };
  const proposals = proposed.proposals.map(({ counts: _c, sensitive: _s, ...p }) => p);
  const { runId } = JSON.parse(
    (await graph(
      `mutation ($input: String!, $key: String!) { runImport(input: $input, idempotencyKey: $key) }`,
      { input: JSON.stringify({ ...step, proposals }), key: 'speed-run' },
    )) as string,
  ) as { runId: string };
  // People picks a stalled run up again every five minutes, so a slow machine waits.
  for (const deadline = Date.now() + 2_700_000; ; ) {
    await new Promise((resolve) => setTimeout(resolve, 10_000));
    if (Date.now() > deadline) throw new Error('the import did not finish');
    // A kept-alive socket the server has just closed is a reset, not an answer.
    const seen = await graph(`query ($id: ID!) { importRun(id: $id) }`, { id: runId }).catch(
      () => null,
    );
    if (seen === null) continue;
    const run = JSON.parse(seen as string) as {
      status: string;
      phase: string;
      failure: string | null;
      people?: { done: number; total: number | null };
    };
    console.log(`import ${run.status} ${run.phase} ${String(run.people?.done ?? '')}`);
    if (run.status === 'succeeded') return;
    if (run.status === 'failed') throw new Error(`the import failed: ${String(run.failure)}`);
  }
}

interface Timing {
  readonly name: string;
  readonly at: number;
  readonly ms: number;
}

/** The shell's timing lines written since `from` bytes into its log. */
function timingsSince(from: number): Timing[] {
  if (!existsSync(SHELL_LOG)) return [];
  return readFileSync(SHELL_LOG, 'utf8')
    .slice(from)
    .split('\n')
    .flatMap((line) => {
      if (!line.startsWith('{"msg":"timing"')) return [];
      try {
        return [JSON.parse(line) as Timing];
      } catch {
        return [];
      }
    });
}
const logSize = (): number => (existsSync(SHELL_LOG) ? statSync(SHELL_LOG).size : 0);

/**
 * In every page: when it hydrated, and the largest paint so far. Strings, not
 * functions: tsx names every function it compiles, with a helper the page
 * does not have.
 */
const OBSERVED_HYDRATED =
  "document.querySelector('[data-remote]') !== null && document.querySelector('[data-remote][data-hydrating]') === null";

const OBSERVE = `
  performance.setResourceTimingBufferSize(10000);
  window.speed = { lcp: -1, interactive: -1 };
  new PerformanceObserver((list) => {
    for (const e of list.getEntries()) window.speed.lcp = e.startTime;
  }).observe({ type: 'largest-contentful-paint', buffered: true });
  new MutationObserver(() => {
    if (window.speed.interactive >= 0) return;
    if (document.querySelector('[data-remote]') !== null &&
        document.querySelector('[data-remote][data-hydrating]') === null) {
      window.speed.interactive = performance.now();
    }
  }).observe(document, { subtree: true, childList: true, attributes: true });
`;

const READ = `(() => {
  const nav = performance.getEntriesByType('navigation')[0];
  const resources = performance.getEntriesByType('resource');
  const sum = (test) => resources.filter((r) => test(r.name)).reduce((n, r) => n + r.decodedBodySize, 0);
  // The flight data Next inlines, as the scripts that pushed it: it empties its own buffer.
  const hasRemote = document.querySelector('[data-remote]') !== null;
  return {
    ttfb: nav.responseStart,
    fcp: performance.getEntriesByName('first-contentful-paint')[0]?.startTime ?? -1,
    lcp: window.speed.lcp,
    interactive: hasRemote ? window.speed.interactive : nav.loadEventEnd,
    html: nav.decodedBodySize,
    rsc: [...document.scripts].filter((s) => s.textContent.startsWith('self.__next_f.push')).reduce((n, s) => n + s.textContent.length, 0),
    remoteJs: sum((n) => n.includes('/_people/') && /\\.m?js(\\?|$)/.test(n)),
    remoteCss: sum((n) => n.includes('/_people/') && /\\.css(\\?|$)/.test(n)),
    shellJs: sum((n) => n.includes('/_next/static/') && /\\.js(\\?|$)/.test(n)),
  };
})()`;

interface Load {
  readonly ttfb: number;
  readonly fcp: number;
  readonly lcp: number;
  readonly interactive: number;
  readonly html: number;
  readonly rsc: number;
  readonly remoteJs: number;
  readonly remoteCss: number;
  readonly shellJs: number;
}

async function load(page: Page, url: string): Promise<Load> {
  await page.goto(url, { waitUntil: 'load', timeout: 60_000 });
  await page.waitForLoadState('networkidle', { timeout: 60_000 }).catch(() => undefined);
  await page
    .waitForFunction(
      "document.querySelector('[data-remote]') === null || window.speed.interactive >= 0",
      undefined,
      { timeout: 30_000 },
    )
    .catch(() => undefined);
  return page.evaluate<Load>(READ);
}

const median = (xs: readonly number[]): number =>
  [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)] ?? -1;

async function measure(browser: Browser, shell: string, session: string, path: string) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await context.addCookies([
    {
      name: '__Host-ksession',
      value: session,
      domain: new URL(shell).hostname,
      path: '/',
      secure: true,
      httpOnly: true,
      sameSite: 'Lax',
    },
  ]);
  await context.addInitScript(OBSERVE);
  const page = await context.newPage();
  const first = await load(page, `${shell}${path}`);
  const loads: Load[] = [];
  let calls: Timing[] = [];
  for (let i = 0; i < 3; i += 1) {
    const from = logSize();
    loads.push(await load(page, `${shell}${path}`));
    // The shell writes its last line a moment after the stream ends.
    await new Promise((resolve) => setTimeout(resolve, 300));
    calls = timingsSince(from);
  }
  const landed = new URL(page.url()).pathname + new URL(page.url()).search;
  await context.close();
  const start = Math.min(...calls.map((c) => c.at));
  const pick = (k: keyof Load) => Math.round(median(loads.map((l) => l[k])));
  return {
    path,
    landed,
    ttfb: pick('ttfb'),
    fcp: pick('fcp'),
    lcp: pick('lcp'),
    interactive: pick('interactive'),
    coldLcp: Math.round(first.lcp),
    html: first.html,
    rsc: first.rsc,
    remoteJs: first.remoteJs,
    remoteCss: first.remoteCss,
    shellJs: first.shellJs,
    graphql: calls.filter((c) => c.name.startsWith('router.')).length,
    identity: calls.filter((c) => c.name.startsWith('identity.')).length,
    server: calls.length === 0 ? 0 : Math.max(...calls.map((c) => c.at + c.ms)) - start,
    calls: calls.map((c) => `${c.name}@${String(c.at - start)}+${String(c.ms)}`),
  };
}

const PAGES = [
  '/',
  '/inbox',
  '/people',
  '/people/directory/list',
  '/people/directory/cards',
  '/people/directory/org-chart',
  '/people/data-health/completeness',
  '/people/data-health/id-checks',
  '/people/data-health/duplicates',
  '/people/data-health/access-requests',
  '/people/approvals',
  '/people/insights/what-changed',
  '/people/insights/headcount',
  '/people/insights/turnover',
  '/people/insights/data-quality',
  '/people/insights/pay',
  '/people/import-export',
  '/people/import',
  '/people/export',
  '/settings',
  '/settings/people',
  '/settings/people/fields',
  '/settings/people/integrations',
  '/settings/people/roles',
  '/settings/people/organisation',
  '/settings/people/reminders',
  '/settings/people/country-packs',
  '/settings/activity',
];

async function main(): Promise<void> {
  const stack = await startStack();
  const browser = await chromium.launch();
  try {
    const made = await stack.provisionCompany({
      slug: 'meridian-freight',
      displayName: 'Meridian Freight',
      admin: 'ines@meridian.example',
      address: {
        country: 'US',
        line1: '233 S Wacker Dr',
        city: 'Chicago',
        subdivision: 'IL',
        postcode: '60606',
      },
      timeZone: 'America/Chicago',
      entitlements: ['module.people', 'module.timeoff'],
      name: { given: 'Ines', family: 'Okafor', preferred: 'Ini' },
    });
    const started = Date.now();
    await importFile(
      graphAs(stack, made.tenantId, made.account),
      new Uint8Array(readFileSync(CSV)),
    );
    console.log(`imported in ${String(Math.round((Date.now() - started) / 1000))}s`);
    // Somebody with a manager and reports: the profile with the most on it.
    const [someone] = await stack.sql<{ id: string }[]>`
      SELECT p.id::text FROM people.person p
       WHERE p.tenant_id = ${made.tenantId}
         AND EXISTS (SELECT 1 FROM people.person r WHERE r.tenant_id = p.tenant_id
                       AND r.manager_id = p.id)
         AND p.manager_id IS NOT NULL
       ORDER BY p.work_email LIMIT 1`;
    const profile = `/people/${someone?.id ?? ''}`;
    // The profile's tabs, as its tab row names them in the address.
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    await context.addCookies([
      {
        name: '__Host-ksession',
        value: made.session,
        domain: new URL(made.shell).hostname,
        path: '/',
        secure: true,
        httpOnly: true,
        sameSite: 'Lax',
      },
    ]);
    const page = await context.newPage();
    await page.goto(`${made.shell}${profile}`);
    await page.waitForLoadState('networkidle');
    await page.waitForFunction(OBSERVED_HYDRATED, undefined, { timeout: 30_000 });
    const tabs: string[] = [];
    for (const tab of await page.getByRole('tab').all()) {
      await tab.click();
      // The address follows the tab once the router has moved.
      await page.waitForURL(/[?&]tab=/, { timeout: 5_000 }).catch(() => undefined);
      const t = new URL(page.url()).searchParams.get('tab');
      if (t !== null && t !== 'overview' && !tabs.includes(`${profile}?tab=${t}`)) {
        tabs.push(`${profile}?tab=${t}`);
      }
    }
    await context.close();
    const pages = [...PAGES, profile, ...tabs, `${profile}/history`];
    writeFileSync(OUT, '');
    for (const path of pages) {
      const row = await measure(browser, made.shell, made.session, path).catch(
        (e: unknown) => ({ path, error: String(e) }),
      );
      appendFileSync(OUT, `${JSON.stringify(row)}\n`);
      console.log(JSON.stringify(row).slice(0, 300));
    }
    // `PAGE_SPEED_HOLD=<path>`: the stack stays up, for People to be asked directly, until that file exists.
    const hold = process.env['PAGE_SPEED_HOLD'];
    if (hold !== undefined && hold !== '') {
      console.log(`holding: People at ${stack.peopleUrl}, tenant ${made.tenantId}, account ${made.account}`);
      while (!existsSync(hold)) await new Promise((resolve) => setTimeout(resolve, 2_000));
    }
  } finally {
    await browser.close();
    await stack.stop();
  }
}

await main();
