# 002 · The approved look

Added November 20, 2026. Brandon has now seen the three key frame directions. He approved direction A. On the topics below this beats every kit file, every key frame and every critic.

## The approved image

- `reference/approved/hero.jpg`. It is the image that was `reference/keyframes/direction-A.jpg`. Its hash is in `reference/approved/MANIFEST.sha256`.
- Never regenerate it, replace it, crop it, regrade it or tone it down.
- New gate check G15: the file matches its hash. It runs with the other checks in every phase from now on.
- It is the target for the hero frame and the style anchor for the whole film.

What Brandon approved, in his words:

- The colors.
- The colors reflecting up from the rain puddles on the ground.
- The position of the camera and how it looks at the car.
- The layout of the buildings.

What the image does not settle:

- Sign lettering. Some of its signs are garbled. Every sign in the build still takes its text from `signage` in the config.
- What the vehicle is. That stays with `kit/02-VEHICLE.md`.
- Physical behavior. Where the image and a photograph on the board disagree about how water, light or a material behaves, the photograph wins.

## What this retires

- Direction C and the K1 result. Move the direction C beat key frames to `reference/keyframes/retired/`. They are targets for nothing.
- The K1 note "Oversaturated sign color reads as a game render. Sign color stays inside the grade." The grade follows the approved image.
- The paint choice in `kit/04-LOOK.md` section 11. `paint.locked` is now set in the config. Run no paint round.

## Palette and light

| Part of the frame | Color and role |
| --- | --- |
| The large LED billboard on the tower behind the vehicle | Magenta to violet, slowly animated. The main key light on the vehicle and the deck |
| Sign group on the camera's left | Cyan and teal. Rim light on the vehicle and long cyan streaks on the deck |
| Sign group on the camera's right | Amber. Warm rim light and amber streaks on the deck |
| Parapet lights | Warm white strips low on the wall, pooling on wet concrete |
| Cloud base and haze | Lit magenta and violet from below |
| Windows | Mostly warm, many of them, at every distance |
| Darks | Neutral near-black that keeps detail |
| The vehicle's lamps | Cold white, the brightest neutral thing in frame |

- Saturation matches the approved image. No color clips to a flat patch.
- Every sign lights the haze around it and the surfaces near it.

## The world from the hero camera

Arrange the deck and the city so the hero frame matches the approved image.

- A concrete parapet with a steel rail runs behind the vehicle across the frame.
- Towers stand close behind the parapet on both sides, with taller ones further back, fading into haze.
- The billboard fills a tower face behind the vehicle, right of center, from above the roofline to the top of the frame.
- Left of the vehicle: tall cyan vertical signs and light strips, and cyan signs that read as words from the config.
- Right of the vehicle: stacked amber signs and an amber wayfinding sign with an arrow at the parapet.
- A drain grate and a painted bay line lie on the near deck.
- Vertical sign shapes that are not words are built as abstract LED bars with no glyphs.
- The rest of `kit/03-WORLD.md` still applies wherever the approved image is silent.

## Reflection

This is what Brandon asked for most.

- The deck holds wide standing water. From the hero camera most of the near deck mirrors the city.
- Every sign and the billboard has its own long vertical streak of its own color on the deck, broken by ripples and by the texture of the surface.
- The vehicle's glossy surfaces carry the billboard and the signs as moving colored reflections. A dark body is read through them.
- Beads on the body each hold a small bright image of the sources.
- The wet parapet and the wet rail catch the same colors.
- The planar reflection and the cube capture include every sign, the billboard and the vehicle's lamps.

## The hero camera and the wide beats

- At `film.heroFrameSeconds` the camera matches the approved image: lens, height, distance, angle to the vehicle, and where the vehicle sits in the frame.
- `arrival` opens wider on the same axis and pushes in to that framing with the vehicle dark. `wake` settles on it. `return` pulls back along it to the opening frame, so the loop still closes.
- The macro beats keep their cameras.
- Reframe the vertical version of the wide beats to suit.
- Update `cut/SHOTS.md`. Run no blockout critic round for this. C5, C8 and C9 judge the new cameras in Phase 3, with light.
- G3, G6 and the loop tests stay green.

## Key frames for the other beats

- The `wake` key frame is the approved image.
- Generate one new key frame for each other beat with the approved image attached as the reference image, so the set looks like one film.
- At most `keyframes.maxTakes` takes per beat. At the limit keep the best take and move on.
- No jury. Post each frame in the thread as it finishes.
- Record every prompt in `reference/keyframes/PROMPTS.md`.
- These frames are targets under the approved image. Where one disagrees with it, the approved image wins.
- Do this in parallel with the build. The build does not wait for it.

## Critics

### C9 · Match

A new critic. It runs in Phases 3 and 4 and joins the pass bar at `quality.passScore`. It receives its pack, this section word for word and the return format in `kit/07-QUALITY-BAR.md`.

You are told both images come from one film in production. The first is the target. The second is the current frame.

- Pack: the target and the current hero frame at the same size, and three pairs of matching crops: the near deck, the sign groups, and the sky with the billboard.
- Compare only these: the palette. The color, size and placement of the light sources. The reflections of those sources on the wet ground and on glossy surfaces. The camera position, height and framing. The layout of the buildings. The haze and the sky.
- Do not judge what the vehicle is or how it is designed. Do not judge sign lettering.
- Severe: a viewer would see the difference at a glance. Major: visible when the two are compared side by side at full size. Minor: visible only in the crops.
- Score 10 when a viewer shown both would say they are the same shot, in the same place, on the same night.

For the plateau rule C9 uses the rows "Composition and lighting design" and "Reflections" in `kit/04-LOOK.md`. If C9 runs out of rungs, log what is still open under "Open items" in `kit/PROGRESS.md` and continue. C9 is never a blocker.

### The other critics

- C2 receives the new beat key frames, and the approved image for the hero frame.
- Any issue from any critic or juror that asks for less color, fewer signs, less reflection, a darker deck, or a different hero framing than the approved image is declined. Log it under a new heading "Declined issues" in `kit/PROGRESS.md` with the critic's words. It does not count as an open issue.
- No other severe or major issue may be declined.
- C1: add `quality.blind.neonControls` real photographs of rain-wet streets at night under magenta, cyan and amber signs to the control pool, vetted the usual way in one pass, so the jury compares like with like. Draw the controls for wide frames from these first.

## What does not change

- The length, the beats, the macro cameras, determinism, the harness, every other gate, `quality.passScore`, and the reference board.
- The vehicle work in progress. Carry on with it.
- Addendum 001.

## Order of work from here

1. Merge this addendum. Add G15.
2. Move the hero camera and the wide beats. Update `cut/SHOTS.md`.
3. Restage the city, the signs, the billboard and the standing water for the hero frame, in the palette above.
4. Start the new beat key frames in parallel.
5. Carry on with Phase 3 step 1, then the rounds.

In every update in the thread from now on, show the current hero frame beside the approved image.
