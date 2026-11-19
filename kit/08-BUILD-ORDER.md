# 08 · Build order

Work the phases in order. A phase ends when every line of its gate is true and logged with evidence. Then commit, push and start the next phase without waiting.

## Before Phase 0

1. Read `AGENTS.md` and `kit/00-README.md`.
2. Open `kit/02-VEHICLE.md`. If it contains the line `Status: NOT WRITTEN`, follow stop condition 1 in `AGENTS.md`: fill it from the `Vehicle:` line of the task prompt if there is one, and stop only if there is not.
3. Read `kit/PROGRESS.md` and every file in `kit/addenda/`. If a phase is already in progress, continue it.

## Phase 0 · Ground truth

Read first: `AGENTS.md`, `kit/00-README.md`, `kit/05-ARCHITECTURE.md`, `config/showcase.json`.

Steps:

1. Push a small change to `kit/PROGRESS.md` to `repo.url`. If it fails, retry. If it still fails, stop as `AGENTS.md` says.
2. Record the workspace: OS, cores, memory, disk, Node and npm versions, browsers, the WebGL2 limits and extensions under software rendering, and whether the browser can encode `export.videoCodec`.
3. Confirm `ffmpeg` and `ffprobe` run. If either is missing, install a static build through npm from the repo root once `package.json` exists.
4. Test whether a detached process outlives a scripted step.
5. Test whether supporting agents share this VM or get their own. If they share it, `sandbox.maxRenderProcesses` applies to all of them together.
6. Measure the image limit: view a landscape and a portrait test image with fine numbered marks and find the longest edge that arrives without being downscaled. If it is smaller than `critics.maxImageLongEdgePx`, lower that key.
7. Record what you can call: image models, and the model families available for supporting agents.
8. Verify current stable versions of the stack from each project's own documentation. Pin them.
9. Scaffold the app: config import and validation, seeded random, sampler, accumulator, timeline with every beat, the frame interface, `capture` mode.
10. Build the harness commands `still`, `determinism` and `gate`.
11. Build a spike scene: a few hundred thousand triangles, physical materials, one planar reflection, accumulation at every tier.
12. Measure seconds per sample at each format, and the fixed cost of starting a chunk: browser launch, shader compile and simulation replay.
13. Write the render budget table: time for one judged still at the `final` tier, and time for the whole preview film at each tier.
14. Choose the chunking strategy from what steps 4 and 12 found.

Gate:

- A push has succeeded.
- G1, G2, G3 and G4 are green on the spike.
- The workspace record, the pinned versions and the render budget table are in `kit/PROGRESS.md`.

## Phase 1 · Reference and key frames

Read first: `kit/01-FILM.md`, `kit/02-VEHICLE.md`, `kit/03-WORLD.md`, `kit/06-REFERENCE.md`, the K1 section of `kit/07-QUALITY-BAR.md`.

Steps:

1. Gather reference for every element in `kit/06-REFERENCE.md`. Use supporting agents in parallel. Write `reference/BOARD.md`.
2. Build and vet the control pool.
3. Generate the key frame directions. Choose one with K1. Generate one key frame per beat in that direction.
4. Shortlist third-party assets and start `ASSETS.md`.
5. Do any preparation `kit/02-VEHICLE.md` asks for.
6. Write `cut/SHOTS.md`: for every beat and both formats, the lens, the rig, the move, the start and end framing, the focus plan and what is in frame.

Gate:

- Every element on the board meets `reference.minSourcesPerElement` and `reference.minObservationsPerSource`.
- The control pool holds at least `quality.blind.minControlPool` vetted controls.
- One key frame direction is chosen with logged K1 scores, and every beat has a key frame.
- `cut/SHOTS.md` covers every beat in both formats.

## Phase 2 · Blockout in motion

Read first: `kit/01-FILM.md`, `kit/05-ARCHITECTURE.md`, `cut/SHOTS.md`, the judged frames, packs and blockout sections of `kit/07-QUALITY-BAR.md`.

Steps:

1. Gray-box the world at real size: deck, parapet, stair core, ramp, light poles, towers as plain volumes.
2. Add the blockout vehicle module with working anchors and state, as the contract in `kit/05-ARCHITECTURE.md` describes.
3. Animate every beat in both formats. Build the camera rig and the operator motion.
4. Build the `live`, `autopilot` and `export` modes and the menu.
5. Build the harness commands `sheet`, `crops`, `film`, `pack`, `proof` and `keep`.
6. Write the fixed list of judged frames into `kit/PROGRESS.md`. Grow the control pool if the list needs more controls than it holds.
7. Run C5 blockout and C8 blockout.
8. Fix and repeat until both pass.
9. From the final build of this phase: render the blockout preview film, run `npm run proof`, run `npm run proof -- --memory`, then run `npm run keep`.

Gate:

- G1 to G9 are green.
- C5 blockout and C8 blockout each score at least `quality.passScore` with no severe or major issue open.
- The judged frame list is in `kit/PROGRESS.md` and the control pool covers it.
- `out/preview.mp4` is committed.

## Phase 3 · Look lock

Read first: `kit/03-WORLD.md`, `kit/04-LOOK.md`, `kit/06-REFERENCE.md`, `kit/07-QUALITY-BAR.md`, `reference/BOARD.md`.

Prove the whole technique on two frames before spreading it across the film.

Steps:

1. Finish everything visible in the hero frame and the macro frame: geometry, materials, wetness, rain, reflections, haze, beams, lens and grade. That includes the vehicle, built as `kit/02-VEHICLE.md` says.
2. Build the diagnostic views.
3. Settle the paint as `kit/04-LOOK.md` section 11 describes.
4. Run rounds with C1, C2, C3, C4 and C8, and any extra critic `kit/02-VEHICLE.md` defines, on the look lock set until the pass bar holds, including the confirmation round.
5. From the final build of this phase: run `npm run proof`, then run `npm run keep`.
6. Write the locked settings into `kit/PROGRESS.md` under "Look lock": tone map, exposure, grade, palette, sample counts, reflection setup and the paint.

Gate:

- G1 to G7 and G9 to G14 are green.
- The pass bar in `kit/07-QUALITY-BAR.md` holds for C1, C2, C3, C4 and C8 on the look lock set, and for any extra critic `kit/02-VEHICLE.md` defines.
- `npm run keep` has run and the look lock stills are committed in `out/stills/`.

## Phase 4 · Full build

Read first: every file from `kit/01-FILM.md` to `kit/07-QUALITY-BAR.md`, and the "Look lock" section of `kit/PROGRESS.md`.

Steps:

1. Bring every beat to the locked look. Finish the rest of the world and the rest of the vehicle.
2. Finish every secondary motion in `kit/01-FILM.md` and `kit/03-WORLD.md`.
3. Finish the vertical reframing.
4. Build the harness command `stress`.
5. Run rounds with every critic, C1 to C8, and any extra critic `kit/02-VEHICLE.md` defines, on the full judged list. Run `npm run stress` for C7 in every round, with `--confirm` in the confirmation round.
6. Keep going until the pass bar holds, including the confirmation round.
7. From the final build of this phase: render the preview film, run `npm run proof`, then run `npm run keep`.

Gate:

- G1 to G14 are green.
- The pass bar in `kit/07-QUALITY-BAR.md` holds for every critic on the full judged list, including any extra critic `kit/02-VEHICLE.md` defines.
- The judged stills and `out/preview.mp4` are committed.

## Phase 5 · Capture and cut

Read first: `kit/05-ARCHITECTURE.md`, `kit/09-QA-GAUNTLET.md`.

Steps:

1. Run `npm run proof` and `npm run proof -- --memory` on the final build.
2. If anything under `src/`, `public/` or `config/` changes in this phase, render the judged stills and the preview film again, and run one more confirmation round.
3. Run `npm run keep` so `out/stills/` holds every judged frame and every vertical judged frame from the final build.
4. Write `cut/CUES.md`.
5. Publish the built app with Computer's own app hosting so it opens at a public URL. Computer has published earlier builds under `pplx.app`. If no hosting is available, log that and continue.
6. Write `README.md`: what this is, the app URL, how to run it, how to export, where the scorecards are.
7. Run every item in `kit/09-QA-GAUNTLET.md` and record the evidence.
8. Commit and push.

Gate:

- G1 to G14 are green.
- Every item in `kit/09-QA-GAUNTLET.md` passes with evidence in `kit/PROGRESS.md`.

## BUILD COMPLETE

When the Phase 5 gate holds, end the task with exactly this block, filled in:

```
BUILD COMPLETE
App URL: <url, or "not published">
Export: <url>?mode=export
Preview film: out/preview.mp4
Stills: out/stills/
Scorecards: scorecards/
Rounds run: <number>
Final scores: C1 <renderMean> against <controlMean>, C2 <n>, C3 <n>, C4 <n>, C5 <n>, C6 <n>, C7 <n>, C8 <n>
Extra critics: <id and score for each, or "none">
Open items: <list, or "none">
```
