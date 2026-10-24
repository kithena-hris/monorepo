import * as z from 'zod';
import { err, failure, ok, type Result } from '@kithena/domain-kit';

import {
  contractFigures,
  particularsFor,
  toConfirm,
  type ContractFacts,
  type Particular,
} from '../domain/contract/particulars.js';
import { latest } from '../domain/offer/offer.js';
import { write, type PromptSpec } from './ai.js';
import { everyCatalogue } from './catalogue.js';
import { mailWords, notFound, type Ctx } from './context.js';
import { editableOffer, resolvedTermsOf } from './offers.js';

/**
 * The contract, drafted (Recruiting PRD §21.1): the statutory particulars of
 * the employing entity's country, each with its value from the accepted offer
 * (`particularsFor`), and the contract written around them by a model.
 *
 * The model never sees a name: the parties are `[[EMPLOYER]]` and
 * `[[EMPLOYEE]]` until the draft comes back here. It writes no figure the
 * particulars did not give; where Kithena holds nothing (an address, a pay
 * day) it leaves `[[TO CONFIRM: …]]`, and the screen will not send a draft
 * that still has one. Any figure it wrote that no particular gave is shown
 * to the person sending it (`contractFigures`). With the writer switched off
 * the particulars still come back, and the screen draws the contract from
 * them alone.
 */

const Draft = z.object({
  title: z.string().min(1).max(200),
  clauses: z
    .array(z.object({ heading: z.string().max(120), text: z.string().min(1).max(4000) }))
    .min(1)
    .max(40),
});

const DRAFT: PromptSpec<z.infer<typeof Draft>> = {
  feature: 'writer',
  version: 'contract-draft@1',
  instruction: `You draft an employment contract for an employer in "country", under that country's employment law, written in the language named in "language". Return a JSON object {"title":"","clauses":[{"heading":"","text":""}]}. Write numbered clauses in plain sentences an employee and a court can both read. State every item of "particulars" with its "value" exactly as given, and cite its "law" where that helps the reader. Where a value is null, write the clause with the placeholder [[TO CONFIRM: what is needed]] instead of inventing it. Refer to the parties only as [[EMPLOYER]] and [[EMPLOYEE]]. Use no figure, date or amount that "particulars" does not give. Add the clauses that country's law and practice expect in an employment contract (duties, confidentiality, data protection, intellectual property, entire agreement, changes in writing, governing law and jurisdiction) without new figures. Never write a signature block, a date line or any line that starts with "Signature" or "Signed": the signatures are added after.`,
  answer: Draft,
};

export interface ContractDraft {
  readonly particulars: readonly Particular[];
  /** Null when the writer is off: the screen draws the contract from the particulars. */
  readonly draft: {
    readonly title: string;
    readonly body: string;
    /** What the draft asks a person to confirm before it may be sent. */
    readonly toConfirm: readonly string[];
    /** Figures in the draft that no particular gave. */
    readonly figures: readonly string[];
  } | null;
}

const EMPLOYER = '[[EMPLOYER]]';
const EMPLOYEE = '[[EMPLOYEE]]';

/** A line Documents would read as a place to sign (`signatureLines`), which the model must not write. */
const SIGN_LINE = /^\s*(signature|signed|sign here|firma|unterschrift|assinatura)\b/iu;

export async function draftContract(ctx: Ctx, offerId: string): Promise<Result<ContractDraft>> {
  const offer = await ctx.tx.offers.get(offerId);
  if (offer === null) return err(notFound('offer'));
  const loaded = await editableOffer(ctx, offer.applicationId);
  if (!loaded.ok) return loaded;
  if (offer.state !== 'accepted')
    return err(failure('NOT_ACCEPTED', 'A contract is drafted from an accepted offer'));
  const { job, candidate } = loaded.value;
  const version = latest(offer);
  const terms = await resolvedTermsOf(ctx, offer, job, version.startDate);
  if (!terms.ok) return terms;
  const entity = job.entityId === null ? null : await ctx.tx.entities.get(job.entityId);
  const location =
    job.locationIds[0] === undefined ? null : await ctx.tx.locations.get(job.locationIds[0]);
  const { language } = await mailWords(ctx);
  const chosen = new Set(version.benefitIds);
  const benefits = (await everyCatalogue(ctx))
    .filter((b) => chosen.has(b.id))
    .map((b) => b.names[language] ?? b.names['en'] ?? Object.values(b.names)[0] ?? b.key);
  const facts = (employer: string, employee: string): ContractFacts => ({
    employer: { name: employer, address: null },
    employee: { name: employee, address: null },
    role: job.title,
    placeOfWork:
      terms.value.workMode === 'remote'
        ? `remote, from ${terms.value.remoteCountry ?? terms.value.country}`
        : location === null
          ? null
          : [location.city, location.region, location.country].filter(Boolean).join(', '),
    terms: terms.value,
    pay: version.pay,
    benefits,
    startDate: version.startDate,
    overtimeExempt: typeof version.terms['exempt'] === 'boolean' ? version.terms['exempt'] : null,
  });
  const employer = entity?.name ?? job.title;
  const particulars = particularsFor(facts(employer, candidate.name));
  const drafted = await write(ctx, DRAFT, {
    country: terms.value.country,
    region: terms.value.region,
    language,
    role: job.title,
    particulars: particularsFor(facts(EMPLOYER, EMPLOYEE)),
  });
  if (!drafted.ok) {
    if (drafted.error.code === 'AI_OFF') return ok({ particulars, draft: null });
    return drafted;
  }
  const named = (text: string): string =>
    text.replaceAll(EMPLOYER, employer).replaceAll(EMPLOYEE, candidate.name);
  const body = drafted.value.clauses
    .map((c, i) => {
      const text = c.text
        .split('\n')
        .filter((line) => !SIGN_LINE.test(line))
        .join('\n');
      const heading = c.heading.trim().replace(/^\d+[.)]\s*/u, '');
      return `${String(i + 1)}. ${named(heading)}\n${named(text)}`;
    })
    .join('\n\n');
  return ok({
    particulars,
    draft: {
      title: named(drafted.value.title),
      body,
      toConfirm: toConfirm(body),
      figures: contractFigures(body, particulars),
    },
  });
}
