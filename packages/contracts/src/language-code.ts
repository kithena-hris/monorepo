import * as z from 'zod';

import { LANGUAGES, type Language } from './language.js';

/** A language Kithena speaks, as a schema: what identity checks a company's language against. */
export const LanguageCode = z.enum(LANGUAGES.map((l) => l.code) as [Language, ...Language[]]);
