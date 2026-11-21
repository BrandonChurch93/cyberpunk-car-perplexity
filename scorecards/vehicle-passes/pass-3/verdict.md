# Vehicle K: final surface audit, Pass 3 of 3

Audited [`dev/vehicle-k` at `fb486ad`](https://github.com/BrandonChurch93/cyberpunk-car-perplexity/commit/fb486ad1379da2be5560ff4ae7d271380d54ad4e) once, against the [independent Pass 2 pin `8542a8a`](https://github.com/BrandonChurch93/cyberpunk-car-perplexity/commit/8542a8a30742f4f7381f6bf9d4a5a1e3188a73a4). No source geometry, camera, surface treatment, or lighting was changed in the audit. The nine stills use the same vehicle-only studio and camera poses as Pass 2. The surface-pass cycle is closed; any open items below are for C4 to judge, not a Pass 4 work order.

**Final surface verdict: the Revuelto wedge reads, but the surfaces are not all clean.** The broad wedge facets, wing tops, shoulder and deck hold. The near eye-to-arch wing-side banding and the lower windscreen are still the biggest hero issues; the brow/bonnet ends, local fascia returns, door shut and rear wrap are smaller open items.

## Identity against the approved hero

The [approved reference beside 195 beauty, clay and zebra](hero-comparison.png) shows that the low wedge, crisp bonnet V, Y running lights, and shoulder over the rear wheel survive the final pass. The front reads more planted: the openings are deeper and more tapered, the center mouth sits lower, and the splitter projects farther. The Y still reads plainly, although the near long arm is more horizontal and the short upper spur more upright than in the approved image. The underside and lamp fit change the apparent rake; a geometric lowering or rerake of the upper nose is not verified. The modeled center tip is unchanged at `(0, 0.40630, 2.47217) m` in both lofts and the sampled bonnet centerline is unchanged to 0.01 mm. The studio is a geometry read, not a comparison of wet paint, environment, or film lighting.

## Four-ray panel measurements

Same 1920 × 1080 native grid and four deterministic rays per native pixel as Pass 2. Both sweeps use 10 mm surface stations and report the p95 of the normal second difference in inverse square metres. The 150 mm exclusion is a sensitivity check, not a replacement for the 40 mm baseline. Paint bins are geometric regions, not part IDs; the windscreen row uses a separate pane mask. Each triple is **195 / 1060 / 0**; a dash means too few valid stations, not a zero.

| Panel | Pass 2, 40 mm | Pass 3, 40 mm | Pass 3, 150 mm |
| --- | ---: | ---: | ---: |
| Nose and fascia | 307 / – / 299 | 376 / – / 378 | 6 / – / 6 |
| Bonnet | 7 / – / 21 | 7 / – / 22 | 0 / – / 0 |
| Front wing top L | 33 / – / 37 | 40 / – / 44 | 21 / – / 20 |
| Front wing top R | 34 / – / 32 | 43 / – / 41 | 19 / – / 20 |
| Front wing side L | 138 / 27 / 143 | 127 / 26 / 129 | 44 / 18 / 46 |
| Door L | 24 / 17 / 27 | 24 / 17 / 27 | 20 / 14 / 23 |
| Haunch L | 5 / 6 / 6 | 5 / 6 / 5 | 5 / 5 / 5 |
| Sill L | 2 / 2 / 1 | 2 / 2 / 1 | 2 / 2 / 1 |
| Roof and pillars | 21 / 33 / 19 | 21 / 34 / 19 | 15 / 30 / 13 |
| Windscreen | 18 / – / 17 | 18 / – / 17 | 17 / – / 17 |
| Rear deck | 4 / 10 / 5 | 4 / 11 / 5 | 4 / 10 / 5 |
| Tail | – / 20 / – | – / 36 / – | – / 14 / – |
| Haunch R, grazing only | – / 653 / – | – / 654 / – | – / 99 / – |
| Other paint, not a panel | 612 / 820 / 502 | 712 / 957 / 754 | 55 / 64 / 59 |

At the hero, fascia drops **8 → 6** in the 150 mm run while its standard 40 mm value rises. That run excludes 46% of fascia stations in Pass 3, up from 39% at 40 mm, consistent with strong response around the revised apertures rather than broad shield ripple. The near wing side **42 → 44** at 150 mm (27% excluded versus 18% at 40 mm), so the standard p95 improvement does not carry over to the stricter exclusion. The residual wing-side band remains visible.

**Wing-top attribution verified.** The raw hero tops are 40 L and 43 R (42.52 before rounding), versus the builder's 40/42 and Pass 2's 33/34. Painted mirror heads supply 346 of the near top's 1,683 upper-five-percent stations and 382 of the far top's 1,619. Retaining only stations on the painted shell gives 31/31 (30.58/31.24); the standard reported bins remain unchanged. This supports the attribution to adjacent parts rather than a broad-field wing-top regression. The nominal far wing-side bin at 195 and 0 consists entirely of far mirror samples and is not listed as a panel score. The far haunch has only 210 accepted stations at 1060 at 40 mm, with 53% excluded.

## Clean list and open C4 findings

**Clean in the resolved fields:** front wing tops L/R (judge the wing field, not the mirrors or the shared front ends), left haunch, left sill, roof field, and rear deck (the near closure now visibly runs into the wrap). The bonnet's broad V facets, the broad fascia shield, the main door fields, and the broad rear cap are also clean, but those assemblies are not signed off at the local joins itemized below. The visible far haunch remains a thin grazing sliver; there is no broad-field verdict for the far wing side, door or sill.

| C4 rank | Not-clean panel or join | What remains in the judged views |
| ---: | --- | --- |
| 1 | Front wing side L | **195 and 0:** three tight bands curl together between the near eye and wheel arch, away from the one intended shoulder crease. The four-ray 40 mm p95 improves **138 → 127** at 195 and **143 → 129** at 0 (builder 127/130). This is not a clean panel: at the hero it remains the most legible off-crease turn even though the p95 drops. The arch lip and long shoulder trace are intended creases and should not be called ripple. |
| 2 | Windscreen and A-pillar/cowl transition | **195 and 0:** primary diagonal bands across the screen are continuous; the tight returning lower band and squeezed pillar-side turn remain. Glass p95 stays **18 at 195 and 17 at 0**; the strongest hero station is still `(1029,528)` in the lower pane. The dark or bright perimeter of the seal is an intended boundary, not itself a ripple. The roof field is not part of this open item. |
| 3 | Bonnet ends and nose/fascia returns | **195 and 0:** the bonnet V and shield read clean across the broad fields. The near brow shut touches or crosses the fascia at its end, the cowl end still pinches, and small dark or bright breaks remain where the eye and duct returns meet. The fascia 40 mm p95 moves **307 → 376** at 195 and **299 → 378** at 0, with p50 still zero in both views. The heat follows the designed Y, duct/eye rims and facet boundaries with local junction defects; there is no return of the broad Pass 1 shield fan. Carry fit and edge pickup, not a broad-facet ripple finding. Bonnet p95 is **7** at 195 and **22** at 0. |
| 4 | Door L and side intake/arch join | **195 and 0, also visible obliquely at 1060:** the forward shut/end still picks up a small break behind the arch, and the upper band squeezes into the intake. Door p95 is **24 / 17 / 27** across 195 / 1060 / 0, unchanged from Pass 2. The long character fold is an intended crease, and the striped intake insert is not painted ripple. The main door field and sill are not the issue. |
| 5 | Tail wrap and slot/corner joins | **1060:** broad lower cap stays orderly. The intended wrap/ease bends the upper return stripe, but it does not explain away every local break: the near horizontal wrap/slot handoff still pinches and the far corner remains tight. The rear p95 **20 → 36** reproduces the builder's 36; high stations lie on tail paint at the upper/wrap and outer perimeter, including the far peak near `(1503,490)`. The X-shaped highlights within the two slot inserts are visible in this frame; these are separate from the painted cap score. The improved deck shut reaching the lamp is not a new crease defect. |

Use the three judged studio zebras, not the numerical ranking alone: a high station directly on a Y, lamp pocket, wrap, or panel perimeter is a crease or edge response. The off-edge wing-side bunching and lower glass change are the clearest unresolved regional shape issues. None of these observations reopens surface development or signs off finishes.

## Radii and shut channels

- **Crease radii:** The four sampled primary loft crease sections now use a rational quadratic intended to be circular across the crease. Independent circumcircle fits in the local cross-crease plane gave a median of about 3.00 mm on each: waist 2.95–3.09 mm, shoulder 2.99–3.03 mm, rail 2.99–3.01 mm, and active inner bonnet about 3.00 mm. This verifies approximately 3 mm on those primary rolls, not a blanket constant 3.0–3.2 mm on every edge. The sill uses a separate setback, the fascia arcs taper at endpoints, and the modeled aperture returns and shut-lip rounds are nominally 4 mm and 2 mm respectively. Junction continuity is a separate visual check.
- **Windscreen convexity:** The zebra's large central bands are a different question from strict convexity. On the same independent 42-station analytic base-loft grid as Pass 2, with 12 mm finite differences, 3 stations are longitudinally concave and 9 have a positive maximum height-Hessian eigenvalue above 0.01/m. The independent test confirms the surface is not convex everywhere; it does not reproduce the builder's exact four-of-56 count without the builder's station grid and criterion. This calculation is for the base loft, not a replacement for the rendered pane and seal evidence.
- **Shut channel only passes its nominal section, not continuity.** Cross-sections at 4.5 mm under the skin gave median wall-to-wall widths of 4.000 mm at the bonnet, 3.993 mm at the door and 4.000 mm at the deck, over 70/100/44 paired hits respectively. Median floor depths were 7.000/7.000/7.001 mm where found. At longitudinal probes spaced about 2 mm apart, the center floor sometimes missed; checking four offsets within ±1 mm recovered the rear-deck floor at all sampled stations, but not every bonnet or door station. These are sampled checks of the dedicated floor mesh, including ends and adjoining openings; they do not mean each miss is a visible hole. The native views confirm the brow, cowl and door shut-line ends are not complete.
- **Bonnet/fascia bridge confirmed locally.** The last bonnet shut station hits a fascia face with one vertex at `(0.550, 0.512, 2.143) m`, matching the builder's location. It cuts into the end of the recess. Separate near-brow probes also found three non-fascia paint triangle hits spanning the local centerline, near `x = 0.539–0.542 m`; this is not an all-body proof of exactly one crossing or an absence of paint bridges elsewhere. No shallow paint hit was found on the sampled door or deck centerline. Visually the long channels read much more continuously than the terminations.

## Capture and geometry gates

- **Unguarded studio beauty passes:** zero non-finite HDR pixels at **195, 1060, 0, 240, 615, and 1340**, reproducing the builder's six-frame finding. Pass 2 recorded one at 195. The last three frames are supplemental beauty checks only; they were not substituted for the nine judged stills. All six clay and zebra captures are also finite. The guard was off, no diagnostic backface overrides were used, and film optical post was disabled.
- **Triangle budgets pass:** 833,908 vehicle triangles against 1,000,000, and 247,882 paint triangles against 300,000. All six evaluated poses give these counts across 181 meshes, using the active indexed or nonindexed draw range multiplied by instances, with no camera culling. Against Pass 2, this is +27,457 vehicle and −13,720 paint. The fitted paint envelope remains 4.947 m long, 2.033 m wide, and 1.160 m high above the deck.

## Delivered evidence

The [hero comparison](hero-comparison.png) puts the approved reference beside the three vehicle-only views. The individual stills below are 1400 px full-frame exports of the native 1920 × 1080 captures, made once at full detail with eight review samples per image. The native stills and four-ray measurement records were retained for inspection, under audit build `eb82b791b63c117d`.

| Frame | Beauty | Clay | Zebra |
| ---: | --- | --- | --- |
| 195 | [Hero beauty](f195-beauty.png) | [Hero clay](f195-clay.png) | [Hero zebra](f195-zebra.png) |
| 1060 | [Rear beauty](f1060-beauty.png) | [Rear clay](f1060-clay.png) | [Rear zebra](f1060-zebra.png) |
| 0 | [Wide beauty](f0-beauty.png) | [Wide clay](f0-clay.png) | [Wide zebra](f0-zebra.png) |
