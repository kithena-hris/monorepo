import { describe, expect, it } from 'vitest';

import { DUNDER_MIFFLIN } from './seed-companies.js';
import { CHARACTERS, avatarFor, drawAvatar } from './seed-photos.js';

describe('Dunder Mifflin’s avatars', () => {
  const handles = DUNDER_MIFFLIN.people.map((p) => p.handle);

  it('draws everybody on the roster as their character, and nobody else', () => {
    expect(Object.keys(CHARACTERS).sort()).toEqual([...handles].sort());
  });

  it('gives each person a spec nobody else has', () => {
    const specs = handles.map((h, i) => JSON.stringify(avatarFor(h, i)));
    expect(new Set(specs).size).toBe(handles.length);
  });

  it('draws the same PNG every time', () => {
    const png = drawAvatar(avatarFor('dwight.schrute', 0));
    expect(Array.from(png.subarray(1, 4))).toEqual([0x50, 0x4e, 0x47]);
    expect(drawAvatar(avatarFor('dwight.schrute', 0))).toEqual(png);
  });
});
