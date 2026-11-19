# The render pipeline

How a frame is made and where each folder plugs in. `kit/04-LOOK.md` says what the picture has to show. This file says how the code is arranged to get there. The types are in `src/core/contract.ts`, `src/vehicle/contract.ts`, `src/world/contract.ts` and `src/weather/contract.ts`.

## Conventions

- Meters, Y up. The vehicle rests on y = 0 at the origin and faces +Z. Its left side is +X. The deck surface is y = 0.
- Colors are linear sRGB. Radiance 1.0 is 100 cd/m2. A light's `intensity` is candela divided by 100. An emissive surface's color times its `emissiveIntensity` is its luminance in cd/m2 divided by 100. A lit LED billboard is 3 to 6, a neon tube 10 to 30, a headlamp beam 200 to 400 on its axis, a wet deck under signs 0.005 to 0.2. Exposure is set once in the post stage.
- The renderer writes linear values into float targets. No tone mapping and no color space conversion before the post stage. Materials are standard three.js physical materials wherever possible, so one lighting path serves everything. Custom shaders read the same lights through `filmLightsGlsl` and `FilmLightUniforms` in `src/core/lights.ts`.
- Several systems may change one material. Each adds a patch through `patchMaterial` in `src/materials/patch.ts`. Never assign `onBeforeCompile` directly.
- Layers: `layers.scene` is everything. `layers.cameraOnly` is for things only the film camera should see, such as drops close to the lens.
- Determinism as in `kit/05-ARCHITECTURE.md`. Every value comes from the frame index, the sample index, the config and the seed.

## One frame

`FrameEngine` (`src/core/engine.ts`) drives the stage (`src/core/film-stage.ts`).

Once per frame, in `beginFrame`:

1. Every `SceneSystem.beginFrame` runs with the frame's center time. Systems that are left out of the time jitter set themselves here. Rain is the main one.
2. The environment capture: a cube render from the vehicle's position with the vehicle hidden, filtered for roughness, set as `scene.environment`. Reflections on the vehicle and props are corrected to `world.reflectionBox`.

For every sample, in `renderSample`:

1. Time is the sample's time inside the shutter. The vehicle state, the camera with its lens jitter, and every `SceneSystem.beginSample` are set to it.
2. The light rig moves each light to one point of its emitter, chosen by the sample's light jitter, and sets its level. Shadow maps are drawn from there. Averaged over the samples this gives area lights with soft shadows.
3. The planar reflection of the deck is drawn with the mirrored sample camera.
4. The scene is drawn into the sample target (linear float color and depth).
5. Sample passes run in order: the haze and beam pass, then any pass a system supplies (heat shimmer).
6. The result is added to the running sum.

Once per frame, in `finishFrame`: the post stage (`src/post/`) reads the average and writes the display picture: lens effects, tone map, grade, grain, dither.

## Who owns what

| Folder | Holds | Plugs in through |
| --- | --- | --- |
| `src/core/` | Engine, accumulator, sampler, lens, stage, light rig, shadow setup, planar deck reflection, environment capture and its parallax correction, haze and beams | `Stage`, `SceneSystem`, `FilmLight`, `SamplePass` |
| `src/post/` | Everything after accumulation | `Resolver` in `src/core/engine.ts` |
| `src/world/` | Deck, parapet, structures, services, city, signage, sky, the lights they carry | `WorldModule`: a `SceneSystem` plus `deck`, `reflectionBox`, `surfaces`, `signs` |
| `src/vehicle/` | The vehicle | `VehicleModule`. The stage turns `lamps` into film lights |
| `src/weather/air/` | Rain in the air, splashes, mist above the deck, steam, heat shimmer | `createAir(deps)`: a `SceneSystem` |
| `src/weather/surface/` | Water on surfaces: beads, rivulets, sheets, drips, porous wetting, puddles, ripples | `createSurface(deps)`: a `SceneSystem` that patches the materials in `world.surfaces` and `vehicle.surfaces` |
| `src/materials/` | The patch helper and any material shared by two folders | `patchMaterial` |
| `src/diagnostics/` | The diagnostic views | `setDiagnostic` on the stage, the systems and the resolver |

## Rules for a system

- `root` holds everything the system draws. `lights` holds every light it carries. Both are fixed after creation.
- Everything animated is a closed-form function of time, periodic over the film, or a fixed-step simulation from frame 0.
- A system never reads the clock, the canvas size or the previous frame.
- A system never renders on its own. If it needs a screen pass it supplies a `SamplePass`.
- Every mesh sets `castShadow` and `receiveShadow` as a real object would.
- Budget, measured in software rendering at the master size: the whole scene should stay under about 8 seconds per sample and 20 seconds of fixed cost per frame. Say what your part costs when you report.

## The deck

- `world.deck.material` is a physical material. `world.deck.heightMap` gives the relief, lowest where water collects.
- The surface water system patches it first: porous darkening, lower roughness when wet, the puddle mask from the height map and the water level, ripple normals.
- The stage patches it last: the planar reflection replaces the environment term, looked up at a blur level that follows the final roughness and offset by the final normal, so ripples and relief break the mirror.

## Lights

- Signs, the billboard, the doorway and the pole heads are `area` or `spot` lights with a real emitter size. Their emissive geometry is what the camera and the reflections see. The light is what the surfaces around them receive. The two must agree in color and brightness.
- The rig holds 16 lights. The world may carry 8, at most 4 of them with shadows. Distant signage lights nothing directly: it reaches the scene through the environment capture, the deck reflection and the haze.
- The vehicle's `lamps` become lights in the stage. A `beam` lamp is a shadowed spot that the haze pass marches, at most 4. All other lamps are merged into one point light per corner of the vehicle, so a lamp may be made of as many lit parts as it needs.
