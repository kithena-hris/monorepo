import { describe, expect, it } from 'vitest';

import { NOTE as DE } from '../domain/terms/de.js';
import { NOTE as ES } from '../domain/terms/es.js';
import { NOTE as GB } from '../domain/terms/gb.js';
import { NOTE as IN } from '../domain/terms/in.js';
import { NOTE as US } from '../domain/terms/us.js';
import { contractNote } from './pack-notes.js';

const english = (_key: string, fallback: unknown): string => String(fallback);

describe('each contract type’s note, in the reader’s words', () => {
  it('is the pack’s own line, word for word, for every contract type of every country', () => {
    for (const [country, notes] of Object.entries({ DE, ES, GB, IN, US }))
      for (const [key, note] of Object.entries(notes))
        expect(contractNote(english, country, key), `${country}.${key}`).toBe(note);
    expect(contractNote(english, 'ES', 'nothing_of_the_kind')).toBeNull();
  });
});
