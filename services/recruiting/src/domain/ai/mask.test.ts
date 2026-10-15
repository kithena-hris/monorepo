import { describe, expect, it } from 'vitest';

import { maskApplication } from './mask.js';

const yuki = {
  name: 'Yuki Sato',
  email: 'yuki@example.com',
  phone: '+34 612 345 678',
  city: 'Madrid',
};

const cv = `Yuki Sato
yuki@example.com · +34 612 345 678 · linkedin.com/in/yukisato
Calle de Alcalá 42, 28014 Madrid
Date of birth: 12/03/1991
Nationality: Japanese
Marital status: married, two children
Religion: Buddhist

Senior product designer, 34 years old. Ms Sato led design at Acme.
Member of the trade union UGT. Registered disability, adjustments at interview.
Studied at the University of Tokyo and Hochschule für Gestaltung Ulm.`;

describe('masking before a model reads an application (PRD §14.6)', () => {
  const { text, masked } = maskApplication(cv, yuki, { schools: true });

  it('keeps the work and the city', () => {
    expect(text).toContain('Senior product designer');
    expect(text).toContain('led design at Acme');
    expect(text).toContain('Madrid');
  });

  it('removes who the person is and how to reach them', () => {
    for (const gone of ['Yuki', 'Sato', 'yuki@example.com', '612 345 678', 'linkedin.com'])
      expect(text).not.toContain(gone);
  });

  it('removes the address beyond the city', () => {
    expect(text).not.toContain('Alcalá');
    expect(text).not.toContain('28014');
  });

  it('removes protected characteristics, labelled or in a sentence', () => {
    for (const gone of [
      'Date of birth',
      'Religion',
      'health',
      '12/03/1991',
      'Japanese',
      'married',
      'children',
      'Buddhist',
      '34 years old',
      'Ms ',
      'UGT',
      'disability',
    ])
      expect(text).not.toContain(gone);
  });

  it('keeps the dates of a career', () => {
    const career = maskApplication('Acme, 2018 - 2022. Then Globex 2022–2025.', yuki, {
      schools: false,
    }).text;
    expect(career).toBe('Acme, 2018 - 2022. Then Globex 2022–2025.');
    expect(
      maskApplication('Call (415) 555-0100 or 030 1234567', yuki, { schools: false }).text,
    ).toBe('Call [masked] or [masked]');
  });

  it('masks a profile link, not a site whose name ends like one', () => {
    expect(
      maskApplication('Built dropbox.com/developers apps; see x.com/yuki', yuki, { schools: false })
        .text,
    ).toBe('Built dropbox.com/developers apps; see [masked]');
  });

  it('removes schools only when the company asks', () => {
    expect(text).not.toContain('Tokyo');
    expect(text).not.toContain('Ulm');
    const kept = maskApplication(cv, yuki, { schools: false }).text;
    expect(kept).toContain('University of Tokyo');
  });

  it('counts what it removed, for the audit beside the assessment', () => {
    expect(masked.name).toBeGreaterThan(0);
    expect(masked.contact).toBeGreaterThan(0);
    expect(masked.birth).toBe(1);
    expect(masked.school).toBe(2);
  });

  it('masks German and Spanish labels too', () => {
    const de = maskApplication(
      'Geburtsdatum: 1. März 1991\nStaatsangehörigkeit: deutsch\nFamilienstand: ledig\nKonfession: evangelisch',
      yuki,
      { schools: false },
    ).text;
    for (const gone of ['1991', 'deutsch', 'ledig', 'evangelisch', 'Geburtsdatum'])
      expect(de).not.toContain(gone);
    const es = maskApplication('Fecha de nacimiento: 12/03/1991\nNacionalidad: española', yuki, {
      schools: false,
    }).text;
    expect(es).not.toContain('española');
  });
});
