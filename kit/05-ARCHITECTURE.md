# 05 · Architecture

## Stack

- Vite, TypeScript strict, three.js on WebGL2, GSAP for easing.
- Vitest for unit tests.
- A headless browser driver for the harness. Use the one that works with the browser already in this workspace.
- An MP4 muxer library for Export.
- `ffmpeg` and `ffprobe` for films and checks.
- Verify the current stable version of each from its own documentation in Phase 0. Pin the versions and record them in `kit/PROGRESS.md`.

## Folders

```
config/showcase.json     every number
src/
  main.ts
  config.ts              typed import of the config, validated at startup
  core/                  renderer, accumulator, sampler, seeded random, tiers
  director/              timeline, beats, camera rig, modes, menu
  world/                 deck, city, signage, sky, props
  weather/               rain, splashes, ripples, wetness, run-off, steam
  vehicle/               the vehicle module. Nothing outside this folder knows what the vehicle is
  materials/             shared material library
  post/                  lens, tone map, grade, grain
  capture/               frame interface, Export
  diagnostics/           the views listed in kit/04-LOOK.md
public/assets/third-party/   every file the Builder did not make, and nothing else
tools/                   harness scripts
tests/
reference/               BOARD.md, keyframes/, cache/ (ignored by git)
scorecards/              one folder per round, text only
cut/                     SHOTS.md, CUES.md
out/                     stills/ and preview.mp4, committed at phase gates. work/ holds every harness output and is ignored by git
```

## The config

- `src/config.ts` imports `config/showcase.json`, validates it and exports it typed.
- No other file contains a number that the config holds.
- Startup fails loudly if a key is missing, if the beats do not start at 0, if they have gaps or overlaps, or if the last beat does not end at `film.durationSeconds`.

## Determinism

A frame is a pure function of its frame index, the format, the tier, the paint and the config.

- No `Math.random`, `Date.now` or `performance.now` in anything that affects a pixel.
- All randomness comes from one seeded generator built from `seed`, with a named stream per system.
- Time is the frame index divided by `film.fps`. It is never wrapped. A system loops because its own math is periodic over `film.durationSeconds`, not because time resets.
- Animation is either a closed-form function of time, or a fixed-step simulation that always starts from frame 0. A simulation may cache checkpoints. The cache never changes the result.
- Rendering frame N after frame M gives the same image as rendering frame N on a fresh page load.
- Asset loading finishes before the first frame. No frame depends on what has loaded so far.
- Everything animated is periodic over `film.durationSeconds` or returns to its start value, as `kit/01-FILM.md` requires.

## The frame interface

The page exposes one object on `window`:

```ts
interface Showcase {
  ready: Promise<void>
  info(): { frameCount: number; fps: number; format: string; tier: string; paint: string; buildHash: string; versions: Record<string, string> }
  setFormat(id: string): Promise<void>
  setDiagnostic(view: string): void
  setPaint(id: string): void
  renderFrame(frameIndex: number, tier: string): Promise<void>
  beginFrame(frameIndex: number, tier: string): Promise<void>
  addSamples(count: number): Promise<number>
  saveSum(): Promise<void>
  loadSum(): Promise<void>
  finishFrame(): Promise<void>
}
```

- `renderFrame` leaves the finished frame on the canvas. It is `beginFrame`, then `addSamples` until the tier's sample count is reached, then `finishFrame`.
- `addSamples` returns how many samples the running sum now holds.
- The split calls exist so the harness can spread one frame's samples across several steps when a frame at the `final` tier does not fit in `sandbox.chunkBudgetMinutes`.
- The running sum stays on the page. `saveSum` and `loadSum` send and fetch it as raw bytes through a local HTTP endpoint the harness serves, and the harness keeps it on disk. It never crosses the browser driver's own protocol.
- There is one running sum and samples are added in index order. A frame built in chunks across several page loads is pixel-identical to the same frame built in one pass.
- `frameCount` is `film.fps` times `film.durationSeconds`. The film is frame indices 0 to `frameCount - 1`. Index `frameCount` can be rendered and exists only for the loop check in G6.

## Modes

Set by URL: `?mode=`, with `format`, `tier`, `frame`, `first`, `last`, `diag` and `paint` as optional parameters.

| Mode | What it does |
| --- | --- |
| `live` | Free orbit in real time at a reduced tier. A menu on the `M` key switches mode, format, tier, diagnostic and paint, and scrubs the timeline |
| `autopilot` | Plays the timeline in real time with a clean frame |
| `capture` | Renders nothing until asked through the frame interface. The harness uses this |
| `export` | Renders and encodes the whole film on this machine. See below |

- `live` is the default.
- No interface pixel ever appears in `capture`, `autopilot` or `export` output.

## The vehicle contract

`src/vehicle/` exports one factory. What it builds is defined by `kit/02-VEHICLE.md`. How the rest of the app talks to it is defined here.

```ts
type WetnessKind = 'beads' | 'sheet' | 'porous' | 'none'

interface Anchor {
  position: THREE.Vector3
  normal: THREE.Vector3
  radius: number
}

interface VehicleState {
  timeSeconds: number
  lampStage: number
  engine: number
  vibration: number
}

interface VehicleModule {
  root: THREE.Object3D
  anchors: Record<'paint' | 'wheel' | 'lamp' | 'detail' | 'exhaust', Anchor>
  surfaces: Array<{ material: THREE.Material; wetness: WetnessKind }>
  lamps: Array<{ object: THREE.Object3D; stage: number; beam: boolean }>
  heatSources: Array<{ object: THREE.Object3D; strength: number }>
  update(state: VehicleState): void
}
```

- `root` is in meters, Y up, resting on y = 0, centered on X and Z, facing +Z.
- `anchors` are what the timeline frames in the macro beats. `radius` is the size of the area of interest.
- `lampStage` runs from 0 to 1 across the `wake` beat and back to 0 in the `return` beat.
- Each lamp's `stage` is a threshold between 0 and 1. A lamp is lit when `lampStage` is at or above its `stage`, with a short eased ramp.
- `engine` runs from 0 (off) to 1 (running) in the `ignition` beat and back to 0 in the `return` beat.
- `vibration` is what shakes beads loose.
- If the vehicle has no combustion engine, `engine` drives whatever its power-up is, `heatSources` may be empty, the `exhaust` anchor is the point of interest at the rear, and the `ignition` beat films that power-up with the same camera.
- The body paint material takes its color from the active paint candidate.
- The weather system applies wetness to each entry in `surfaces`. The vehicle module does not implement water.
- The world provides reflections, haze and beams for `lamps`, and heat shimmer and steam for `heatSources`.
- A blockout version of the module, with the right overall size, working anchors and working state, exists from Phase 2 so the film can be shot before the vehicle is finished.

## The harness

Scripts in `tools/`, run through npm.

| Command | Output |
| --- | --- |
| `npm run still -- --frame N --tier T --format F --diag V --paint P` | One still in `out/work/stills/` |
| `npm run sheet -- --beat ID --tier T --format F` | A contact sheet of `critics.contactSheetFrames` frames across the beat. `--beat seam` gives the sheet that crosses the loop |
| `npm run crops -- --frame N --tier T --format F --paint P` | Native-size crops with a long edge of at most `critics.maxImageLongEdgePx`, covering every material and every area of interest in the frame |
| `npm run film -- --tier T --format F` | Frames 0 to `frameCount - 1` in `out/work/frames/`, then `out/work/film-F-T.mp4`. Each frame is checked for G5 as it is rendered and the result is stored in the film's record |
| `npm run stress` | For each beat in `quality.stress.beats`: `quality.stress.seconds` of film at `formats.master` and the `quality.stress.tier` tier, encoded at `export.bitrateMbps`, then re-encoded at `quality.compressionStressMbps`, with stills from both. `--confirm` uses `quality.stress.confirmTier` instead |
| `npm run pack -- --phase N --round R --paint P` | The critic packs for a round of that phase, as `kit/07-QUALITY-BAR.md` describes |
| `npm run keep` | Copies the judged stills that match the current build into `out/stills/`, and the `formats.preview` film to `out/preview.mp4` if one matches the current build, each with its record. Run at a phase gate, before the gate check |
| `npm run proof` | Drives `?mode=export` at `formats.preview` and the `draft` tier for `export.proofSeconds` seconds of film, saves the download as the file named in `export.files.preview` under `out/work/export/` with its record, and runs `ffprobe` on it. `--memory` runs the memory test instead |
| `npm run determinism` | Renders the same frames on fresh page loads, in a different order and in chunks, and compares them |
| `npm run gate -- --phase N` | Every automated check that phase needs, with a pass or fail line for each |

Rules:

- The browser runs headless with software WebGL.
- The build hash is a hash of everything under `src/`, `public/` and `config/` plus the package lock file. Commits that touch only logs or scorecards do not change it.
- Every output file has a record beside it: build hash, format, tier, paint and diagnostic. A command reuses an existing output only when its record matches the current state. Otherwise it renders again.
- Any command that can exceed `sandbox.chunkBudgetMinutes` does its work in chunks and can be run again to continue.
- The browser driver's own timeouts are set above `sandbox.chunkBudgetMinutes`.
- At most `sandbox.maxRenderProcesses` render processes run at once in one VM.
- Preview films are rendered at the highest tier whose estimated time, from the render budget, fits in `sandbox.previewFilmMaxHours`. Never below `draft`. If `draft` does not fit either, render at `draft` anyway.
- Every harness output is written under `out/work/`, which git ignores. `out/work/frames/` is emptied once its film is encoded.
- Phase 0 tests whether a detached process outlives a scripted step. If it does, long renders may run detached with a log file that is polled. If it does not, they run in chunks.

## Export

`?mode=export` is how the master is made, on a computer with a GPU.

- One page with a format choice and a start button.
- Renders frames 0 to `frameCount - 1` at the `final` tier in `formats.master` by default, through the same code path as `renderFrame`.
- The `tier` and `format` parameters override those defaults. The `first` and `last` parameters limit the run to a range of frames. These exist for testing.
- Encodes with WebCodecs to `export.videoCodec` at `export.bitrateMbps`, muxes to `export.container`, and downloads the file named in `export.files`.
- Shows frames done, elapsed time and time remaining.
- Yields between frames through a message channel or the encoder's own callbacks. It does not use timers or `requestAnimationFrame`.
- Requests a screen wake lock and carries on if the request is refused.
- If the WebGL context is lost it stops and says so in plain words. It never writes a file with missing frames.
- Memory use is flat across the whole run.
- If the browser cannot encode `export.videoCodec`, the page says so in plain words before starting.
- Proof in this workspace, made by `npm run proof`: run Export end to end at `formats.preview` and the `draft` tier for `export.proofSeconds` seconds of film, and confirm the file with `ffprobe`. If this workspace's browser cannot encode `export.videoCodec`, prove the pipeline with a codec it has and log that `export.videoCodec` is unproven here.
- Memory test in this workspace, made by `npm run proof -- --memory`: run Export at `formats.preview` and the `draft` tier for `export.memoryTestSeconds` seconds of film and log memory use at intervals.

## Build output

- `npm run build` produces a static site in `dist/` with relative URLs. It works from any host at any base path.
- No server code. No runtime network calls except loading its own files and, in `capture` mode, the harness's endpoint for the running sum.

## Tests

- Config validation, including every failure case above.
- Seeded random: same seed, same stream, same values.
- Timeline: every beat boundary, and state at 0 equals state at `film.durationSeconds` for every animated system, computed without wrapping time.
- Sampler: sequences are deterministic and cover the aperture, the shutter and the pixel.
