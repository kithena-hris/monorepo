import { describe, expect, it } from 'vitest';

import { define, versionOf } from '../person/in-memory.js';
import { importTemplate, templateHeaders } from './template.js';

/**
 * The import template (V6, "Template"): the header row of a file People
 * would take from this viewer, labelled as the mapper matches, and nothing
 * else — no example row, so no invented person.
 */

const HR = {
  isSelf: false,
  isManager: false,
  isInManagerChain: false,
  isHr: true,
  isFinance: false,
  isAdmin: false,
};

const version = versionOf(1, [
  define({ key: 'given_name', label: { default: 'First name' } }),
  define({ key: 'job_title', label: { default: 'Job title' } }),
  // The employee's own to give: not HR's to import.
  define({ key: 'emergency_contact', label: { default: 'Emergency contact' }, ownership: ['employee'] }),
  // No longer collected.
  define({
    key: 'old_code',
    label: { default: 'Old code' },
    deprecatedAt: '2026-01-01T00:00:00.000Z',
  }),
  // Many items per person: a sheet of its own, never a column.
  define({ key: 'certifications', label: { default: 'Certifications' }, cardinality: 'repeating' }),
]);

describe('the import template', () => {
  it('heads a column for each live field this viewer may write, by its label', () => {
    expect(templateHeaders(version, HR)).toEqual(['First name', 'Job title']);
  });

  it('is one header row of CSV that a spreadsheet opens as UTF-8', () => {
    const text = new TextDecoder('utf-8', { ignoreBOM: true }).decode(importTemplate(version, HR));
    expect(text).toBe('﻿First name,Job title\r\n');
  });
});
