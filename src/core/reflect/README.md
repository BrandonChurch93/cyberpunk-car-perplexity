# Reflections

`createReflections(deps)` returns a stage part with two uniform sets other parts can bind.

## Environment capture (`box`)

Once per frame in `beginFrame` a cube is drawn from 0.6 m above the deck at the vehicle, with the vehicle hidden, filtered for roughness by `Prefilter` (GGX, PMREM layout) and set as `scene.environment`. Each face that sees the deck gets its own mirrored view, reusing one padded HDR target at the cube face resolution. The wet material resolves that view with its normal, roughness and Fresnel as it does for the film camera. Lamp proxies are composited only after the background is drawn, so they do not appear in the deck's mirror or in the vehicle's environment.

The final tier also draws a small deck-free cube for broad first-bounce lighting. It supplies the fallback outside the planar view.

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

`quality` in `index.ts` sets cube size, the broad first bounce, and the resolution and cadence of the camera's planar target.

| Tier | Cube face | Camera planar scale | Camera planar cadence |
| --- | --- | --- | --- |
| draft | 256 px | 0.25 | First sample |
| review | 512 px | 0.5 | First sample |
| final | 1024 px | 0.5 | Every sample |

## Diagnostics

`zebra` puts a striped environment in place of the capture and turns every vehicle material into a perfect mirror. Box projection and the planar are off in this view.
