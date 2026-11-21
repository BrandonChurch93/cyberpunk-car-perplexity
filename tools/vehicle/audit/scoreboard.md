C4 fairness scoreboard, 1 to 10 per view (silhouettes, zebra flow, panel gaps, thickness, joins, scale, tire contact)

| head | branch | 195 master | 195 tall | 360 master | 360 tall | note |
|---|---|---|---|---|---|---|
| c0badf6 | b | 4 | 5 | 6 | 6 | baseline |
| bb60137 | b | 5 | 6 | 7 | 7 | R4, bonnet faired |
| 4612a9c | b | 5 | 6 | 7 | 7 high | 360 tall notch fixed |
| 8827887 | b | 6 | 6 | 7 | 7 high | cheek cap stripe gone |
| 17f86f3 | b | 6 (not rerun) | 6 (not rerun) | 8 | 7 high | tip hook gone, tall upper right band steeper (p95 99 to 130) |
| 17bd430 | b | old camera | old camera | 8 | 8 | lamp crease fitted, long edge S gone |

Gate to 9 per view, open items:
- 195 master: strip just ahead of the front arch lip 1150,440 to 1200,620 and the cheek forward edge sawtooth (b), haunch L and door bottom (e), nose tip pinch (b), wing top stair edge (b), intake lower lip (b), roof rail strip (e)
- 195 tall: same as master at smaller scale
- 360 master: hook fixed at 17f86f3; shading streaks above the vent 700,460 to 790,590 (b)
- 360 tall: new steeper band dip at the upper right 520,0 to 900,300 (b, 17f86f3), notch 172,40 to 200,100 at s .069 to .080 x .68 (b), waving band edge 40,0 to 280,120 (b); S-wiggle fixed at 17bd430

All 195 rows are at the old 0.20 m hero camera. They are re-baselined when the Addendum 002 hero camera lands on dev/p3.

## Hero camera of Addendum 002 (dev/p3 5baa36f), frame 195 re-baselined

| head | branch | 195 master | 195 tall | note |
|---|---|---|---|---|
| 17bd430 | b (e not pushed) | 5 | 5 | new baseline: door, haunch and roof now in view |

Panels by cost at the hero camera (master p95 / p50): haunch L 627/36 (e), front wing top L 553/10 (b), front wing side L 485/7 (b), roof and pillars 227/10 (e), door L 204/2 (e), nose and fascia 183/16 (b), rear deck 131/7 (e), wing top R 115/8 (b), sill L 99/4 (e), bonnet 38/6 (b, fair)
| ac4283d | e haunch step 1 (on b 17bd430) | 5 (top) | 5 (top) | haunch L p95 627 to 607 master, 658 to 522 tall, p50 36 to 18; door L 204 to 156 |
| 57e2d22 | b arch run-in (front only, no e) | 5 (top) | 5 (top) | wing side L p95 485 to 441 master, 466 to 427 tall; nothing else moved |
Detached b trials vs 57e2d22 (not on branch): integrated-base arch .032 m 5 top (push; side p95 361/370); lip alone 5 neutral; doubled roll stations 5 no change (station count ruled out); bezel seated on return 5 top (staircase polygon gone, new soft wedge 1135,543 to 1165,553)
| 2078ef4 | b arch + bead, contains e ac4283d (first merged b+e head) | 5 (top) | 5 (top) | wing side L 441 to 361 master, 427 to 370 tall; haunch and door as ac4283d |
| 32183b3 | b bezel seat (merged with e ac4283d) | 5 (top) | 5 (top) | 162 px change at the bezel; table flat |
| e88ae9d | e haunch step 2 (merged with b 2078ef4) | 5 (top) | 5 (top) | haunch dimple gone; haunch 607 to 611 / 522 to 510, door 156 to 134 / 123 to 104 |
| 5637315 | e deck front and rail join (merged with b 32183b3) | 5 (top) | 5 (top) | roof 233 to 221 / 236 to 204; ribbon right end eased, left end still red; pinholes are liner flush with paint edge |
| 228561d | e haunch step 3 (on p3 002ae57) | 5 (top) | 5 (top) | haunch 611 to 565 / 510 to 491; flank behind intake calmer; arch-top corner 1504,483 is now worst |
| one-domain front 2e80d7b (local patch on p3 002ae57, not pushed) | b | 6 | 6 | wing side L 361 to 220 / 370 to 218; cheek planes gone; new mouth-edge trim X 1140,640 to 1210,735 must be fixed before push; 360 stays 8/8 |
| rolled-edge front c4e0c7d (local, with emboss) | b | 5 (top) | 5 (top) | mouth X fixed; arch emboss beads 1240,505 to 1290,560, side p95 220 to 416; drop emboss keep rolled edges |
| 36f8d67 | e, on p3 | 5 (top) | 5 (top) | haunch p95 565 to 554 / 491 to 504; corner 1504,483 worst 3247 unchanged; ribbon left end zebra fan narrowed but red band remains; roof tall 204 to 213 |
| 44f6b73 seated (local a166cce) | b | 6 | 6 | vs 002ae57 side 361 to 195 / 370 to 202 full, 398 to 165 / 407 to 181 blockout; slash, X, beads gone; lamp lip dotted; 360 tall blockout side 432 to 501 to explain |
| 380f2ca fold (local 20ea605) | b | 6 | 6 | side 198 / 203 full, 211 / 232 blockout (baseline 361/370, 398/407); arch one line but soft fold reads red; fascia above baseline both LODs 196/193, 273/254; 360 tall blockout side 501 to 423 fixed; push only once fascia is at or below baseline |
| d3cd278 lamp roll 4.25 mm (local f531052) | b | 6 | 6 | lamp lower rim wider but beads into facet steps, red 1 to 4 percent; upper dots and cavity spot unchanged; hold |

From here on, numbers are on the four-ray standard (df62a97). Older p95 values are not comparable.

| Head | Branch | 195 master | 195 tall | Notes (sub 4) |
|---|---|---|---|---|
| 002ae57 | p3 baseline | 5 | 5 | side 250 / 260, fascia 227 / 208, haunch 491 / 479, roof 330 / 312, deck 203 / 182 |
| 36f8d67 | e | 5 (top) | 5 (top) | haunch 434 / 399, roof 307 / 291 |
| ac0b2f3 | e | 5 (top) | 5 (top) | haunch 434 to 297 / 399 to 254; arch-top diagonal now declared crease; seam x 1500 red; ribbon left end unchanged |
| 76ad60b B2 | b (comparison pin) | 6 | 6 | side 144 / 147 full, 173 / 169 blockout; fascia 201 / 206 full, 260 / 279 blockout (baseline 227 / 208, 273 / 262); earlier fascia regression was mostly sampling |
| d6de389 lamp tip (local ad5e515) | b | 6 | 6 | facet steps were sampling; roll band still red at onset, lower half still mottled; hold |
| 16debe2 | e | 5 (top) | 5 (top) | deck 198 to 48 / 180 to 41, roof 307 to 144 / 291 to 133, door 144 to 52 (deck samples relabelled, about 1900 moved to door and other); ribbon pinch gone, left box red 25 to 0 percent; ridge run-out 1360,415 to 1405,435 still 6 percent red; old front holds the view at 5 |
| 747a580 | e | 5 (top) | 5 (top) | haunch 295 to 199 / 247 to 191; seam box red 16 to 9 percent; residual at the crease crossing 1495,467 to 1505,480 and a dot column 1489 to 1492, 478 to 495 |
