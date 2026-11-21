/** Drawing coordinates read off the design grant, converted to meters. */

const L = 4.947
const H = 1.16
const W = 2.266

/** Side view, nose left: pixel to (z, y). */
export const side = (x: number, y: number): [number, number] => [L * (0.5 - x / 2746), (H * (654 - y)) / 654]
/** Plan view, nose left: pixel to (z, x). */
export const plan = (x: number, y: number): [number, number] => [L * (0.5 - x / 2746), (W * (y - 631)) / 1261]
/** Front or rear elevation, left half of the sheet: pixel to (|x|, y). */
export const elev = (x: number, y: number): [number, number] => [(W * (712 - x)) / 1424, (H * (738 - y)) / 738]

export const map = (f: (x: number, y: number) => [number, number], pts: Array<[number, number]>): Array<[number, number]> => pts.map(([x, y]) => f(x, y))

export const sideLines = {
  glass: map(side, [
    [748, 199], [840, 161], [920, 129], [1000, 105], [1080, 83], [1160, 64], [1240, 52], [1320, 47], [1400, 47], [1480, 51], [1556, 62],
    [1562, 110], [1562, 158], [1400, 186], [1240, 210], [1040, 226], [920, 233], [820, 222],
  ]),
  intake: map(side, [[1482, 268], [1550, 262], [1615, 259], [1700, 330], [1780, 411], [1730, 440], [1680, 468], [1580, 370]]),
  upperIntake: map(side, [[1700, 152], [1760, 146], [1795, 150], [1800, 165], [1790, 186], [1720, 192], [1698, 176]]),
  door: map(side, [[1585, 135], [1630, 263], [1592, 345], [1530, 470], [1480, 580], [1260, 562], [1050, 540], [935, 440], [820, 335], [870, 270], [925, 213]]),
}

export const planLines = {
  windscreen: map(plan, [
    [535, 600], [534, 700], [530, 800], [548, 900], [575, 960], [630, 1030], [700, 1072], [850, 1040], [1000, 1003], [1118, 966], [1118, 800], [1118, 600],
  ]),
  rearGlass: map(plan, [[1652, 600], [1652, 760], [1640, 880], [1770, 905], [1780, 600]]),
  bay: map(plan, [[1790, 600], [1790, 900], [2000, 902], [2200, 885], [2350, 850], [2465, 800], [2468, 600]]),
  /** The bonnet's shut line, from the outer end of the cowl round the windscreen's lower corner and forward along the
   * wing ridge to the front edge. Across the middle the bonnet's rear edge is the cowl opening's front edge. */
  bonnet: map(plan, [[530, 925], [520, 950], [600, 1030], [520, 1040], [400, 1030], [260, 990], [140, 940], [70, 880]]),
  /** The cowl opening: front edge the bonnet's rear edge, rear edge 27 mm up under the windscreen's base. */
  cowl: map(plan, [[455, 600], [455, 760], [470, 850], [520, 950], [545, 945], [563, 900], [545, 800], [549, 700], [550, 600]]),
  wing: map(plan, [[2560, 600], [2545, 800], [2520, 950], [2495, 1080], [2470, 1150]]),
}

export type P3 = readonly [number, number, number]

/**
 * The front edge of the body as theoretical sharp corners C(v), (x, y, z) in meters, with the main surface's v at
 * each. The brow runs from the nose tip out to the brow tip over the eye, the side from the brow tip down the cheek's
 * outer edge. The skin rolls over 4 mm onto the fascia along the whole edge, so the paint's lower edge lies 4 mm down
 * the fascia from these points.
 */
export const frontSection = {
  brow: [
    { v: 1, p: [0, 0.385, 2.4737] as P3, name: 'tip' },
    { v: 0.86, p: [0.3, 0.425, 2.355] as P3, name: 'vee' },
    { v: 0.72, p: [0.476, 0.5117, 2.173] as P3, name: 'corner' },
    { v: 0.6, p: [0.5, 0.5057, 2.168] as P3, name: 'rail' },
    { v: 0.4, p: [0.8, 0.598, 2.14] as P3, name: 'brow' },
  ],
  side: [
    { v: 0.4, p: [0.8, 0.598, 2.14] as P3, name: 'brow' },
    { v: 0.22, p: [0.965, 0.5, 1.8] as P3, name: 'crease' },
    { v: 0.1, p: [0.955, 0.3, 1.8] as P3, name: 'sill' },
    { v: 0, p: [0.93, 0.15, 1.8] as P3, name: 'rocker' },
  ],
  /** Roll radius of the front edge, meters. */
  roll: 0.004,
}

/** The fascia's plane breaks, from the splitter up to the V end of the brow. */
export const fasciaBreak: P3[] = [
  [0.285, 0.15, 2.282],
  [0.3, 0.425, 2.355],
]

/**
 * The feature lines of the front, each a path in z through (z, x, y) nodes. Two nodes without slopes make a straight
 * span, two with slopes (dx/dz, dy/dz) a smooth curve; an interior node without its own slope is passed through
 * smoothly. Every crease is one line from its start on the front edge to its end, shared by the two fields either side
 * of it. The bonnet is crowned both ways: along z every line falls in a convex sweep from the cowl to the front edge,
 * and across it is one convex section from the center out to the wing ridge, so no part of it is planar.
 */
export interface PathNode {
  z: number
  x: number
  y: number
  /** dx/dz and dy/dz at the node. Missing: the chord slope of the straight span either side. */
  d?: readonly [number, number]
}

export const featureLines = {
  /** Bonnet center line: one convex sweep from the cowl down to the nose tip, falling ever more steeply toward the
   * nose, a small break at the cowl, the windscreen one convex arc into the roof. */
  center: [
    { z: 2.4737, x: 0, y: 0.385, d: [0, -0.7] },
    { z: 1.51, x: 0, y: 0.736, d: [0, -0.17] },
  ] as PathNode[],
  /** Bonnet inner line: from the bonnet corner to the windscreen base on the same convex sweep as the center line.
   * Behind the front edge it is no crease: the bonnet is one crowned surface from the center out to the wing ridge. */
  inner: [
    { z: 2.173, x: 0.476, y: 0.5117, d: [0.282, -0.4] },
    { z: 1.513, x: 0.29, y: 0.735, d: [0.282, -0.26] },
  ] as PathNode[],
  /** V end: the outer end of the leading V, carried back to the cowl on the bonnet's convex sweep. */
  vee: [
    { z: 2.355, x: 0.3, y: 0.425, d: [0.1775, -0.53] },
    { z: 1.51, x: 0.15, y: 0.736, d: [0.1775, -0.19] },
  ] as PathNode[],
  /**
   * Wing ridge: the crisp valley where the bonnet meets the wing crown, from the front edge to the cowl on the
   * bonnet's convex sweep in side view. Behind the cowl the line turns out along the windscreen's lower corner to the
   * A-pillar base, so it runs from the lamp tip to the A-pillar in one crease.
   */
  rail: [
    { z: 2.168, x: 0.5, y: 0.5057, d: [-0.046, -0.33] },
    { z: 1.513, x: 0.5301, y: 0.6621, d: [-0.046, -0.15] },
  ] as PathNode[],
  /** The windscreen's lower corner, from the cowl out to the A-pillar base, in the wing top's plane. */
  pillarFoot: [
    { z: 1.513, x: 0.5301, y: 0.6621, d: [-2.0, -0.7988] },
    { z: 1.2, x: 0.8, y: 0.81, d: [-0.4, -0.3402] },
  ] as PathNode[],
  /** A pillar, from its base on the wing ridge to the header. */
  pillar: [
    { z: 1.2, x: 0.8, y: 0.81 },
    { z: 0.45, x: 0.62, y: 1.11 },
  ] as PathNode[],
  /** Cowl: the windscreen base, straight across. */
  cowl: [
    [0, 0.736, 1.51],
    [0.29, 0.735, 1.513],
  ] as P3[],
  /** Header: the windscreen top, straight and level across. */
  header: [
    [0, 1.1, 0.46],
    [0.62, 1.108, 0.46],
  ] as P3[],
  /** Arch shoulder: the outer crease from the brow tip over the front arch to the door. */
  shoulder: [
    { z: 2.14, x: 0.8, y: 0.598, d: [-0.727, -0.6] },
    { z: 1.4, x: 0.982, y: 0.808 },
    { z: 0.6, x: 0.922, y: 0.772 },
  ] as PathNode[],
  /** Waist crease, from the cheek's outer edge back to the door. */
  crease: [
    { z: 1.8, x: 0.965, y: 0.5, d: [-0.083, -0.1] },
  ] as PathNode[],
  sill: [
    { z: 1.8, x: 0.955, y: 0.3, d: [-0.067, 0] },
  ] as PathNode[],
  rocker: [
    { z: 1.8, x: 0.93, y: 0.15, d: [-0.05, 0.033] },
  ] as PathNode[],
}
