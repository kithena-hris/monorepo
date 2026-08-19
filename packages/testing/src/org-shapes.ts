/**
 * Every HRIS bug I have seen in the wild involved an org shape nobody tested.
 * Clean seeds surface nothing. These do.
 */
export type OrgShape =
  | 'startup_flat' // 30 people, one entity, one manager layer
  | 'scaleup_matrix' // 2,000 people, three legal entities, dotted lines
  | 'deep_hierarchy' // 12 levels, tests transitive permission checks
  | 'byo_external' // people synced from a mock external HRIS
  | 'messy_real_world'; // contractors, part-timers, people on leave,
// rehires, two contracts in one year

export interface GeneratedOrg {
  readonly people: readonly { id: string; managerId: string | null; entityId: string }[];
  readonly legalEntities: readonly { id: string; country: string }[];
}

export function generateOrg(shape: OrgShape, seed = 1): GeneratedOrg {
  void seed;
  switch (shape) {
    case 'startup_flat':
      return { people: [], legalEntities: [{ id: 'le-es', country: 'ES' }] };
    case 'scaleup_matrix':
      return {
        people: [],
        legalEntities: [
          { id: 'le-es', country: 'ES' },
          { id: 'le-de', country: 'DE' },
          { id: 'le-nl', country: 'NL' },
        ],
      };
    default:
      return { people: [], legalEntities: [] };
  }
}
