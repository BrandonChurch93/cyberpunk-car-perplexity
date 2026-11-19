# Reflections

`createReflections(deps)` returns a stage part with two uniform sets other parts can bind.

## Environment capture (`box`)

Once per frame in `beginFrame` a cube is drawn from 0.6 m above the deck at the vehicle, with the vehicle hidden, filtered for roughness by `Prefilter` (GGX, PMREM layout) and set as `scene.environment`. On the final tier a small first capture without the deck lights the deck inside the main capture, so the body sees the deck's own reflection.

Every standard and physical material under `world.root` and `vehicle.root` gets the `reflect-box` patch: the environment lookup is corrected to `world.reflectionBox`. Materials added later are picked up at the next `beginFrame`.

| Uniform | Meaning |
| --- | --- |
| `reflectBoxMin`, `reflectBoxMax` | World corners of the box |
| `reflectProbe` | World position of the capture |
| `reflectBoxOn` | 1 to correct, 0 for a plain infinite lookup |

The patch adds `varying vec3 vReflectWorld` (world position, after batching and instancing) and the function `vec3 reflectBoxProject(vec3 worldDir)` to the fragment shader.

## Planar reflection of the deck (`planar`)

Redrawn before every sub-render (first sub-render only below the final tier) from the mirrored sample camera with an oblique near plane on y = 0, deck hidden, `layers.scene` only, same lights and time. The `reflect-planar` patch on `world.deck.material` replaces the specular environment term (`radiance` and `clearcoatRadiance` after `#include <lights_fragment_maps>`) with GGX taps into the mirror image. It reads `geometryNormal`, `geometryClearcoatNormal` and `material.*`, so normal and roughness changes made earlier in the shader bend and blur it.

| Uniform | Meaning |
| --- | --- |
| `reflectMap` | HDR mirror image, half float, with mips |
| `reflectDepth` | Its depth, float |
| `reflectViewProjection`, `reflectInverseViewProjection` | World to mirror clip space and back |
| `reflectSize` | Target size in pixels |
| `reflectLodMax` | Last mip level |
| `reflectSeed` | Per sub-render seed of the tap pattern |
| `reflectOn` | 0 while the mirror itself is drawn, so nothing sees its own reflection |

A world point `x` is found in the mirror image at `(reflectViewProjection * vec4(x, 1)).xy / w * 0.5 + 0.5`.

## Quality per tier

`quality` in `index.ts` sets cube size, the bounce, planar resolution and how often the planar is redrawn. Measured at 16x9, frame 195, full world, against 11.2 s per sample without this part:

| Tier | Per sample | Per frame, once |
| --- | --- | --- |
| draft | 1 sample, 22 s against 12 s | capture 256 and one planar draw at quarter size |
| review | +3.2 s | capture 512 and one planar draw, about 10 s |
| final | +8 s | capture 1024 with bounce, about 17 s |

## Diagnostics

`zebra` puts a striped environment in place of the capture and turns every vehicle material into a perfect mirror. Box projection and the planar are off in this view.
