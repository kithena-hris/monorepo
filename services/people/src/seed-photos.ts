import { deflateSync } from 'node:zlib';

/**
 * Sample photos for the seeded companies: an illustrated head and shoulders
 * in flat colours, drawn here, pixel by pixel, into a PNG.
 *
 * Nobody's photograph. Dunder Mifflin's people are *The Office*'s characters,
 * and a real picture of one is an actor's face in a copyrighted still, so
 * each gets a drawing instead, chosen by what the character is known for —
 * Dwight's centre parting, glasses and mustard shirt, Kevin's bald head,
 * Stanley's moustache (`CHARACTERS`). Anybody else, Acme's sample people
 * among them, gets a figure picked from a few palettes by their index.
 *
 * Geometry and nothing else, deterministic from the spec, so the seed needs no
 * download, no licence and no binary in the repository, and a re-seed draws
 * the same picture. Seed data only: `seed-local.ts` and
 * `load-demo-company.ts` use it.
 */

type Rgb = readonly [number, number, number];

export type HairStyle =
  | 'short'
  | 'side'
  | 'centre'
  | 'tousled'
  | 'quiff'
  | 'crop'
  | 'long'
  | 'bob'
  | 'bun'
  | 'ponytail'
  | 'receding'
  | 'balding'
  | 'bald';

export interface Avatar {
  readonly background: Rgb;
  readonly skin: Rgb;
  readonly hair: Rgb;
  readonly hairStyle: HairStyle;
  readonly facialHair?: 'moustache' | 'beard' | 'goatee' | 'stubble';
  /** The facial hair's colour, when it is not the hair's. */
  readonly beard?: Rgb;
  readonly glasses?: boolean;
  /** Jacket, sweater or top. */
  readonly clothes: Rgb;
  /** A shirt showing at the neck; absent, a plain round neck. */
  readonly shirt?: Rgb;
  readonly tie?: Rgb;
  /** Slim sits taller in the frame; broad has a wider face and shoulders. */
  readonly build?: 'slim' | 'broad';
}

/* ------------------------------------------------------------ colours -- */

const SKIN = {
  fair: [246, 213, 188],
  light: [238, 196, 164],
  warm: [226, 178, 138],
  olive: [206, 158, 118],
  tan: [184, 130, 92],
  brown: [141, 94, 64],
  deep: [102, 66, 46],
} as const satisfies Record<string, Rgb>;

const HAIR = {
  black: [34, 30, 30],
  darkBrown: [66, 44, 32],
  brown: [104, 70, 44],
  lightBrown: [150, 108, 68],
  auburn: [140, 62, 36],
  ginger: [198, 104, 56],
  red: [168, 48, 38],
  blonde: [226, 190, 118],
  honey: [192, 150, 92],
  grey: [178, 176, 172],
  saltPepper: [120, 116, 110],
  greyBlack: [72, 70, 70],
} as const satisfies Record<string, Rgb>;

const BG = {
  blue: [219, 234, 254],
  green: [220, 252, 231],
  amber: [254, 243, 199],
  pink: [252, 231, 243],
  violet: [237, 233, 254],
  teal: [204, 251, 241],
  orange: [255, 237, 213],
  slate: [226, 232, 240],
  sky: [224, 242, 254],
  lime: [236, 252, 203],
  rose: [255, 228, 230],
  stone: [236, 234, 228],
} as const satisfies Record<string, Rgb>;

const WHITE: Rgb = [246, 246, 244];
const PALE_BLUE: Rgb = [206, 224, 244];
const NAVY: Rgb = [36, 52, 92];
const CHARCOAL: Rgb = [62, 66, 74];

/**
 * Dunder Mifflin's people, by handle: each drawn as the character is best
 * known, so nobody on the chart can be mistaken for anybody else.
 */
export const CHARACTERS: Readonly<Record<string, Avatar>> = {
  'david.wallace': {
    background: BG.slate,
    skin: SKIN.light,
    hair: HAIR.darkBrown,
    hairStyle: 'short',
    clothes: NAVY,
    shirt: WHITE,
    tie: [128, 32, 48],
  },
  'jan.levinson': {
    background: BG.violet,
    skin: SKIN.fair,
    hair: HAIR.brown,
    hairStyle: 'bob',
    clothes: [30, 30, 36],
    shirt: [232, 222, 210],
  },
  'michael.scott': {
    background: BG.blue,
    skin: SKIN.light,
    hair: HAIR.black,
    hairStyle: 'side',
    clothes: CHARCOAL,
    shirt: WHITE,
    tie: [178, 36, 44],
  },
  'dwight.schrute': {
    background: BG.green,
    skin: SKIN.fair,
    hair: HAIR.brown,
    hairStyle: 'centre',
    glasses: true,
    clothes: [206, 160, 40],
    shirt: [206, 160, 40],
    tie: [96, 62, 34],
  },
  'jim.halpert': {
    background: BG.sky,
    skin: SKIN.light,
    hair: HAIR.brown,
    hairStyle: 'tousled',
    build: 'slim',
    clothes: [120, 140, 160],
    shirt: PALE_BLUE,
    tie: [40, 44, 56],
  },
  'pam.beesly': {
    background: BG.pink,
    skin: SKIN.fair,
    hair: HAIR.auburn,
    hairStyle: 'long',
    clothes: [236, 170, 170],
    shirt: WHITE,
  },
  'andy.bernard': {
    background: BG.amber,
    skin: SKIN.light,
    hair: HAIR.lightBrown,
    hairStyle: 'side',
    clothes: [150, 28, 40],
    shirt: WHITE,
  },
  'stanley.hudson': {
    background: BG.orange,
    skin: SKIN.deep,
    hair: HAIR.greyBlack,
    hairStyle: 'crop',
    facialHair: 'moustache',
    glasses: true,
    clothes: [98, 84, 64],
    shirt: [238, 232, 214],
    tie: [70, 90, 60],
  },
  'phyllis.vance': {
    background: BG.rose,
    skin: SKIN.light,
    hair: HAIR.honey,
    hairStyle: 'bob',
    clothes: [186, 150, 206],
  },
  'angela.martin': {
    background: BG.stone,
    skin: SKIN.fair,
    hair: HAIR.blonde,
    hairStyle: 'bun',
    build: 'slim',
    clothes: [128, 118, 150],
    shirt: WHITE,
  },
  'oscar.martinez': {
    background: BG.teal,
    skin: SKIN.tan,
    hair: HAIR.black,
    hairStyle: 'short',
    facialHair: 'beard',
    clothes: [74, 94, 120],
    shirt: PALE_BLUE,
    tie: [52, 40, 70],
  },
  'kevin.malone': {
    background: BG.lime,
    skin: SKIN.light,
    hair: HAIR.brown,
    hairStyle: 'bald',
    build: 'broad',
    clothes: [70, 110, 170],
    shirt: [70, 110, 170],
    tie: [34, 50, 90],
  },
  'toby.flenderson': {
    background: BG.stone,
    skin: SKIN.light,
    hair: HAIR.saltPepper,
    hairStyle: 'balding',
    facialHair: 'beard',
    clothes: [176, 160, 128],
    shirt: [214, 206, 186],
    tie: [104, 88, 70],
  },
  'kelly.kapoor': {
    background: BG.pink,
    skin: SKIN.brown,
    hair: HAIR.black,
    hairStyle: 'long',
    clothes: [214, 40, 130],
  },
  'ryan.howard': {
    background: BG.slate,
    skin: SKIN.light,
    hair: HAIR.darkBrown,
    hairStyle: 'quiff',
    facialHair: 'stubble',
    build: 'slim',
    clothes: [34, 34, 40],
    shirt: WHITE,
  },
  'meredith.palmer': {
    background: BG.green,
    skin: SKIN.light,
    hair: HAIR.red,
    hairStyle: 'bob',
    clothes: [60, 128, 96],
  },
  'creed.bratton': {
    background: BG.amber,
    skin: SKIN.light,
    hair: HAIR.grey,
    hairStyle: 'receding',
    clothes: [96, 104, 70],
    shirt: [196, 190, 170],
  },
  'erin.hannon': {
    background: BG.sky,
    skin: SKIN.fair,
    hair: HAIR.ginger,
    hairStyle: 'ponytail',
    clothes: [240, 200, 70],
    shirt: WHITE,
  },
  'pete.miller': {
    background: BG.orange,
    skin: SKIN.fair,
    hair: HAIR.ginger,
    hairStyle: 'short',
    clothes: [70, 100, 150],
    shirt: PALE_BLUE,
  },
  'clark.green': {
    background: BG.violet,
    skin: SKIN.fair,
    hair: HAIR.darkBrown,
    hairStyle: 'side',
    build: 'slim',
    clothes: [110, 120, 130],
    shirt: WHITE,
    tie: NAVY,
  },
  'darryl.philbin': {
    background: BG.blue,
    skin: SKIN.deep,
    hair: HAIR.black,
    hairStyle: 'crop',
    facialHair: 'goatee',
    clothes: [60, 90, 140],
    shirt: [60, 90, 140],
  },
  'roy.anderson': {
    background: BG.stone,
    skin: SKIN.warm,
    hair: HAIR.brown,
    hairStyle: 'short',
    facialHair: 'stubble',
    build: 'broad',
    clothes: [120, 84, 52],
  },
  'nate.nickerson': {
    background: BG.lime,
    skin: SKIN.warm,
    hair: HAIR.brown,
    hairStyle: 'bald',
    facialHair: 'stubble',
    clothes: [236, 120, 40],
  },
  'val.johnson': {
    background: BG.rose,
    skin: SKIN.brown,
    hair: HAIR.black,
    hairStyle: 'long',
    clothes: [120, 40, 60],
  },
  'madge.madsen': {
    background: BG.teal,
    skin: SKIN.light,
    hair: HAIR.grey,
    hairStyle: 'bob',
    clothes: [90, 110, 130],
    shirt: [90, 110, 130],
  },
  'lonny.collins': {
    background: BG.slate,
    skin: SKIN.brown,
    hair: HAIR.black,
    hairStyle: 'crop',
    facialHair: 'moustache',
    build: 'broad',
    clothes: [100, 100, 104],
  },
  'holly.flax': {
    background: BG.teal,
    skin: SKIN.fair,
    hair: HAIR.honey,
    hairStyle: 'long',
    clothes: [40, 140, 150],
  },
  'karen.filippelli': {
    background: BG.violet,
    skin: SKIN.olive,
    hair: HAIR.darkBrown,
    hairStyle: 'long',
    clothes: [110, 50, 110],
    shirt: WHITE,
  },
  'nellie.bertram': {
    background: BG.rose,
    skin: SKIN.fair,
    hair: HAIR.lightBrown,
    hairStyle: 'bob',
    clothes: [196, 50, 60],
  },
  'gabe.lewis': {
    background: BG.green,
    skin: SKIN.fair,
    hair: HAIR.ginger,
    hairStyle: 'side',
    build: 'slim',
    clothes: [150, 150, 156],
    shirt: WHITE,
    tie: [30, 70, 120],
  },
};

/** Anybody without a character: a figure from a few palettes, by index. */
const SAMPLE_BACKGROUNDS = Object.values(BG).slice(0, 8);
const SAMPLE_SKIN: readonly Rgb[] = [
  [241, 194, 158],
  [198, 134, 94],
  [224, 172, 128],
  [141, 85, 54],
  [255, 219, 180],
  [170, 110, 75],
];
const SAMPLE_HAIR: readonly Rgb[] = [
  [44, 34, 30],
  [110, 72, 42],
  [196, 160, 94],
  [86, 86, 90],
  [150, 60, 35],
];
const SAMPLE_CLOTHES: readonly Rgb[] = [
  [37, 99, 235],
  [5, 150, 105],
  [217, 119, 6],
  [190, 24, 93],
  [109, 40, 217],
  [15, 118, 110],
  [71, 85, 105],
];

const pick = <T>(list: readonly T[], i: number): T => list[i % list.length] as T;

/** The character a handle names, else a sample figure for `index`. */
export function avatarFor(handle: string, index: number): Avatar {
  return (
    CHARACTERS[handle] ?? {
      background: pick(SAMPLE_BACKGROUNDS, index),
      skin: pick(SAMPLE_SKIN, index * 5 + 1),
      hair: pick(SAMPLE_HAIR, index * 3),
      hairStyle: index % 3 === 1 ? 'long' : 'short',
      clothes: pick(SAMPLE_CLOTHES, index * 2 + 1),
    }
  );
}

/** The PNG for sample person `index`, who has no character. */
export function samplePhoto(index: number): Uint8Array {
  return drawAvatar(avatarFor('', index));
}

/* ------------------------------------------------------------ drawing -- */

const SIZE = 256;
/** Samples per pixel edge: 4×4, so the curves are smooth rather than stepped. */
const SS = 4;

type Shape = (x: number, y: number) => boolean;

const ellipse =
  (cx: number, cy: number, rx: number, ry: number): Shape =>
  (x, y) =>
    (x - cx) ** 2 / rx ** 2 + (y - cy) ** 2 / ry ** 2 <= 1;
const any =
  (...shapes: Shape[]): Shape =>
  (x, y) =>
    shapes.some((s) => s(x, y));

const mix = (a: Rgb, b: Rgb, t: number): Rgb => [
  a[0] + (b[0] - a[0]) * t,
  a[1] + (b[1] - a[1]) * t,
  a[2] + (b[2] - a[2]) * t,
];

const INK: Rgb = [40, 34, 32];

/** What is drawn where, front to back: the first shape a point is in gives its colour. */
function layers(a: Avatar): [Shape, Rgb][] {
  const cx = 128;
  // Slim sits higher, so the figure reads as the tall one.
  const hy = a.build === 'slim' ? 100 : 108;
  const rx = a.build === 'broad' ? 51 : 46;
  const ry = 54;
  const head = ellipse(cx, hy, rx, ry);
  const top = hy - ry;
  const facial = a.beard ?? a.hair;
  const out: [Shape, Rgb][] = [];

  // Face.
  const eyeY = hy + 4;
  const eyes = any(ellipse(cx - 17, eyeY, 4.5, 5), ellipse(cx + 17, eyeY, 4.5, 5));
  if (a.glasses === true) {
    const lens = (ex: number): Shape => {
      const outer = ellipse(ex, eyeY, 14, 11);
      const inner = ellipse(ex, eyeY, 11, 8);
      return (x, y) => outer(x, y) && !inner(x, y);
    };
    const bridge: Shape = (x, y) => Math.abs(x - cx) <= 4 && Math.abs(y - eyeY + 1) <= 1.5;
    out.push([any(lens(cx - 17), lens(cx + 17), bridge), [30, 30, 34]]);
  }
  out.push([eyes, INK]);
  const smileOuter = ellipse(cx, hy + 30, 12, 9);
  const smileInner = ellipse(cx, hy + 28, 12, 8);
  const mouth: Shape = (x, y) => y > hy + 30 && smileOuter(x, y) && !smileInner(x, y);
  out.push([mouth, [150, 64, 64]]);
  const moustache = ellipse(cx, hy + 26, 17, 5.5);
  if (a.facialHair === 'moustache') out.push([moustache, facial]);
  if (a.facialHair === 'goatee') {
    out.push([any(moustache, ellipse(cx, hy + 46, 12, 10)), facial]);
  }
  if (a.facialHair === 'beard' || a.facialHair === 'stubble') {
    // The jaw, less the cheeks: high at the sideburns, low at the mouth.
    const jaw = ellipse(cx, hy, rx + 2, ry + 3);
    const cheeks = ellipse(cx, hy + 2, rx - 10, 26);
    const beard: Shape = (x, y) =>
      y > hy - 6 && (y > hy + 20 ? jaw(x, y) : head(x, y)) && !cheeks(x, y);
    out.push([
      any(beard, moustache),
      a.facialHair === 'beard' ? facial : mix(a.skin, facial, 0.35),
    ]);
  }

  // Hair over the head frames the face: inside the hair's outline, outside a
  // face window whose top is the hairline, and down the sides to `sides`.
  const outline = (grow: number): Shape => ellipse(cx, hy - grow, rx + 5, ry + grow + 1);
  const cap = (hairline: number, grow = 5, sides = hy + 4): Shape => {
    const outer = outline(grow);
    const face = ellipse(cx, hy + 30, rx - 6, hy + 30 - hairline);
    return (x, y) => y < sides && outer(x, y) && !face(x, y);
  };
  // A band round the back of the head, from `from` down to the ears.
  const band = (from: number): Shape => {
    const outer = outline(2);
    const inner = ellipse(cx, hy + 2, rx - 5, ry - 1);
    return (x, y) => y > from && y < hy + 4 && outer(x, y) && !inner(x, y);
  };
  const front: Shape[] = [];
  const back: Shape[] = [];
  switch (a.hairStyle) {
    case 'short':
      front.push(cap(hy - 16));
      break;
    case 'side':
      front.push(cap(hy - 18), ellipse(cx - 18, hy - 26, 32, 10));
      break;
    case 'centre': {
      const hair = cap(hy - 10, 4, hy + 12);
      // The parting: skin down the middle of the crown.
      front.push((x, y) => hair(x, y) && !(Math.abs(x - cx) < 1.8 && y < hy - 22));
      break;
    }
    case 'tousled':
      front.push(
        cap(hy - 14, 10),
        ellipse(cx - 14, hy - 26, 24, 12),
        ellipse(cx + 16, hy - 28, 22, 10),
      );
      break;
    case 'quiff':
      front.push(cap(hy - 20), ellipse(cx + 6, top + 2, 32, 14));
      break;
    case 'crop':
      front.push(cap(hy - 24, 2, hy - 6));
      break;
    case 'long':
      front.push(cap(hy - 18, 5, hy + 30), ellipse(cx + 14, hy - 28, 28, 10));
      back.push((x, y) => y > top && ellipse(cx, hy + 18, rx + 14, ry + 50)(x, y) && y < hy + 76);
      break;
    case 'bob':
      front.push(cap(hy - 18, 5, hy + 24), ellipse(cx - 12, hy - 28, 28, 9));
      back.push((x, y) => ellipse(cx, hy + 4, rx + 12, ry + 10)(x, y) && y < hy + 42);
      break;
    case 'bun':
      front.push(cap(hy - 22, 2, hy - 4));
      back.push(ellipse(cx, top - 14, 20, 17));
      break;
    case 'ponytail':
      front.push(cap(hy - 18, 3, hy + 2), ellipse(cx - 18, hy - 28, 26, 9));
      back.push(ellipse(cx + rx - 2, hy + 40, 12, 34));
      break;
    case 'receding': {
      const forehead = ellipse(cx, hy - 36, 24, 28);
      front.push(
        (x, y) => cap(hy - 18, 4)(x, y) && !forehead(x, y),
        ellipse(cx - rx - 2, hy - 18, 7, 13),
        ellipse(cx + rx + 2, hy - 18, 7, 13),
      );
      break;
    }
    case 'balding':
      front.push(band(hy - 30));
      break;
    case 'bald':
      break;
  }
  if (front.length > 0) out.push([any(...front), a.hair]);

  // Head and neck.
  // Ears, unless the hair falls over them.
  const covered = a.hairStyle === 'long' || a.hairStyle === 'bob';
  const ears = any(ellipse(cx - rx, eyeY + 6, 7, 11), ellipse(cx + rx, eyeY + 6, 7, 11));
  const neck: Shape = (x, y) => Math.abs(x - cx) <= 17 && y >= hy + 40 && y <= hy + 80;
  out.push([covered ? any(head, neck) : any(head, ears, neck), a.skin]);
  if (back.length > 0) out.push([any(...back), a.hair]);

  // Clothes: a tie over a shirt's V, inside the shoulders.
  const shoulders = ellipse(cx, 262, a.build === 'slim' ? 90 : a.build === 'broad' ? 110 : 98, 86);
  const neckline = hy + 64;
  if (a.tie !== undefined) {
    const knot: Shape = (x, y) => Math.abs(x - cx) <= 7 && y >= neckline + 4 && y <= neckline + 15;
    const blade: Shape = (x, y) =>
      y > neckline + 15 && Math.abs(x - cx) <= 5 + (y - neckline - 15) * 0.14;
    out.push([(x, y) => shoulders(x, y) && (knot(x, y) || blade(x, y)), a.tie]);
  }
  if (a.shirt !== undefined) {
    out.push([
      (x, y) => shoulders(x, y) && y >= neckline && Math.abs(x - cx) <= 18 + (y - neckline) * 0.3,
      a.shirt,
    ]);
  }
  out.push([shoulders, a.clothes]);
  return out;
}

/** The PNG for an avatar. */
export function drawAvatar(a: Avatar): Uint8Array {
  const drawn = layers(a);
  // Each row starts with its filter byte (0: none).
  const raw = Buffer.alloc((SIZE * 3 + 1) * SIZE);
  for (let y = 0; y < SIZE; y += 1) {
    raw[y * (SIZE * 3 + 1)] = 0;
    for (let x = 0; x < SIZE; x += 1) {
      let r = 0;
      let g = 0;
      let b = 0;
      for (let sy = 0; sy < SS; sy += 1) {
        for (let sx = 0; sx < SS; sx += 1) {
          const px = x + (sx + 0.5) / SS;
          const py = y + (sy + 0.5) / SS;
          const c = drawn.find(([shape]) => shape(px, py))?.[1] ?? a.background;
          r += c[0];
          g += c[1];
          b += c[2];
        }
      }
      const o = y * (SIZE * 3 + 1) + 1 + x * 3;
      raw[o] = Math.round(r / (SS * SS));
      raw[o + 1] = Math.round(g / (SS * SS));
      raw[o + 2] = Math.round(b / (SS * SS));
    }
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(SIZE, 0);
  header.writeUInt32BE(SIZE, 4);
  header.set([8, 2, 0, 0, 0], 8); // 8-bit, RGB, deflate, no filter, no interlace
  return new Uint8Array(
    Buffer.concat([
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      chunk('IHDR', header),
      chunk('IDAT', deflateSync(raw, { level: 9 })),
      chunk('IEND', Buffer.alloc(0)),
    ]),
  );
}

function chunk(type: string, data: Buffer): Buffer {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'latin1'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, crc]);
}

const TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

function crc32(bytes: Buffer): number {
  let c = 0xffffffff;
  for (const b of bytes) c = (TABLE[(c ^ b) & 0xff] ?? 0) ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
