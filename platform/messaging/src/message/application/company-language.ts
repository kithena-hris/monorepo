import { ENGLISH, type Language } from '../domain/invitation.js';

/**
 * The language a company's emails are written in, and its words: the one the
 * back office chose for it, whatever language each reader chose for their own
 * screens. US English when it cannot be learnt, because an email in the code's
 * own words beats one not sent.
 */
export type CompanyLanguage = (tenantId: string) => Promise<Language>;

export const inEnglish: CompanyLanguage = () => Promise.resolve(ENGLISH);
