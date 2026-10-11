import { describe, expect, it, vi } from 'vitest';

vi.mock('expo-location', () => ({}));

const { metresBetween, officeAt } = await import('./office-area');

const madrid = { name: 'Madrid', latitude: 40.4168, longitude: -3.7038, radiusMetres: 150 };

describe('the office area', () => {
  it('measures the ground between two points', () => {
    // Puerta del Sol to the Royal Palace: about 1 km.
    const palace = { latitude: 40.418, longitude: -3.7143 };
    expect(Math.round(metresBetween(madrid, palace) / 100)).toBe(9);
  });

  it('finds the office a point is inside, and none outside every radius', () => {
    expect(officeAt({ latitude: 40.4175, longitude: -3.7038 }, [madrid])?.name).toBe('Madrid');
    expect(officeAt({ latitude: 40.42, longitude: -3.7038 }, [madrid])).toBeNull();
  });
});
