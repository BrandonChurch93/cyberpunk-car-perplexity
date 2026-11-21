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
  bonnet: map(plan, [[455, 600], [455, 760], [470, 850], [520, 950], [600, 1030], [520, 1040], [400, 1030], [260, 990], [140, 940], [70, 880]]),
  wing: map(plan, [[2560, 600], [2545, 800], [2520, 950], [2495, 1080], [2470, 1150]]),
}
