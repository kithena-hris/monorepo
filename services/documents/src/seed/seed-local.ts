import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { PDFDocument, StandardFonts } from 'pdf-lib';
import {
  TenantId,
  type CalendarDate,
  type DocumentTypeKey,
  type PersonId,
} from '@kithena/contracts';
import { systemClock } from '@kithena/domain-kit';
import { logger } from '@kithena/telemetry';

import { share, upload } from '../application/documents.js';
import { seedTypes } from '../application/organise.js';
import type { Caller, Deps } from '../application/ports.js';
import { blobsFrom } from '../infrastructure/blobs.js';
import { documentsConsumer } from '../infrastructure/consumers/handle.js';
import { uuidv7 } from '../infrastructure/ids.js';
import { drizzleUnitOfWork } from '../infrastructure/unit-of-work.js';

/**
 * `… | pnpm --filter @kithena/documents seed` (DOC-026): Acme in Documents,
 * after identity's seed in `pnpm db:seed`, identity's events on stdin as Time
 * Off's seed has them — so Ada is Documents' HR. Then the fifteen document
 * types, the Platform team (the same accounts as Time Off's, so `just dev`
 * signs Adam in as Adam), and a few of the design's documents (B1).
 * Running it again changes nothing. Local only.
 */

if (process.env['NODE_ENV'] === 'production') {
  logger.error('the Documents seed is for a laptop, not a deployment');
  process.exit(1);
}

const port = process.env['POSTGRES_PORT'] ?? '5432';
const ownerUrl =
  process.env['DATABASE_URL'] ?? `postgres://kithena:kithena@localhost:${port}/kithena`;
const url =
  process.env['DOCUMENTS_DATABASE_URL'] ??
  `postgres://svc_documents:kithena@localhost:${port}/kithena`;

const TEAM: readonly (readonly [string, string, string])[] = [
  ['Marco', 'Ruiz', '2021-03-01'],
  ['Adam', 'Novak', '2024-09-02'],
  ['Omar', 'Haddad', '2022-05-16'],
  ['Yuki', 'Sato', '2026-11-02'],
  ['Leo', 'Martin', '2023-01-09'],
  ['Hana', 'Kim', '2025-04-01'],
  ['Ravi', 'Patel', '2020-10-05'],
];
const person = (n: number) => `7ac0e000-0000-7000-8000-${String(n).padStart(12, '0')}` as PersonId;
const account = (n: number) => `7ac0e000-0000-4000-8000-0000000000a${String(n)}`;

async function piped(): Promise<unknown[]> {
  if (process.stdin.isTTY) return [];
  let text = '';
  for await (const chunk of process.stdin) text += String(chunk);
  return text
    .split('\n')
    .filter((line) => line.startsWith('{'))
    .map((line) => JSON.parse(line) as unknown);
}

async function pdf(title: string, pageCount: number): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  for (let i = 0; i < pageCount; i++) {
    const page = doc.addPage([595, 842]);
    page.drawText(title, { x: 56, y: 770, size: 18, font });
    page.drawText(`Page ${String(i + 1)} of ${String(pageCount)}`, { x: 56, y: 60, size: 9, font });
  }
  return doc.save();
}

const owner = postgres(ownerUrl, { max: 1, onnotice: () => {} });
const client = postgres(url, { max: 2 });
try {
  const uow = drizzleUnitOfWork(drizzle(client));
  const deps: Deps = { uow, blobs: blobsFrom(process.env), clock: systemClock, newId: uuidv7 };
  const handle = documentsConsumer(uow);
  for (const event of await piped()) {
    // oxlint-disable-next-line no-await-in-loop -- in order, as a partition is consumed
    await handle(event);
  }
  const [acme] = await owner<{ id: string }[]>`SELECT id FROM platform.tenant WHERE slug = 'acme'`;
  if (acme === undefined) {
    logger.warn('no acme tenant yet; run identity’s seed first');
  } else {
    const tenantId = TenantId.parse(acme.id);
    await seedTypes(deps, tenantId);
    const [hr, seeded] = await uow.run(tenantId, async (tx) => {
      for (const [n, [given, family, hire]] of TEAM.entries()) {
        // oxlint-disable-next-line no-await-in-loop -- seven members, in order
        await tx.members.upsert(
          {
            personId: person(n + 1),
            accountId: account(n + 1),
            displayName: `${given} ${family}`,
            workEmail: `${given}.${family}@acme.example`.toLowerCase(),
            managerPersonId: n === 0 ? null : person(1),
            teamKey: 'platform',
            teamName: 'Platform',
            locationKey: null,
            hireDate: hire as CalendarDate,
            terminationDate: null,
            status: 'active',
          },
          '01890000-0000-7000-8000-000000000001',
          '2026-01-01' as CalendarDate,
        );
      }
      return [(await tx.hr.list())[0], (await tx.documents.filed()).length > 0] as const;
    });
    if (hr === undefined || seeded) {
      logger.info({ hr: hr !== undefined, seeded }, 'Acme’s documents: nothing more to seed');
    } else {
      const as = (accountId: string, personId: PersonId | null): Caller => ({
        tenantId,
        accountId,
        personId,
        correlationId: uuidv7(),
      });
      const file = async (name: string, pages: number) => ({
        name: `${name}.pdf`,
        mediaType: 'application/pdf',
        bytes: await pdf(name, pages),
      });
      const filed = async (
        caller: Caller,
        title: string,
        typeKey: string | null,
        subject: PersonId | null,
        pages: number,
        expiresOn: string | null = null,
      ) => {
        const r = await upload(deps, caller, {
          title,
          typeKey: typeKey as DocumentTypeKey | null,
          subjectPersonId: subject,
          sectionId: null,
          expiresOn: expiresOn as CalendarDate | null,
          requestId: null,
          file: await file(title, pages),
        });
        if (!r.ok) throw new Error(`${title}: ${r.error.message}`);
        return r.value.id;
      };
      const ada = as(hr, null);
      const adam = person(2);
      await filed(ada, 'Employee handbook 2026', 'policy', null, 42);
      await filed(ada, 'Travel and expenses policy', 'policy', null, 8);
      await filed(ada, 'Employment contract', 'employment_contract', adam, 6);
      await filed(ada, 'Remote-work addendum', 'contract_addendum', adam, 3);
      await filed(ada, 'Employment certificate', 'letter', adam, 1);
      await filed(ada, 'Payslip · September 2026', 'payslip', adam, 1);
      await filed(ada, 'Work permit · Omar Haddad', 'work_permit', person(3), 2, '2026-12-02');
      await filed(as(account(2), adam), 'Mortgage pre-approval', null, null, 2);
      const notes = await filed(as(account(2), adam), 'Platform Q4 roadmap notes', null, null, 4);
      await share(deps, as(account(2), adam), notes, [
        { grantee: { kind: 'member', personId: person(1) }, permission: 'edit', endsOn: null },
        { grantee: { kind: 'member', personId: person(3) }, permission: 'view', endsOn: null },
      ]);
      logger.info('Acme’s documents seeded');
    }
  }
} finally {
  await owner.end();
  await client.end();
}
