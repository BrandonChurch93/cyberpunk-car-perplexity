# 06 · Reference first

Nothing is built from imagination. An element is built only after it has real reference and written observations.

## Scope

- This file covers the world, the weather, the light and the lens.
- What the vehicle is, and any sources for it, are the business of `kit/02-VEHICLE.md`.

## The board

`reference/BOARD.md` holds one section per element.

- At least `reference.minSourcesPerElement` sources per element.
- Per source: the URL, what it shows, and at least `reference.minObservationsPerSource` observations.
- An observation is specific enough to check a still against. "Puddle reflections are sharper than the wet surface around them and stretch toward the camera" is an observation. "Looks wet" is not.
- Real-world sizes go on the board with the source they came from.
- Downloaded images live in `reference/cache/`, which git ignores. The board commits links and words only.

## Elements

| Element | What to learn from it |
| --- | --- |
| Wet asphalt and concrete at night under colored light | Darkening, gloss, how color light spreads, how texture shows through water |
| Puddles in rain | Reflection sharpness, ring size and spacing, edges, depth cues |
| Rooftop car park decks | Layout, bay markings, drains, joints, kerbs, parapets, stair cores, ramps, barriers, pay stations, plant, light poles, wear |
| Rain lit from behind | Streak length and brightness against exposure, density with distance, how it vanishes over dark areas |
| Rain hitting hard surfaces | Splash crowns, mist height, timing |
| Neon and LED signage in rain and haze | Glow falloff, halation, tube construction, panel pixel structure, damage |
| A dense city at night in rain | Depth layers, window variety, color of the cloud base, how far detail survives |
| Water on glossy coated paint, macro | Bead shape, size spread, refraction, highlights, merging, trails |
| Water on glass | Rivulet paths, film, distortion of what is behind |
| Steam and heat shimmer in rain | Shape, density, how light passes through |
| Night automotive photography and film | Lighting setups, lens choices, bokeh shape, flare, where black sits in the grade |
| Wet metal, wet rubber, wet painted steel | How each changes when wet |
| Real camera moves on vehicles | Speed, easing and framing of dolly, slider and crane shots |

## The control pool

Real photographs for the blind test in `kit/07-QUALITY-BAR.md`.

- Comparable to the judged frames: night, rain, city, vehicles, macro water on paint, wheels, lamps.
- No people. No watermark, caption or border. Any text in frame is in Latin letters.
- Vetting: show each candidate, one image per call, to `quality.blind.jurors` fresh jurors with the C1 text. Keep a candidate only if its median likelihood is at least `quality.blind.minControlMean`.
- The pool holds at least `quality.blind.minControlPool` vetted controls, and never fewer than the blind test needs for the current judged list.
- Vetting again means running every control through fresh jurors, dropping those that fail, and adding new vetted ones until the pool is full.
- Listed on the board under "Controls" with their URLs and vetting scores. The images stay in the cache.

## Key frames

Generated images that set the target for mood, palette and composition.

1. Generate `keyframes.directions` different directions for the hero frame. Use at least `keyframes.minImageModels` different image models.
2. Fresh critics pick one direction with the K1 rubric in `kit/07-QUALITY-BAR.md`. Log the scores.
3. In the chosen direction, generate one key frame per beat.
4. Commit them to `reference/keyframes/` with every prompt in `reference/keyframes/PROMPTS.md`.

Rules:

- Key frames set the look. Real photographs set physical behavior. Where they disagree, the photographs win.
- A key frame is never used as a texture, a backdrop or a frame of the film.
- Regenerate any key frame whose signage shows a real brand or logo.
- The vehicle in a key frame is the vehicle `kit/02-VEHICLE.md` defines.

## Third-party assets

- Every file the Builder did not make lives under `public/assets/third-party/`. Nothing else lives there.
- `ASSETS.md` at the repo root is the ledger. One row per file in that folder: file, what it is, source URL, license, date fetched.
- Check the license on the asset's own page when you download it.
- CC0 libraries of scanned textures, HDRIs and models are the first place to look.
- The rules on what is allowed are in `AGENTS.md`.
