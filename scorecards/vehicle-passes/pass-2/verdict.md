# Vehicle K Surface Pass 2 audit

Audit of [pinned integration `8542a8a`](https://github.com/BrandonChurch93/cyberpunk-car-perplexity/commit/8542a8a30742f4f7381f6bf9d4a5a1e3188a73a4). The three vehicle-only studio poses were captured once, at full detail and eight review samples per image. The studio keeps the vehicle materials but omits weather and film optical post. No vehicle source changed. The lead decides whether to call the third and final surface pass.

**The wedge reads; the surface pass does not clear the gate.** Against the [approved hero comparison](hero-comparison.jpg), the low wedge, bonnet V, Y lamp and rear shoulder read much more like the debadged Revuelto target. The broad bonnet, wing tops and front shield no longer need a rebuild. The largest leftover in the hero is the near wing-side stripe crowding above and outboard of the eye; the lower windscreen and front shut/return junctions are next. The frame 195 beauty also fails the separate unguarded HDR gate.

## Independent four-ray p95

The comparable figures use the unchanged Pass 1 mask and estimator: four deterministic rays per native 1920 × 1080 pixel, 10 mm surface stations along image rows and columns, and exclusion near bends below a 40 mm radius. Values are in inverse square metres. The geometric bins are not CAD patch IDs. The paint mask follows the body material, so painted mirrors can contribute to regional bins. A dash means fewer than 50 valid stations, not zero ripple. L/R indicate vehicle sides.

| Region | 195 p95 | 1060 p95 | 0 p95 |
| --- | ---: | ---: | ---: |
| Nose and fascia | 307 | — | 299 |
| Bonnet | 7 | — | 21 |
| Front wing top L | 33 | — | 37 |
| Front wing top R | 34 | — | 32 |
| Front wing side L | 138 | 27 | 143 |
| Door L | 24 | 17 | 27 |
| Haunch L | 5 | 6 | 6 |
| Sill L | 2 | 2 | 1 |
| Roof and pillars | 21 | 33 | 19 |
| Windscreen (separate glass mask) | 18 | — | 17 |
| Rear deck | 4 | 10 | 5 |
| Tail | — | 20 | — |
| Other paint geometry | 612 | 820† | 502 |
| Haunch R | — | 653† | — |

† Sparse and/or grazing: 598 stations for other at 1060 and 197 for the far haunch (55% excluded). The right wing side, door and sill have no representative samples. `Other` is residual paint, not a panel to rebuild. The glass row is a separate four-ray measurement using the windscreen pane and the same 10 mm/40 mm estimator; the original paint mask had no glass row. It is not a Pass 1 delta. The largest hero glass station response is at native `(1029,528)`, in the lower screen.

The independently measured [Pass 1 `5d98144`](https://github.com/BrandonChurch93/cyberpunk-car-perplexity/commit/5d981445b71a3f8c0b6a5c7349bfd5675f4167b8) hero p95 was 608 fascia, 218 bonnet, 410/212 wing tops and 117 near wing side. Pass 2 removes the general front-facet failure, but the near wing-side summary rose to 138 from 117 in the hero and to 143 from 133 at frame 0; it improved at 1060 (66 to 27). These comparisons are same-view bins, not identical points on unchanged geometry. Door L improved from 38 to 24 and the rear-view tail from 179 to 20. The builder's reported hero paint numbers reproduce; the independent tail result is 20 at 1060, not 40.

The separate hero sensitivity run reproduces **42 for near wing side and 8 for fascia at 150 mm**. It excluded 26% and 45%, respectively, versus 16% and 39% at 40 mm. That supports the finding that sharp returns account for a considerable part of the headline values, but it does not remove the stripe compression visible outside the designed crease. Use the 40 mm table for pass-to-pass comparisons.

The heat maps plot the larger valid directional station value. A red stripe following a known fold or an aperture boundary is edge response, not a ripple verdict. Blue can be excluded, unsampled, or exactly zero in this tool's heat encoding. The zebra, not the heat color alone, decides whether a visible band is owed to a design crease or an unwanted surface turn.

## Panel verdicts and ranked Pass 3 leftovers

Listed by prominence at 195, then rear-only details. "Not clean" includes a local join that interrupts the highlight even if the broad panel field passes. "Clean" applies to the resolved field in these poses, not to hidden geometry or to a shared edge already assigned to another row. Do not use the last pass to reshape a clean field.

| Priority | Panel | Verdict and work |
| ---: | --- | --- |
| 1 | Front wing side L | **Not clean.** Red on the shoulder, lamp rim and arch lip is the intended crease/edge. The tightly bunched parallel bands in the open face above and outboard of the near eye on the way to the arch are a ripple, not several design creases. It repeats at 0. Rebuild the eye-to-arch flank as one broad fair span with the shoulder as its sole deliberate turn; share the arch return and forward door edge. Do not add a narrow correction strip. [Native hero crop](f195-zebra-wing-side.png). |
| 2 | Windscreen | **Not clean at the lower and outer transitions.** The old large central S is absent and the main diagonal bands read continuously. The compressed/returning bands lower down and at the near pillar are unwanted turns in the transition, separate from the intended glass/seal perimeter. Retain the main crown and fair the lower/outer surface into the cowl and seal rather than adding a lip or hiding it. The rendered zebra does not certify a single globally convex screen/roof: a check of the analytic base loft (not the fitted pane) found 3 of 42 sampled interior stations with positive longitudinal second derivative and 9 with a positive largest Hessian eigenvalue above 0.01/m, with the outward height sign. Treat that as a check on the one-convex-surface claim, not as a location map for the glass. [Native crop](f195-zebra-canopy.png), [glass-only map](windscreen-fairness.png). |
| 3 | Nose and fascia | **Not clean at the eye/brow and return junctions; broad shield clean.** Main red tracks follow the deliberate Y, fascia facet intersections, eye and duct rims, lower lip and splitter edge. The old detached vertical fan is gone. The short fork/hook at the near eye/brow and broken highlights at the outer return are local fit/roll changes, not another crease. Make the inner near-eye/brow and duct return meet on one shared edge, with one smooth radius into the opening. Leave the flat shield and the intended Y alone. The sampled near outer return now hits the duct four of four rays and the near upper Y sample hits the guide four of four; the moved lower tip is not signed off merely from its old sample location. [Native front](f195-zebra-front.png), [near brow](f195-zebra-brow-close.png), [frame 0 check](f0-zebra-front-shuts.png). |
| 4 | Bonnet | **Not clean at the shut-line ends; broad V facets clean.** The narrow red tracks on the V, side facets and cut are intended creases/edges. The pinched or forked highlights where the cuts die into the brow and cowl are local interruptions, not ripple across the bonnet field. Make the brow and cowl ends share the adjoining returns and keep a steady gap into those ends; do not move the V or rebuild the calm fields. [Front](f195-zebra-front.png), [canopy/cowl](f195-zebra-canopy.png), [frame 0](f0-zebra-front-shuts.png). |
| 5 | Door L | **Not clean at the forward shut and intake entry; broad fields clean.** The long waist/lower character track and the trim around the intake are intended edge response. The small highlight break at the arch/door join and the squeezed turn by the intake are unwanted join changes. Keep the waist and lower field. Share the forward return with the wing and fair the painted upper transition into the existing throat rather than rebuilding the duct. At the old liner probe points `(1440,555)`, `(1452,578)`, `(1465,599)`, all four rays at each now hit the dedicated side intake throat. Stripes on throat or liner are not a painted ripple. [Native flank](f195-zebra-flank.png), [frame 0](f0-zebra-front-shuts.png). |
| 6 | Rear deck | **Not clean at the near closure only; deck field clean.** The hard cap break and deck cut are intentional. The short interruption as the deck shuts into the near rear corner is an unwanted termination, not another deck crease. Refit that termination with the existing cap return; the full engine-cover shut is not exposed in these views. [Native rear](f1060-zebra-deck-haunch.png). |
| 7 | Tail | **Not clean at the local returns only; broad cap clean.** Red on the horizontal wrap, lamp and slot outlines, outlet edges, corners and lower perimeter is intended edge response. The short pinch beside the near slot at the wrap and the small far-corner hook are return/fit defects, not a broad cap ripple. The prior projecting rear feature now samples as liner at `1060 (839,784)` on all four rays; the right fin is still fin at `(1498,805)`. Check the fin feet and seat the returns against the common cap edge; do not rebuild the broad cap or mistake fins and mesh stripes for paint. [Native tail](f1060-zebra-tail.png). |
| Keep | Front wing top L | **Clean field.** Red follows the deliberate ridge from the brow toward the A-pillar and the arch perimeter. The broad top no longer shows the Pass 1 fan. The shared near brow and wing-side joins are already assigned above. |
| Keep | Front wing top R | **Clean field.** The far facet and its intended edge remain legible at 195 and 0. The visible small end turn belongs to the shared brow/shut work, not a rebuild of the wing top. |
| Keep | Haunch L | **Clean field.** Zebra is organized on the broad rear shoulder; thin red on the shoulder, wheel opening and intake perimeter follows intended creases/edges. The adjacent closures are handled under Door L and rear deck. |
| Keep | Sill L | **Clean field.** The long highlight holds at all three poses. Red at the waist/rocker fold and the door-cut endpoints follows intentional geometry. Do not resection the sill; preserve the even lower run when joining the door. |
| Keep | Roof and pillars | **Clean roof field.** The narrow header/pillar tracks follow the intentional transition and trim boundaries. The shared lower pillar/cowl pinch is assigned to the windscreen work, not a roof rebuild. |

At 0 the red lines on the V, arch, shoulder and apertures reproduce as intended creases; the off-crease near wing-side crowding, lower glass compression and brow/shut interruption also reproduce. At 1060 the isolated return interruptions should not be read as continuous ripple across the lower cap or deck. The far haunch's hot grazing sliver is mainly at the wrap/corner rather than evidence about its whole field; the far wing side, door, sill and broad haunch remain outside sign-off. Residual `Other` red includes mirror/trim and join hits; it is not a separate surface assignment.

## Radii, shuts and HDR gate

- **Radius claim not met:** The fascia interior uses a nominal 3 mm circular cross-section, but it tapers at the ends. The loft's nominal 3 mm value calculates a setback for a Bézier blend, not a constant measured circular radius; the inner crease fades out and the sill uses a separate 6 mm setback. The brow and opening returns are nominally 4 mm where specified; the swept shut lips explicitly use a 2 mm quarter-round. Long highlights are much more continuous, but the brow/cowl, front arch/door and localized rear returns do not read as one even roll through each junction.
- **Shut widths and ends:** The modeled nominal is 4 mm between the two walls, with an 8 mm cut across the outer rolled lips. Projected dark-line width varies with viewing angle and the visible return; a native frame is not a physical gauge. Main bonnet and door runs read as single cuts, but the near brow and cowl ends and the wing-to-door junction do not pass. The far brow termination is cleaner and remains a compact corner, not another long spike. At the near inner eye corner in 195, the short bright return kicks into the shut end near native `(957,618)`; the local departure is on the order of 2–3 native pixels in the highlight and recurs at 0 near `(960,592)`. It is not a proven 2–3 pixel extension of the mesh or an independent 3D knot. The CAD station can remain one point while the rendered lip/return still shows that kink. Seat the shared ends without digging a new notch or changing the nominal run width.
- **Unguarded beauty:** **1 / 0 / 0** non-finite HDR pixels at **195 / 1060 / 0**. The hero render's validation failed with the guard off, so the attached PNG and hero tile are labeled HDR FAIL. The stock resolve replaces invalid values for display; the PNG cannot localize the original non-finite pixel, and this audit does not assign it to a particular mesh. No guarded substitution or second capture was made. All six clay/zebra records and the other two beauty records had zero non-finites.

## Triangle budgets and scale

The full-detail vehicle independently counts **806,451 triangles against a 1,000,000 budget** (193,549 spare) and **261,602 paint triangles against 300,000** (38,398 spare). Counts are identical at 195, 1060 and 0. This is the indexed or nonindexed active draw range multiplied by instances, without frustum or occlusion culling; all 178 mesh objects have visible ancestry. The studio is not included. Pass 1 was 1,488,129 total and 482,198 paint by the same convention.

The fitted outer paint spans 4.947 m length and 2.033 m width, with its highest point 1.160 m above the deck; those are paint extents, excluding the mirrors. The roll and gap dimensions above are nominal source dimensions before sprung fit, not estimates from the 1400 px proof stills.

## Delivered evidence

- **Hero comparison:** [approved reference beside studio beauty, clay and zebra](hero-comparison.jpg). The reference is the identity and silhouette target, not a lighting match for the studio proof.
- **Nine stills:** 195 [beauty, HDR FAIL](f195-beauty-HDR-FAIL.png), [clay](f195-clay.png), [zebra](f195-zebra.png); 1060 [beauty](f1060-beauty.png), [clay](f1060-clay.png), [zebra](f1060-zebra.png); 0 [beauty](f0-beauty.png), [clay](f0-clay.png), [zebra](f0-zebra.png). Full-frame exports are 1400 px wide; the source captures and fairness rays are native 1920 × 1080. [Capture manifest](capture.json), build `dab8e156caaa950c`.
- **Four-ray maps:** [195](f195-fairness.png), [1060](f1060-fairness.png), [0](f0-fairness.png), and the [windscreen-only 195/0 native-crop sheet](windscreen-fairness.png). The three main maps retain their native resolution.
- **Native zebra crops:** 195 [front and bonnet](f195-zebra-front.png), [near wing side](f195-zebra-wing-side.png), [windscreen and cowl](f195-zebra-canopy.png), [door and flank](f195-zebra-flank.png), and [near brow close](f195-zebra-brow-close.png); 0 [front shut confirmation](f0-zebra-front-shuts.png); 1060 [deck and rear corner](f1060-zebra-deck-haunch.png) and [tail and apertures](f1060-zebra-tail.png). No crop enlarges or resamples the native zebra.

No paint, water or lighting finish is part of this verdict. The rear-only closures and the HDR failure are not a reason to reopen the clean broad fields.
