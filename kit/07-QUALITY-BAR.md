# 07 · The quality bar

## The standard

A viewer believes the footage was photographed. Every check below tests that one thing from a different side.

- The critics here judge whether everything in frame, the vehicle included, reads as a real object in a real place, filmed by a real camera.
- Checks about what the vehicle is belong to `kit/02-VEHICLE.md`. If that file defines checks of its own, each one runs as an extra critic with the next free id, in Phases 3 and 4 only, and joins the pass bar there.

## The automated gate

`npm run gate -- --phase N` runs the checks that phase needs and prints pass or fail for each. Every one of them is green before any critic sees a round, except G8, G9 and the preview-frame part of G5. Those three are checked once per phase, at the phase gate, on the final build of that phase. `kit/08-BUILD-ORDER.md` says which checks each phase needs.

| Id | Check |
| --- | --- |
| G1 | `npm run build` exits clean with no type errors |
| G2 | Unit tests pass |
| G3 | `npm run determinism` passes: a frame is pixel-identical across fresh page loads, when frames are rendered in a different order, and when its samples are added in chunks |
| G4 | Every still is exactly the size of its format. `info().frameCount` equals `film.fps` times `film.durationSeconds` |
| G5 | No frame in scope is blank, a single flat color, or contains invalid pixels. In scope: the look lock set in Phase 3 and the judged frames from Phase 4. Preview frames are checked by `npm run film` as it renders each one, and G5 reads the result from the film's record at the phase gate |
| G6 | Loop seam, two tests. Structural similarity between frame 0 and frame index `frameCount` is at least `quality.loopSeamMinSsim`. And the difference between frame `frameCount - 1` and frame 0 is no larger than the largest difference between neighboring frames in the last second of the film. Both tests render at the `draft` tier in `formats.preview` |
| G7 | No interface element is visible in `capture` or `autopilot` output |
| G8 | `out/preview.mp4` exists and its record matches the current build hash. `ffprobe` reports `film.fps`, exactly `frameCount` frames and the `formats.preview` size. The file is under `repo.maxFileMb` megabytes |
| G9 | The Export proof exists, as `kit/05-ARCHITECTURE.md` defines it, and its frames show no interface element |
| G10 | Platform fit. `formats.master` is within `platform.maxWidth` and `platform.maxHeight`. `formats.vertical` is within `platform.maxPortraitWidth` and `platform.maxPortraitHeight`. `film.fps` is within `platform.maxFps`. `export.bitrateMbps` is within `platform.maxBitrateMbps`. `film.durationSeconds` is within `platform.loopsAtOrUnderSeconds` |
| G11 | Every string on every sign is in `signage` in the config |
| G12 | Every file under `public/assets/third-party/` has a row in `ASSETS.md` |
| G13 | No tracked file is over `repo.maxFileMb` megabytes. No secret is tracked. `reference/cache/` and `out/work/` are not tracked |
| G14 | The app requires no WebGL2 limit or extension outside the set recorded in Phase 0 |

Freshness: the gate and `npm run pack` accept an image or film only if its record matches the current build hash, format, tier and paint, as `kit/05-ARCHITECTURE.md` describes. Anything else counts as missing.

## Judged frames

- The fixed list the critics score. It lives in `kit/PROGRESS.md`.
- Frame 0, the hero frame, the macro frame, and enough others that every beat has at least `quality.judgedFramesPerBeat`.
- Pick the moments with the most detail and the most risk, not the easiest ones.
- Frames can be added to the list. A frame is never removed.
- Every judged frame is rendered at the `final` tier in `formats.master`.
- The vertical judged frames: one judged frame per beat, also rendered at the `final` tier in `formats.vertical`.

The look lock set, used in Phase 3, is built from two frames only: the hero frame and the macro frame.

- Both at the `final` tier in `formats.master`, each with its native-size crops and its `clay` and `zebra` views.
- Both at the `final` tier in `formats.vertical`.

In Phase 3, wherever a critic's section says judged frames, it means these two frames, vertical judged frames means the two vertical frames in the set, and each critic takes from the set only what its own section lists. No critic receives contact sheets in Phase 3. From Phase 4, judged frames means the full list.

## Packs

`npm run pack` builds what each critic receives.

- No image has a long edge over `critics.maxImageLongEdgePx`. A full frame is resized to fit. Fine detail is shown in native-size crops.
- Same file format for every image. All metadata is stripped.
- Neutral file names, as `AGENTS.md` requires.
- Pack images are written under `out/work/`, which git ignores, because packs contain controls. They are never committed.
- A critic receives its files as attachments only. Never give a critic a path into the repo or the workspace.
- A key maps each neutral name to what it is. It is written outside every folder a critic can reach, and copied into the round folder only after every answer for the round is in.

## The critics

- Every critic is a fresh agent in every round.
- C2 to C8 each receive their pack, their own section of this file word for word, and the return format below. Nothing else.
- An extra critic from `kit/02-VEHICLE.md` receives its pack, its own section of that file word for word, and the same return format. Nothing else.
- C1 jurors receive only what the C1 section says.
- Spread the critics across different model families. Rotate which family holds which role from round to round. If fewer families are available than a role needs, use every family available and log it.
- C2 to C8 each return one JSON object. The Builder writes the C1 scorecard from the jurors' answers.

```json
{
  "critic": "C3",
  "score": 7,
  "pass": false,
  "issues": [
    { "severity": "severe", "file": "set-C-04.png", "where": "lower left", "what": "the puddle reflects a sign that is not in the scene", "fix": "render the planar reflection from the real scene" }
  ]
}
```

- `score` is 1 to 10. `severity` is `severe`, `major` or `minor`. Issues are listed most severe first.

### C1 · Blind jury

One image per call, so no juror can compare images with each other.

- Judged images: every judged frame, plus one native-size crop from each of the `paint`, `wheel`, `lamp` and `detail` beats. In Phase 3 the judged images are the hero frame, the macro frame and two native-size crops of each.
- Controls: `quality.blind.controlsPerRender` for each judged image, drawn by seed from the control pool in `kit/06-REFERENCE.md`.
- Controls are resized, cropped and encoded exactly like the judged images.
- Each image goes to `quality.blind.jurors` jurors, each on a different model family.
- Each call is a fresh agent that receives one image and exactly this text, nothing else:

> You will see one image. It is either a photograph or a computer generated image. Give a likelihood from 0 to 100 that it is a photograph, and the one thing that most influenced your answer.

Scoring:

- `controlMean` is the mean likelihood over all controls and jurors.
- `renderMean` is the mean likelihood over all judged images and jurors.
- The gap is `renderMean` minus `controlMean`.
- The test is valid when `controlMean` is at least `quality.blind.minControlMean`.
- The test passes when it is valid, the gap is no worse than minus `quality.blind.maxGapPoints`, and the median juror likelihood for every judged image is at least `quality.blind.minRenderMedian`.

When the test is invalid:

- Run it again with fresh jurors.
- After `quality.blind.maxInvalidRuns` invalid runs in a row, vet the control pool again as `kit/06-REFERENCE.md` describes, and count the round as a round without gain for C1.

Other rules:

- For the plateau rule, C1's number is the gap.
- What a juror wrote about a judged image is input for the next round. It does not count as an open issue in the pass bar.

### C2 · World match

You are told the images are computer generated.

- Pack: the judged frames with their native-size crops, the key frame for each beat, and the board observations for every element in frame.
- For each observation, say whether the image matches it.
- Score 10 when every observation holds and nothing in frame lacks a real-world basis.
- List every failed observation as an issue.

### C3 · Material and light

You are told the images are computer generated.

- Pack: the judged frames, and native-size crops of each material in frame.
- Check each material against how it behaves in the real world: paint layers, flake, clearcoat, glass thickness and refraction, rubber, metals, woven composite, wet and dry porous surfaces, standing water, beads, rivulets.
- Check the light: every shadow has a source, every reflection shows something that is in the scene, glow comes from sources, contact shadows ground every object, colors of light and bounce agree with the sources in frame.
- Score 10 when no material and no light interaction gives the image away at native size.

### C4 · Build quality

You are told the images are computer generated.

- Pack: `beauty`, `clay` and `zebra` views of the judged frames that show the vehicle or a main prop, with native-size crops.
- Silhouettes: no straight polygon segments on any curve.
- Surfaces: in `zebra`, stripes flow without kinks, wobbles or breaks, except at deliberate creases and panel edges.
- Gaps between panels are even along their length.
- Edges have thickness. Nothing is paper thin.
- Parts that are separate objects in reality are separate geometry with a real join.
- Everything is real-world size relative to everything else.
- Tires flatten slightly where they meet the ground. Nothing floats and nothing intersects.
- Score 10 when the objects read as manufactured and assembled, at macro distance, in all three views.

### C5 · Motion

You are told the images are computer generated.

- Pack: a contact sheet for every beat, runs of consecutive frames around each event, and a contact sheet that crosses the loop seam. Sheets and runs are rendered at the `review` tier or higher.
- Camera: moves a real rig could make, with eased starts and stops and no jumps.
- Rain: fall speed, streak length and angle agree from frame to frame. Gusts are gradual.
- Water: splash timing, ring growth, bead motion and run-off look physical.
- Events: lamp stages, engine start, shimmer, steam and vibration happen in a believable order at a believable speed.
- Stability: no popping, flicker, crawling noise or shimmer in fine patterns.
- Loop: the seam cannot be found.
- Score 10 when nothing about the motion gives the film away.

### C5 blockout · Motion, Phase 2 only

You are told the images are a gray-box blockout with no materials, weather or lighting.

- Pack: a contact sheet for every beat and one that crosses the loop seam.
- Judge only the camera, the timing of each beat and the loop.
- Camera: moves a real rig could make, with eased starts and stops and no jumps.
- Timing: each beat has room for what `kit/01-FILM.md` says happens in it.
- Loop: the camera returns to its opening position with no jump.
- The single score covers only these points. Score 10 when the camera work could be shot as it is.

### C6 · Scroll stop

You are told nothing about how the images were made.

- Pack: frame 0 and frames across the first `film.hookSeconds` seconds, each resized to `critics.phonePreviewWidthPx` wide, in both formats. Rendered at the `review` tier or higher.
- Would this stop someone scrolling a feed with the sound off?
- Is the subject readable at this size in the first frame?
- Does something change inside the first `film.hookSeconds` seconds that rewards staying?
- Score 10 when the opening is striking at phone size with no sound and no caption.

### C7 · Compression

You are told the images are computer generated.

- Pack: stills taken from the stress encode beside the same frames before encoding, with native-size crops.
- The stress encode is made by `npm run stress`, as `kit/05-ARCHITECTURE.md` describes.
- Look for banding in dark gradients, blocks in rain and haze, smeared grain, lost fine detail on paint and weave, and ringing around signs.
- Score 10 when the encoded frames still hold up at native size.

### C8 · Cinematography

You are told nothing about how the images were made.

- Pack: the judged frames, the vertical judged frames, and the contact sheets.
- Composition, lens choice, depth, lighting design and color in each beat.
- Variety from beat to beat, and whether the film builds.
- Whether each vertical frame is composed for vertical, with the subject clear of the top and bottom edges.
- If you receive only two moments and no contact sheets, judge each frame on its own and leave out variety and build.
- Score 10 when every frame could be a still from a high-end car film.

### C8 blockout · Cinematography, Phase 2 only

You are told the images are a gray-box blockout with no materials, weather or lighting.

- Pack: one frame from the start, middle and end of every beat in both formats, and the contact sheets.
- Judge only composition, lens choice, camera height and variety from beat to beat.
- Whether each vertical frame is composed for vertical.
- The single score covers only these points. Score 10 when every framing is worth lighting.

### K1 · Key frame choice, Phase 1 only

You are told the images are concept images for a film.

- `quality.blind.jurors` fresh agents, each on a different model family.
- Pack: the hero image of every direction, once resized to fit `critics.maxImageLongEdgePx` and once resized to `critics.phonePreviewWidthPx` wide, with neutral names.
- Score each direction from 1 to 10 on three questions: would it stop someone scrolling at phone size, could it be a still from a high-end car film, and could a real camera have taken it.
- Return one JSON object with a score per file name and one line of reasoning each.
- The direction with the highest mean score wins. A tie goes to the direction generated first.

## The pass bar

All of these hold at once:

1. The gate is green for the current phase.
2. C1 is valid and passes.
3. Every critic from C2 to C8 scores at least `quality.passScore`, with no severe or major issue open. The same holds for any extra critic `kit/02-VEHICLE.md` defines.
4. A confirmation round then passes 1 to 3 again: new pack, fresh critics, fresh jurors, no changes to the app in between.

`kit/08-BUILD-ORDER.md` says which critics apply in each phase.

## Rounds

- One round: build, gate, pack, critics, read every issue, fix, log.
- Each round writes `scorecards/round-NNN/`: the pack manifest, the key, each critic's JSON, the jurors' answers, and `SUMMARY.md` with the scores, the top issues and what changes next. Text files only. No images.
- `kit/PROGRESS.md` gets one line per round.
- Scorecards are committed every round. `out/stills/` and `out/preview.mp4` are updated with `npm run keep` and committed only at a phase gate.
- There is no limit on the number of rounds.
- Fix causes, not symptoms. If a critic names an artifact, find what produces it.
- Never tune the picture to please one critic at the cost of another. Check the whole roster after every fix.

## The plateau rule

- If a critic's number has not improved over `quality.plateauRounds` rounds in a row, change technique. Move to the next rung for that critic in the ladder in `kit/04-LOOK.md` and log which rung.
- Never lower a threshold. Never shrink the judged list. Never drop a critic. Never reword a rubric or the jury text. Never choose controls because they look less like photographs.
- It becomes a blocker only when every rung for that critic has been tried. Then stop, as `AGENTS.md` describes.
