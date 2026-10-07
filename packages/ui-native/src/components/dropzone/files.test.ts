import { describe, expect, it } from 'vitest';

import { checkFile, displayName, formatBytes, middleTruncate, type PickedFile } from './files.ts';

const file = (
  name: string,
  type: string,
  size = 1000,
  extra: Partial<PickedFile> = {},
): PickedFile => ({
  uri: `file:///${name}`,
  name,
  type,
  size,
  ...extra,
});

describe('checkFile', () => {
  const images = ['image/png', 'image/jpeg', 'image/webp'];

  it('says what to use instead of a refused type', () => {
    expect(checkFile(file('notes.pdf', 'application/pdf'), { accept: images })?.message).toBe(
      'notes.pdf is a PDF. Use PNG, JPG or WebP.',
    );
    expect(
      checkFile(file('holiday.mov', 'video/quicktime'), {
        accept: ['application/pdf', 'image/png', 'image/jpeg'],
      })?.message,
    ).toBe('Videos aren’t accepted. Use PDF, PNG or JPG.');
  });

  it('names the size and the limit', () => {
    expect(
      checkFile(file('scan.pdf', 'application/pdf', 38 * 1024 * 1024), {
        maxSize: 10 * 1024 * 1024,
      })?.message,
    ).toBe('38 MB is over the 10 MB limit.');
  });

  it('refuses an image under the floor', () => {
    expect(
      checkFile(file('office.jpg', 'image/jpeg', 1000, { width: 640, height: 480 }), {
        minDimensions: { width: 1200, height: 800 },
      })?.message,
    ).toBe('office.jpg is 640 × 480. Use at least 1200 × 800.');
  });

  it('blocks a program dressed as a document', () => {
    expect(checkFile(file('invoice.pdf.exe', 'application/pdf'), {})?.message).toBe(
      'Blocked: this is a program, not a PDF.',
    );
  });

  it('passes a good file', () => {
    expect(checkFile(file('a.png', 'image/png'), { accept: images, maxSize: 5000 })).toBeNull();
  });
});

describe('names', () => {
  it('drops a path and truncates in the middle', () => {
    expect(displayName('../../etc/passwd')).toBe('passwd');
    expect(
      middleTruncate('a-very-long-file-name-that-keeps-going-and-going-until-it-truncates.pdf'),
    ).toMatch(/^a-very-long.*….*truncates\.pdf$/);
    expect(formatBytes(820 * 1024)).toBe('820 KB');
    expect(formatBytes(2.1 * 1024 * 1024)).toBe('2.1 MB');
  });
});
