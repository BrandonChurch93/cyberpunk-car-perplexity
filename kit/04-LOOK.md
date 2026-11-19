# 04 · The look

## 1. One render path

- three.js `WebGLRenderer` on WebGL2, in every mode, on every machine.
- No WebGPU path. No path tracer.
- Why: the critics judge frames rendered in software in this workspace. The master is exported later on a GPU. Both must run the same shader code so the approved picture is the exported picture.
- Phase 0 records the WebGL2 limits and extensions this workspace's browser exposes. The app uses nothing outside that set.
- A `caps` diagnostic lists the limits and extensions of the machine it runs on and marks any that differ from the recorded set.

## 2. Frames are computed, not played

Every output frame is the average of `tiers.<tier>.samplesPerFrame` sub-renders. Each sample is jittered in:

| Jitter | What it buys |
| --- | --- |
| Sub-pixel position | Antialiasing |
| Time inside the shutter interval set by `film.shutterDegrees` | Motion blur on the camera and every moving thing |
| Position on the lens aperture | Depth of field with real bokeh |
| Position on each area light | Soft shadows |

- Accumulate in linear floating point. Run the lens and grade stage once, after accumulation.
- Sample sequences are low discrepancy and seeded, so a frame is the same every time. Sequences and grain are keyed on the frame index modulo the frame count, so the loop frame uses the same sequence as frame 0.
- When `lens.anamorphic` is true the aperture is an oval, which gives oval bokeh.
- Rain streaks are geometry. Their length comes from fall speed and shutter time. Rain is evaluated at the frame's center time in every sample and is the one system left out of the time jitter, so it is blurred once and looks the same at every tier.
- `tiers.final.samplesPerFrame` may be raised. It is never lowered.

## 3. Reflections

The scene reflects itself.

- Wet deck: a planar reflection of the full scene, rendered every frame. Blurred by the roughness of the surface. Broken by the puddle mask and by ripple normals.
- Vehicle and props: a cube capture from the vehicle's position, rendered every frame and parallax corrected to the deck and the nearest walls.
- Screen-space reflection is added where it improves contact reflections.
- A stock HDRI may fill the sky term. It is never recognizable in any reflection.
- The vehicle's own lamps, the billboard and the rain all appear in reflections.

## 4. Light that has to hold up

- Contact shadows under the vehicle and at every tire.
- Ambient occlusion in gaps, vents and wheel arches.
- Colored bounce from the wet deck onto the underside of the vehicle.
- Signs act as area lights with correct falloff, not as glowing textures.
- A light source lights the haze around it. Bloom alone is not glow.

## 5. Haze and beams

- Ray marched, with shadowing, for the vehicle's lamps, the deck light poles and the billboard.
- Jittered per sample so accumulation removes banding.
- Rain inside a beam is brighter than rain outside it.

## 6. Materials

All materials are physically based and conserve energy. Each holds up at macro distance.

| Material | What has to be visible |
| --- | --- |
| Paint | Base coat. A flake layer with single flakes that sparkle and change as the camera moves. A clearcoat with slight orange peel. Depth between the layers |
| Glass | Real thickness, refraction and tint. The interior is visible through it |
| Lamp lenses | Internal optics built as geometry, not painted on |
| Rubber | Sidewall relief and tread. Matte where dry, glossy only under a film of water |
| Machined and cast metal | Tool marks, casting texture, anisotropic highlights on brushed faces |
| Hot metal | Heat tint near the exhaust |
| Woven composite | Weave under clear resin, with the highlight that follows the fibers. No moire |
| Deck surface | Porous. Darker and glossier when wet. Painted lines are less porous than the surface around them |
| Concrete | Formwork marks, stains below every edge, hairline cracks |
| Steel | Galvanized, or painted with chips and rust streaks |
| Sign tubes and panels | Glass tubes with visible electrodes and supports. LED panels with visible pixel structure up close |

## 7. Water on surfaces

Every surface has a wetness kind: `beads`, `sheet`, `porous` or `none`.

- `beads`: lens-shaped drops with real refraction of what is under them and a bright specular point. Sizes vary. Drops merge, break loose, run and leave a trail. They shake when the surface vibrates.
- `sheet`: a thin moving film with rivulets, and drips from the lowest edge.
- `porous`: the surface darkens and its roughness drops. Standing water forms where the height map is lowest.
- The system works on any mesh in world space. It does not need special UVs.
- Water state is a function of time and seed. It is periodic over the film.

## 8. Lens and sensor

- Depth of field comes from sampling the aperture. No blur filter.
- Anamorphic character: oval bokeh and a restrained horizontal streak on the strongest sources only.
- Halation and bloom come from the energy of the source. No brightness threshold.
- Vignette, distortion and chromatic aberration sit at levels a real cinema lens has. If a viewer can name the effect, it is too strong.
- Grain is seeded per frame, stronger in the shadows, and periodic over the film.
- Tone mapping is a filmic curve chosen in the look lock phase and logged.
- Grade: the signage colors against neutral darks. Blacks keep detail. No color clips to a flat patch.

## 9. Detail rule

- No silhouette shows straight polygon segments in any judged frame.
- No texture shows texels, stretching or tiling in any judged frame.
- Every macro beat gets dedicated geometry and textures for the area it frames.

## 10. Survive compression

X re-encodes every upload. Rain, grain and dark gradients are what an encoder destroys first.

- Dither every gradient.
- Keep grain moderate.
- Avoid large dark areas filled with low-contrast noise.
- The compression critic in `kit/07-QUALITY-BAR.md` checks the result.

## 11. Paint choice

- If `paint.locked` is set, use that candidate.
- If it is null, settle it once, in the first Phase 3 round in which the gate is green.
- Render the look lock set once per entry in `paint.candidates`.
- Run C1, C3 and C8 on each candidate's set.
- If a candidate's C1 run is invalid, run it again until it is valid, vetting the control pool again if needed, before totals are compared.
- A candidate's total is its C3 score plus its C8 score plus one tenth of its C1 gap.
- The highest total wins. A tie goes to the earlier entry in `paint.candidates`.
- Write the winner into `paint.locked` and log every total.

## 12. Diagnostic views

| View | Shows |
| --- | --- |
| `beauty` | The film |
| `clay` | Uniform matte gray, no textures, same lighting |
| `zebra` | A stripe environment reflected in every glossy surface, to expose bumps and breaks in surface continuity |
| `normals` | World normals |
| `wetness` | The wetness kind and amount per surface |
| `caps` | WebGL2 limits and extensions of this machine against the recorded set |

## 13. Technique ladder

Used by the plateau rule in `kit/07-QUALITY-BAR.md`. When a critic stops improving, move to the next rung for that problem.

| Problem | Rungs, in order |
| --- | --- |
| Reads as computer generated overall | Match exposure and grade to reference. Add wear, dirt and asymmetry from reference. Deepen the haze layers. Find the most uniform thing in frame and break it up. Add lens imperfection. Rebuild the weakest element from new reference |
| Reflections | Raise capture resolution. Add probes near the camera's subject. Jitter the probe position per sample. Tune screen-space reflection. Split the planar reflection by roughness |
| Rain and water | Rebuild streak exposure from reference. Add a depth layer. Rebuild splashes. Rebuild the bead shader from macro reference. Add run-off paths per surface |
| Materials | Swap to scanned texture sets. Add a second detail layer. Re-derive parameters from reference observations. Rebuild the shader for that material |
| Geometry | Add control where the silhouette breaks. Rebuild the part with a different modeling method. Split the part into separately built pieces |
| Noise, banding, shimmer | Raise samples. Change the sample sequence. Dither. Filter the offending texture or pattern |
| Camera and motion | Change the lens. Re-time the move. Reshoot the beat with different equipment logic |
| Compression | Lower grain. Lift the darkest gradient. Simplify the busiest region. Slow the fastest fine motion |
| Opening does not stop the scroll | Recompose frame 0 from the chosen key frame. Raise the contrast between the subject and what is behind it. Simplify the frame until it reads at phone size. Move a visible change into the first `film.hookSeconds` seconds. Open on a different angle |
| Composition and lighting design | Change the lens and the camera height. Move the key and rim sources. Restage the signs that light the beat. Rebuild the palette from the key frames. Reshoot the beat |

Which rows each critic uses:

| Critic | Rows |
| --- | --- |
| C1 | Reads as computer generated overall, then the row for whatever the jurors name most often |
| C2 | The row that matches the failed observation |
| C3 | Materials. Reflections. Rain and water |
| C4 | Geometry |
| C5 | Camera and motion. Rain and water. Noise, banding, shimmer |
| C6 | Opening does not stop the scroll |
| C7 | Compression |
| C8 | Composition and lighting design. Camera and motion |
| Any extra critic from `kit/02-VEHICLE.md` | Geometry. Materials. Unless that file names other rows |

A critic has run out of rungs only when every rung in all of its rows has been tried.
