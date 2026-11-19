# Progress

The Builder's memory. Read this first in every task. Update it before every commit.

## Status

- Current phase: 2 · Blockout in motion
- Current round: 2 (Phase 2 blockout)
- Blocked: no
- Last push: see the push log, 2026-11-19

## Phases

| Phase | State | Gate evidence | Commit |
| --- | --- | --- | --- |
| 0 · Ground truth | done | Push c74357a and 97ddecb succeeded. `npm run gate -- --phase 0` on build 33fa88298cbaea4f: G1 PASS (build clean), G2 PASS (29 tests), G3 PASS (5 frames identical across fresh loads and reverse order, frame 195 identical when chunked across 3 page loads), G4 PASS (3 stills match their formats, frameCount 1350). Workspace record, pinned versions and render budget are below | see push log |
| 1 · Reference and key frames | done | `npm run gate -- --phase 1`: G1 PASS, G2 PASS, R1 PASS (`reference/BOARD.md`: 13 elements, 150 sources, every element at or above `reference.minSourcesPerElement` and every source at or above `reference.minObservationsPerSource`), R2 PASS (55 vetted controls kept, the pool needs 30, every kept id is on the board), R3 PASS (3 directions, 8 beat key frames, K1 scores logged below), R4 PASS (`cut/SHOTS.md` has a row for every beat in both formats), G12 PASS, G13 PASS | see push log |
| 2 · Blockout in motion | in progress | | |
| 3 · Look lock | not started | | |
| 4 · Full build | not started | | |
| 5 · Capture and cut | not started | | |

## Workspace record

Measured 2026-11-19 in the Builder's VM.

- OS: Ubuntu 26.04.1 LTS, kernel 6.1.155. 2 cores, 7.8 GB RAM, 20 GB disk (13 GB free at the start).
- Node v20.20.2, npm 10.8.2, Python 3.14.8 (numpy, opencv, pillow). ffmpeg 8.0.1 with libx264 and ffprobe both run.
- Browser: Chrome for Testing 147.0.7727.15, the playwright build chromium-1217 (full and headless shell) in `~/.cache/ms-playwright`. Driver: playwright 1.59.0, the release that matches that build.
- Launch flags for software WebGL: `--use-angle=swiftshader --enable-unsafe-swiftshader --ignore-gpu-blocklist`.
- WebGL2 renderer string: ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (Subzero) (0x0000C0DE)), SwiftShader driver).
- WebGL2 limits: MAX_TEXTURE_SIZE 8192, MAX_3D_TEXTURE_SIZE 2048, MAX_CUBE_MAP_TEXTURE_SIZE 16384, MAX_ARRAY_TEXTURE_LAYERS 2048, MAX_RENDERBUFFER_SIZE 8192, MAX_DRAW_BUFFERS 6, MAX_COLOR_ATTACHMENTS 6, MAX_SAMPLES 4, MAX_TEXTURE_IMAGE_UNITS 32 (vertex 32, combined 64), MAX_VERTEX_ATTRIBS 16, MAX_VERTEX_UNIFORM_VECTORS 4096, MAX_FRAGMENT_UNIFORM_VECTORS 4096, MAX_VARYING_VECTORS 31, uniform buffer bindings 72, MAX_UNIFORM_BLOCK_SIZE 65536, MAX_VIEWPORT_DIMS 8192 x 8192, max anisotropy 16.
- WebGL2 extensions: EXT_clip_control, EXT_color_buffer_float, EXT_color_buffer_half_float, EXT_conservative_depth, EXT_depth_clamp, EXT_disjoint_timer_query_webgl2, EXT_float_blend, EXT_polygon_offset_clamp, EXT_texture_compression_bptc, EXT_texture_compression_rgtc, EXT_texture_filter_anisotropic, EXT_texture_mirror_clamp_to_edge, NV_shader_noperspective_interpolation, OES_draw_buffers_indexed, OES_sample_variables, OES_shader_multisample_interpolation, OES_texture_float_linear, OVR_multiview2, WEBGL_clip_cull_distance, WEBGL_compressed_texture_astc, WEBGL_compressed_texture_etc, WEBGL_compressed_texture_etc1, WEBGL_compressed_texture_s3tc, WEBGL_compressed_texture_s3tc_srgb, WEBGL_debug_renderer_info, WEBGL_debug_shaders, WEBGL_lose_context, WEBGL_multi_draw, WEBGL_polygon_mode, WEBGL_stencil_texturing. The machine-readable copy is `config/webgl-caps.json`, written by `tools/caps.ts`.
- Detached process test: a process started with `(set -m; cmd >log 2>&1 &)` outlived the scripted step that started it. Long renders may run detached with a polled log.
- Encoder support: `VideoEncoder` is undefined on about:blank (an insecure context). On the harness page at http://127.0.0.1 it exists, and `VideoEncoder.isConfigSupported` returns true at 1920 x 1080, 30 fps, 20 Mbps for h264 (high 4.2, main 4.0, baseline 4.0), vp9, vp8 and av1. So the browser reports that it can encode `export.videoCodec`. The end to end proof is `npm run proof` in Phase 2.
- Supporting agents: a default spawn shares the Builder's VM (same boot id), so `sandbox.maxRenderProcesses` covers the Builder and every default agent together. A spawn with sandbox isolation gets its own VM: 4 cores, 7.9 GB RAM, 25 GB disk, the same Node, ffmpeg and chromium-1217, and it can clone and push to the repo. The limit applies per VM, so sandbox agents can render in parallel with the Builder. Only the Builder can spawn agents.
- Agent attachments arrive under `/home/user/.perplexity/attachments/<id>/`, at most 10 per message.
- Image limit: landscape and portrait test cards with numbered marks arrive downscaled to a 1430 px long edge. A 1400 px long edge arrives at native size. `critics.maxImageLongEdgePx` stays as it is. Every family tested read 7 px text at 1400 px.
- Agent model families with image input verified: Claude, GPT, GLM, Kimi, Grok. Gemini answered later and also reads the test cards (down to 7 or 8 px text), so six families are verified. One listed id (deepseek) is not available.
- Image tools the Builder can call: `generate_image` (several image models, aspect ratios 1:1, 3:4, 4:3, 9:16, 16:9, reference images), `search_images`, `fetch_image`. App hosting: `deploy_website` and `publish_website`. The text-only `llm` tool cannot see images, so jurors and critics are spawned agents.

## Pinned versions

| Package | Version | Verified from |
| --- | --- | --- |
| three | 0.187.0 | npm registry and the three.js releases page, 2026-11-19 |
| gsap | 3.15.1 | npm registry, 2026-11-19 |
| mediabunny | 1.66.2 | npm registry, 2026-11-19. mp4-muxer is deprecated in its favor |
| vite | 8.3.8 | npm registry, 2026-11-19 |
| typescript | 7.0.2 | npm registry, 2026-11-19 |
| vitest | 4.1.12 | npm registry, 2026-11-19. 5.x needs Node 22 |
| playwright | 1.59.0 | matches the installed chromium-1217. The latest, 1.65.1, would need a browser download |
| @types/three | 0.187.0 | npm registry, 2026-11-19 |
| @types/node | 20.19.43 | npm registry, 2026-11-19 |
| sharp | 0.35.5 | npm registry, 2026-11-19 |
| tsx | 4.23.15 | npm registry, 2026-11-19 |

## Render budget

| Format | Tier | Seconds per sample | One still | Whole film |
| --- | --- | --- | --- | --- |
| 16x9 (1920 x 1080) | draft | 2.53 | 6 s | 1.1 h |
| 16x9 | review | 2.53 | 21 s | 7.7 h |
| 16x9 | final | 2.53 | 2.1 min | 45.6 h |
| 9x16 (1068 x 1900) | draft | 2.47 | 5 s | 1.0 h |
| 9x16 | review | 2.47 | 20 s | 7.5 h |
| 9x16 | final | 2.47 | 2.0 min | 44.5 h |
| preview (960 x 540) | draft | 1.68 | 4 s | 0.7 h |
| preview | review | 1.68 | 14 s | 5.1 h |
| preview | final | 1.68 | 1.4 min | 30.2 h |

Measured 2026-11-19 with `tools/measure.ts` on the Phase 0 spike (24 torus knots, 307,200 triangles, clearcoat physical materials, one planar reflection at 1920 x 1080, one 2048 shadow map), build 348324d8139768f7, in the Builder's VM while ten research agents shared its 2 cores (load average 2.6). These are spike numbers. The table is measured again on the real scene at the start of Phases 2, 3 and 4, and the preview tier is chosen from the newest table.

Fixed cost of starting a chunk: browser launch 0.3 s, page load to `ready` 0.3 to 0.8 s, first sample (shader compile) 2 to 3 s more than a steady sample. No simulation replay yet, because every animated system so far is closed form. Saving the running sum: 4.6 s at 16x9, 4.2 s at 9x16, 1.2 s at preview. Loading it: 0.2 s. Finish, read back and write the PNG: 0.3 s.

Note on timing: WebGL calls return before the software rasterizer finishes. `addSamples` now reads one pixel of the running sum before it returns, so its time is the true render time. Without that, a sample looked like 0.01 s and the whole cost landed on the next read.

Preview film tier on these numbers: `review` (5.1 h fits in `sandbox.previewFilmMaxHours`, `final` does not).

Chunking strategy:

- A detached process outlives a scripted step (step 4), so long renders run detached with `--budget 0` and a log file that is polled.
- Every render command is still resumable. `still` saves the running sum to `out/work/sums/` every two minutes and when its time budget runs out, then exits with code 75 and a CONTINUE line. Run again, it loads the sum and carries on at the next sample index. The default budget is `sandbox.chunkBudgetMinutes`.
- `film` (Phase 2) skips frames whose record matches the current build, so it can be stopped and restarted at any frame.
- A lock file under `out/work/` keeps the Builder's VM to `sandbox.maxRenderProcesses` render process. Agents in their own sandbox VM (4 cores) each have their own slot, so judged stills and film ranges can be rendered in parallel across VMs and returned as attachments.

## Control pool

Vetted 2026-11-19. The ledger is `reference/controls.json` (URLs, licenses and scores, no images). The images stay in `reference/cache/controls/`, which git ignores. `npx tsx tools/controls.ts restore` downloads again any image the cache has lost.

- Size: 57 kept of 60 candidates. 1 dropped. 2 candidates still wait on a late juror and stay out of the pool until their third vote arrives.
- Mean vetting score: 92.5 (the mean of the kept medians). A control is kept when the median of its three juror likelihoods is at least `quality.blind.minControlMean`.
- How it was vetted: each candidate was prepared the way a judged frame is (centre crop to the master aspect, critic size, PNG, no metadata) and sent alone, with the C1 text, to three fresh jurors on three model families. Two families are fixed and the third rotates among four more.
- Kept by kind: paint with water 8, front wheel 6, lit lamp 6, fine detail 5, rear and exhaust 5, wet supercar at night 9, empty deck at night 5, low wide single car in rain 6, rear with taillights in the wet 5.
- Dropped: `kb116048e`. One juror reported a driver behind the side glass, and the pool holds no people.
- Rule kept from here on: a control whose jurors mention a person, a watermark or a caption is excluded by hand with `npx tsx tools/controls.ts exclude <id> <why>`.

## Key frames

- K1 scores, 2026-11-19, three jurors on three model families, six scores per cell (three questions at two sizes). Scorecards are in `scorecards/k1/`.

| Juror | Direction A | Direction B | Direction C |
| --- | --- | --- | --- |
| reviewer_k01 | 6.17 | 4.83 | 6.67 |
| reviewer_k02 | 8.33 | 8.00 | 7.67 |
| reviewer_k03 | 5.83 | 7.17 | 7.00 |
| Mean | 6.778 | 6.667 | 7.111 |

- Chosen: direction C. Cold blue with one red accent, 24 mm and very low, headlamp beams and haze as the main event, a long puddle in the foreground.
- One key frame per beat in that direction is in `reference/keyframes/`, with every prompt in `PROMPTS.md`. Four of them (arrival, wheel, ignition, return) were made again because the first takes carried a real maker name on a skyline sign or on the brake caliper.
- What the jurors named, carried into the build as things to avoid: garbled or repeated sign text, out of focus highlights spaced evenly, a black body that recedes at phone size, sign color so saturated that it reads as a game.
- The key frames are targets for composition, palette and mood only. They are never used as textures, backgrounds or frames.

## Judged frames

| Frame index | Seconds | Beat | Why this moment | Vertical too |
| --- | --- | --- | --- | --- |
| 0 | 0.00 | `arrival` | Poster frame. The dark vehicle, the whole city, the long puddle | yes |
| 60 | 2.00 | `arrival` | End of the hook. The billboard wash is half way across the deck and the gust has lifted the backlit rain | no |
| 150 | 5.00 | `wake` | Lamp stage 1. Only the thin running lights are up, so the dark body has to hold on its own | no |
| 195 | 6.50 | `wake` | Hero frame. Running lights full, main beams half way up, beams in rain and haze | yes |
| 240 | 8.00 | `wake` | Settled hero framing. Main beams full, the deck lit in front of the nose, lamp reflections in the puddle | no |
| 300 | 10.00 | `paint` | Beads at rest on the hood, the wing crest as horizon, city bokeh above | no |
| 360 | 12.00 | `paint` | Macro frame. The rivulet has just broken loose and is running | yes |
| 420 | 14.00 | `paint` | The rivulet trail and merged beads, sign reflections bent over the crest | no |
| 486 | 16.20 | `wheel` | First drip leaves the arch lip. Rim, disc, caliper and tread at rest | no |
| 537 | 17.90 | `wheel` | A drip in the air with focus pulled to the arch lip | yes |
| 590 | 19.67 | `wheel` | Hub centered, the rim mirrored in the wet deck | no |
| 615 | 20.50 | `lamp` | Beads and short rivulets on the outer lens in focus, the light behind them | no |
| 690 | 23.00 | `lamp` | Focus pulled through the lens to the projector modules | yes |
| 740 | 24.67 | `lamp` | Closest framing. Bezels, ribbed guides and halation fill the frame | no |
| 765 | 25.50 | `detail` | Edge of the bay: cooling fins, mesh strip, raking light | no |
| 810 | 27.00 | `detail` | Mesh with drops in its cells beside the carbon bracing, the finest repeating pattern in the film | yes |
| 860 | 28.67 | `detail` | Center of the bay. Weave on both braces at the closest distance | no |
| 902 | 30.07 | `ignition` | Engine fires. Tail lamps flare and the body shakes once | no |
| 930 | 31.00 | `ignition` | Beads shaking loose, shimmer building, first pulse ripples in the puddle | no |
| 990 | 33.00 | `ignition` | Shimmer and steam fully developed at the outlets | yes |
| 1060 | 35.33 | `ignition` | End of the arc. Both tail lamps, steam risen into the upper frame | no |
| 1125 | 37.50 | `return` | Engine just off, pull back starting, steam thinning | no |
| 1170 | 39.00 | `return` | Main beams half way down, running lights still on | yes |
| 1215 | 40.50 | `return` | Last faint glow of the running lights, a wisp of steam left | no |
| 1340 | 44.67 | `return` | Ten frames before the seam. Has to match the poster frame in everything but rain phase | no |

Written 2026-11-19 in Phase 2. 25 frames, 8 of them also in the vertical format. The control pool holds 57, more than one control per judged image including the native-size crops. Frames can be added. None is removed.

## Look lock

Filled in Phase 3: tone map, exposure, grade, palette, sample counts, reflection setup, paint.

## Decisions made by the Builder

| Date | Decision | Why | What it changes |
| --- | --- | --- | --- |
| 2026-11-19 | The vehicle is the Lamborghini Revuelto, built debadged: no logos, crests or wordmarks anywhere on it | `AGENTS.md` bans real brands, logos and trademarks on signage, props and interface. The shape carries the identity | `src/vehicle/` models the car without badge geometry or decals |
| 2026-11-19 | A third-party car model is used only if it is CC0 or CC-BY, original work and not extracted from a game. Otherwise the car is built procedurally from reference | `AGENTS.md` third-party rules | Phase 1 asset shortlist, Phase 3 vehicle build |
| 2026-11-19 | playwright 1.59.0, vitest 4.1.12, mediabunny as the MP4 muxer | They match the installed browser and Node 20. The older muxer is deprecated | `package.json` |
| 2026-11-19 | Critics and jurors run as fresh agents in their own sandbox VM and receive attachments only, with neutral names | `AGENTS.md` and `kit/07-QUALITY-BAR.md`. A separate VM cannot read this repo's working tree | Every round |
| 2026-11-19 | Development agents each own one folder, work in their own sandbox VM and push a branch. The Builder merges and verifies through the harness | One owner per folder. Separate VMs do not compete for the render slot | Phases 2 to 4 |
| 2026-11-19 | Phase 1 reference research may start while Phase 0 scaffolding finishes. Gates are still evaluated in order | Research does not depend on the scaffold | Schedule only |
| 2026-11-19 | The detail beat shows the exposed engine bay under the rear deck: the carbon twill bracing and the hexagonal mesh | It is the most particular close detail the car has, and reference for both materials is on the board | `anchors.detail`, the detail row in `cut/SHOTS.md` |
| 2026-11-19 | The car is built procedurally in code from the design grant drawings and photographs. No third-party car mesh is used | No mesh found had a license that passes the rule above. Idea kept in reserve: build the body in a scripted modeling tool from the drawings and export it, if the code route cannot reach the silhouette | `src/vehicle/`, Phase 3 |
| 2026-11-19 | The lamp wake sequence is the Builder's own design in three stages | Research found no welcome light animation on the real car | `lamps` stage thresholds, the event timeline in `cut/SHOTS.md` |
| 2026-11-19 | World layout and gate conventions are fixed in `cut/SHOTS.md`: meters, Y up, car at the origin facing +Z, bay grid turned 12 degrees against the car, focal length measured across the long side of a 36 mm gate in both formats | One written source for the world, vehicle and director folders | Phases 2 to 4 |
| 2026-11-19 | Jurors are spawned in bulk from a script, one fresh agent per image. The third juror family rotates. Tickets, answers and the family of each juror are kept in a ledger under `out/work/jury/` | 180 one-image calls cannot be made by hand, and rotation keeps one slow family from holding the pool | `tools/lib/jury.ts`, `tools/controls.ts` |
| 2026-11-19 | Only the third-party files the blockout and look lock need are copied in now (3 texture sets, 3 fonts). The rest are a shortlist in `ASSETS.md` | Keeps the repo small until a file is used | `public/assets/third-party/`, `ASSETS.md` |
| 2026-11-19 | The Phase 1 gate is checked by the harness as R1 to R4 | The build order lists four Phase 1 conditions that had no G number | `tools/gate.ts` |
| 2026-11-19 | The shot is chosen by the frame's own time, and the camera is then evaluated at each sample's time | With a centered shutter the first frame of a beat mixed two shots in one exposure. A real camera never exposes across a cut | `src/director/shots.ts`, `src/core/film-stage.ts` |
| 2026-11-19 | The vehicle and world factories are async, and the page's `ready` resolves after both | Either may load a file. No frame may depend on what has loaded so far | `src/vehicle/index.ts`, `src/world/index.ts`, `src/main.ts` |
| 2026-11-19 | Two development agents on two model families build the vehicle module on separate branches. The Builder merges the one that matches the design grant drawings best | The procedural car is the largest risk in the build. Both are measured the same way: silhouette overlap with the drawings in four views | `src/vehicle/`, Phase 2 and Phase 3 |
| 2026-11-19 | Camera speed is eased with `glide`: progress is the integral of a speed that ramps up, holds and ramps down. Lamp and engine ramps use GSAP eases | A dolly holds a steady speed between its ramps. A single S curve over a long move never holds a speed | `src/director/rig.ts` |
| 2026-11-19 | The render seams of Phase 3 are written during Phase 2: `src/core/contract.ts` (scene units, `FilmLight`, `SceneSystem`, `SamplePass`), `src/core/lights.ts`, `src/materials/patch.ts`, `src/weather/` split into `air` and `surface`, and `src/PIPELINE.md` | The look, the weather and the post stage can then be built by separate agents while the blockout is judged. The film still renders as a gray box: `stageDetail` stays `blockout` | `src/PIPELINE.md` |
| 2026-11-19 | Scene units: radiance 1.0 is 100 cd/m2, a light's intensity is candela divided by 100. Exposure is set once in the post stage | Sources keep their real ratios (a headlamp against a wet deck), which is what makes highlights clip and bloom like a night photograph | `src/core/contract.ts` |
| 2026-11-19 | An area light is one shadowed spot moved to a new point of its emitter on every sample | Soft shadows and wide highlights come from the same accumulation that gives motion blur and depth of field, with no extra pass | `src/core/lights.ts` |
| 2026-11-19 | The rig holds 16 lights: 8 from the world, 4 beams, and the other lamps merged into one point light per corner of the vehicle | Per-fragment cost grows with every light in software rendering. A lamp may still be built from many lit parts | `src/core/film-stage.ts` |
| 2026-11-19 | A lit stand-in world (`src/world/standin.ts`) serves `detail=full` until the real world lands. `?detail=full` or `SHOWCASE_DETAIL=full` selects it | The pipeline, post and weather agents need lights, a deck and distant sources to work against | `src/world/standin.ts` |
| 2026-11-19 | Animation is closed form wherever possible. The running sum is saved as raw Float32 through the harness endpoint | Determinism and resumable chunks | `src/core/`, `tools/lib/` |
| 2026-11-19 | Three development agents on two model families now build the vehicle module (A, B, C). B is on main as the interim car. The one kept is chosen by silhouette overlap with the grant drawings in four views and by stills at 195, 360, 520, 690, 800 and 950 | The first plan named two. A third lowers the risk on the largest unknown | `src/vehicle/`, Phase 3 |
| 2026-11-19 | Every shot was framed again on the gray-box car with `tools/look.ts`. The paint macro sits over the front hood looking rearward and outboard toward the left wing crest (100 mm, 0.56 to 0.81 m). The establishing shot is 26 degrees off the nose, 7.2 to 5.2 m. The wheel shot shows the whole wheel from 4.4 m at 85 mm. The rear shot is 4.6 to 4.1 m | The first positions were written before a car existed. Several put the lens inside the body or lost the horizon | `src/director/shots.ts`, `cut/SHOTS.md` |
| 2026-11-19 | The opening push reaches full speed in 1.2 s | On the gray box the frames inside `film.hookSeconds` were nearly identical. The hook needs motion that shows at phone size | `push()` in `src/director/shots.ts` |
| 2026-11-19 | Control photographs that show a maker's badge stay in the pool | Controls are not chosen for how they read. Removing them would make the blind test easier for the render, not harder | `reference/controls.json` |
| 2026-11-19 | The lowest frame PSNR that G9 accepts for the proof export against the harness frames is 30 dB, a constant in `tools/lib/gates.ts` | The kit names the check but not the number. 30 dB at 20 Mbps separates a correct encode from a wrong frame | `tools/lib/gates.ts` |
| 2026-11-19 | The film camera also sees a camera-only layer (`layers.cameraOnly`). Reflection and shadow cameras do not | Near rain, lens drops and haze cards must not appear in captures | `src/core/contract.ts`, `src/core/film-stage.ts` |
| 2026-11-19 | `stageDetail` stays `blockout` through the Phase 2 gate. `?detail=full` or `SHOWCASE_DETAIL=full` shows the lit film. Every render record carries the detail level | The blockout critics judge the gray box while Phase 3 systems are merged behind the switch | `src/core/detail.ts` |
| 2026-11-19 | Vehicle B is the car. Vehicle A was stopped and its builder became a standing independent auditor of the car (matched-angle photographs, drawing overlays, line match in millimeters, a score from 1 to 10 per view). Vehicle C was stopped | B had the right size and silhouette. A and C did not beat it. An auditor who did not build the car scores it harder than its builder | `src/vehicle/`, Phase 3 |
| 2026-11-19 | A second car (D) is being built by a different method, in a scripted modeling tool with a mesh export, on its own branch under the same contract | The auditor scores B between 3 and 6 per view against a bar of 8. A second method lowers the risk that the code route cannot reach the form | `dev/vehicle-d`, `tools/vehicle/d/`, Phase 3 |
| 2026-11-19 | The post stage was given to a second agent after the first did not deliver in time. Its branch is the one merged. Tone curve NightNegative chosen over two other candidates | The first branch arrived after the second had been verified and merged | `src/post/` |
| 2026-11-19 | Critics C5 and C8 receive the beat lines of `kit/01-FILM.md` and the rule on cuts with the brief, and every sheet caption states whether its beat begins with a cut or continues a move, computed from the camera data | The rubric refers to the beats and to cuts. In round 1 the motion critic could not tell a planned cut from a jump | `tools/pack.ts`, `tools/lib/scene.ts` |
| 2026-11-19 | The `return` beat cuts to a high crane view of the lit car, then comes down and back into the opening frame. The wake push travels 2.6 m. The paint beat looks along the left wing crest toward the door mirror. The wheel beat is a 35 mm low three-quarter arc. The detail beat holds the crossed braces from its first frame. The tall shots are each set up again | Critic round 1: C5 6, C8 5. See `scorecards/round-001/SUMMARY.md` | `src/director/shots.ts`, `cut/SHOTS.md` |
| 2026-11-19 | Phase 2 contact sheets are rendered in the preview format | The sheets are downsized to `critics.longEdgePx` anyway. The round 1 pack took an hour on two cores | `tools/pack.ts` |

## Config changes

| Date | Key | From | To | Why |
| --- | --- | --- | --- | --- |
| 2026-11-19 | `signage.invented` | QUIET HOURS CLUB | SHUTTER HUSH CLUB | A web search found an existing business with the first name |
| 2026-11-19 | `signage.invented` | NINTH CLOUD HOTEL | VAPOR SILL HOTEL | A web search found an existing business with the first name |
| 2026-11-19 | `signage.invented` | SILVERFIN SUSHI | BRINESCALE SUSHI | A web search found an existing business with the first name |

## Rounds

| Round | Phase | Gate | C1 render against control | C2 | C3 | C4 | C5 | C6 | C7 | C8 | Top issue | What changed next |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | 2 | blockout | n/a | n/a | n/a | n/a | 6 | n/a | n/a | 5 | C8 severe: the paint beat is a bare hood curve with no line and no background | Every shot reframed, crane return, tall shots set up again, cut captions |

## Plateau log

| Critic | Rounds without gain | Rung tried | Result |
| --- | --- | --- | --- |

## QA gauntlet

| No. | Result | Evidence |
| --- | --- | --- |

## Push log

| Date | Commit | Result |
| --- | --- | --- |
| 2026-11-19 | c74357a | pushed to main. Fills `kit/02-VEHICLE.md` from the task prompt |
| 2026-11-19 | 97ddecb | pushed to main. Phase 0 scaffold, workspace record, pinned versions |
| 2026-11-19 | 569ad5b | pushed to main. Phase 0 gate |
| 2026-11-19 | the commit titled "Phase 1 gate" | pushed to main. Board, control pool, key frames, shot plan, asset ledger |
| 2026-11-19 | 7490a1e, c561aa9, 34f9dd5 | pushed to main. Phase 2 and Phase 3 seams, fixes |
| 2026-11-19 | 154b0ee | pushed to main. Camera-only layer, look tool |
| 2026-11-19 | 5dae634 | pushed to main. Shots tuned on the gray-box car |
| 2026-11-19 | 94c116b | pushed to main. Merges of modes, world, vehicle B, light, air. Wheel shot |
| 2026-11-19 | bdcc79d | pushed to main. Merge of the harness tools, judged frame list, page anchors |
| 2026-11-19 | 286ee3d | pushed to main. Progress |
| 2026-11-19 | 2a71642 | pushed to main. Merges of the tools detail flag, world lighting, reflections, surface water, vehicle B step 8, bokeh |
| 2026-11-19 | 6ee5cc7 | pushed to main. Merge of the post stage |
| 2026-11-19 | the commit titled "Round 1 scorecards and the round 2 shot plan" | pushed to main. Round 1 scorecards, new shots, vehicle B pass 2 steps 1 to 3, tools for split packs and film parts |

## Session log

Newest first. One entry per working session: what was done, what was measured, what is next.

### 2026-11-19, session 6

- Done: merged world lighting (8 film lights, 3 shadowed), planar and cube reflections, surface water, bokeh, the post stage, vehicle B through pass 2 step 3, and the tools for preview sheets, cut captions, split message lists and film parts across machines. 125 unit tests pass. Critic round 1 run on the gray box: C5 6, C8 5. Every shot was reframed with probes and frames in both formats, lens clearance checked (0.12 m at the closest, the tall wheel shot above the deck). A wrap fault was found and fixed: the samples of frame 0 that fall before time 0 took the settled push position. A test now holds the first and last frame to one pose across all their samples.
- Measured: full-detail preview frame at review tier 81 to 112 s. 16x9 per sample about 11.2 s plus 3.2 to 8 s for reflections. A review preview film is about 37 hours on one machine, so film parts will be rendered on several machines and assembled with a byte compare.
- Seen: the auditor scores vehicle B front three-quarter 4, side 5, rear three-quarter 3, wheel 4, lamp 6, bay 4. The car form is the largest open risk for Phase 3.
- Next: pack round 2, fresh C5 and C8 critics from other families, repeat until both are at 9 with no severe or major issue. Then the Phase 2 gate.

### 2026-11-19, session 5

- Done: merged the modes, the full city (about 302,000 triangles, 17 signs), vehicle B stage B (394,056 triangles in the blockout, 1,125,884 at full detail. Silhouette overlap with the grant drawings: top 0.9822, side 0.9524, front 0.9747, rear 0.9741), the light, air and harness tool branches. 102 unit tests pass. Every shot framed again on the real gray-box car with `tools/look.ts`, lens clearance checked (0.19 m at the closest). Judged frame list written. `window.showcase.anchors()` added for the crop and pack tools.
- Measured at 16x9 per sample on the lit film: the stand-in world 2.8 to 2.9 s, light part plus 3.3 s, air plus 0.95 s, reflections plus 2.4 s and 7.3 s per frame for the capture, the city alone 0.6 to 1.1 s. A draft preview film of the gray box takes about 250 s.
- Seen with `detail=full`: the body is a black silhouette, the macro beats are nearly black, the billboard clips to flat white, windows are flat. Phase 3 starts from the lighting design, not from materials.
- Next: Phase 2 pack, C5 blockout and C8 blockout rounds, Phase 2 gate (film, proof, memory, keep). Then merge reflections, post and surface water and begin the look lock.

### 2026-11-19, session 4

- Done so far: the Phase 2 seams. Vehicle and world contracts with placeholder modules, the camera rig (`glide`, operator motion, `resolveShot`), a shot per beat in both formats, the event times, `FilmStage`, the `sheet` command, a camera test (loop closes, rest at the seam, no jump inside a beat, listed focal lengths only). Two late jurors recorded: the pool is 57 kept.
- Seen on the first draft sheets: the macro beats are flat gray on the placeholder car, so the blockout vehicle needs real forms before the framing can be judged. The wheel shot was too tight for its key frame and moved back to 3.4 m.
- Next: development agents for the vehicle, the gray-box world, the modes and the remaining harness commands. Then the judged frame list, C5 blockout and C8 blockout.

### 2026-11-19, session 3

- Done: Phase 1. Board of 13 elements and 150 sources assembled from four writers and link checked. Control pool vetted with 180 one-image juror calls: 55 kept, 1 dropped. Three key frame directions scored by K1, direction C chosen, eight beat key frames made. Vehicle part and lamp notes written. `ASSETS.md` started with 19 files in the repo and a shortlist. `cut/SHOTS.md` written for every beat in both formats. Three sign names replaced. Gate checks R1 to R4 added. Phase 1 gate green.
- Measured: kept control medians average 92.5. K1 means A 6.778, B 6.667, C 7.111.
- Next: Phase 2. Gray-box world, blockout vehicle module, camera rig with operator motion, the three modes and the menu, harness commands `sheet`, `crops`, `film`, `pack`, `proof`, `keep`, the judged frame list, then C5 blockout and C8 blockout.

### 2026-11-19, session 2

- Done: finished Phase 0. Harness commands `still`, `determinism`, `gate`, plus `tools/caps.ts` (writes `config/webgl-caps.json`) and `tools/measure.ts` (timing). Unit tests for config, random, timeline and sampler. Spike stage. Render budget measured. Phase 0 gate green.
- Started Phase 1 in parallel: four board writers, two vehicle researchers, three photo scouts for control candidates, one asset scout. Three key frame directions generated on three image models and sent to three K1 jurors.
- Vehicle research found the full design grant drawings (US D1,119,686 S: top, both sides, front, rear, underside) and no car mesh with a clean license. The car is built from those drawings and photographs.
- Next: finish the board, vet the control pool, choose the key frame direction, write `cut/SHOTS.md`, start `ASSETS.md`.

### 2026-11-19, session 1

- Done: vehicle file filled and pushed. Workspace, WebGL, detached process, agent VM and image limit probes. Versions pinned and installed. Core scaffold written: config, random, sampler, tiers, renderer, accumulator, lens, engine, placeholder resolver, timeline, launch parsing, frame interface, spike stage. Harness library started: build hash, records, server with the sum endpoint, browser driver, image checks.
- Next: finish `still`, `determinism`, `gate` and the caps recorder, write the unit tests, measure seconds per sample and chunk start cost, write the render budget, run G1 to G4, push the Phase 0 gate.
