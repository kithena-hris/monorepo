import type { LaunchCountry } from '@kithena/contracts';

import { germany } from './de.js';
import { spain } from './es.js';
import { unitedKingdom } from './gb.js';
import { india } from './in.js';
import type { TermsPack } from './pack.js';
import { unitedStates } from './us.js';

/** The launch set (PRD §19.1): one pack per country People's packs cover. */
export const PACKS: Readonly<Record<LaunchCountry, TermsPack>> = {
  DE: germany,
  ES: spain,
  GB: unitedKingdom,
  IN: india,
  US: unitedStates,
};

export const packFor = (country: LaunchCountry): TermsPack => PACKS[country];
