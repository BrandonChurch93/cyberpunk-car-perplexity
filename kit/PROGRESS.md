# Progress

The Builder's memory. Read this first in every task. Update it before every commit.

## Status

- Current phase: 2 · Blockout in motion
- Current round: 7 was the last blockout round (addendum 001). Phase 2 gate in work on the round 8 camera draft
- Blocked: no
- Last push: see the push log, 2026-11-20

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
| 2026-11-19 | The engine bay is rebuilt after the factory photograph: two ribbed carbon cam covers, stepped carbon side panels, a carbon surround and mesh airboxes, with no bracing over the engine. The detail shot is a crane move from the rear left that copies that photograph. This replaces the earlier decision that named bracing | The real car has no braces over the engine. The first bay was built from a wrong reading of the reference | `src/vehicle/`, `anchors.detail`, the detail rows in `cut/SHOTS.md` |
| 2026-11-19 | The paint beat is a 0.30 m sideways slide with a locked head | Along the lens axis the frames of the beat were nearly the same. A sideways slide gives parallax between the crest, the pillar, the mirror and the city | `src/director/shots.ts`, `cut/SHOTS.md` |
| 2026-11-19 | Every frame of the film is tested for one camera pose across its exposure. The first round 2 pack was discarded | That pack showed a double exposure at 36.00 s: samples of the first crane frame that fall before the cut took the end pose of the move. The first fix covered only frame 0 | `push()` and `pull()` in `src/director/shots.ts`, `tests/camera.test.ts` |
| 2026-11-19 | The wheel beat is a 50 mm shot at hub height from 1.7 to 1.5 m that arcs from 48 to 68 degrees off the nose. The paint beat looks 12.5 degrees down along the crease of the left wing crest from 0.27 m above it. The crane return runs from 36.3 s to 44.0 s. The tall wides sit 30 degrees off the nose and the tall rear shot 32 to 22 degrees off the tail | Critic round 2: C5 7, C8 6. See `scorecards/round-002/SUMMARY.md` | `src/director/shots.ts`, `src/director/timeline.ts`, `cut/SHOTS.md` |
| 2026-11-19 | The gray-box sun stands on the left of the car and lower, at (16, 13, 12) | Every insert is shot on the left side, which was in shadow. The critics could not read the wheel | `grayBoxLight()` in `src/core/film-stage.ts` |
| 2026-11-19 | The tall wide shot does not have to hold the billboard in frame. The world test checks that only for the wide formats | At 30 degrees off the nose the car fills the narrow frame and the billboard lies outside it to the right. The kit asks for its light on the car and the deck, not for the panel in every frame | `tests/world.test.ts`, `cut/SHOTS.md` |
| 2026-11-19 | `src/vehicle/wheels.ts` has its own owner on branch `dev/wheel`. The scripted-model car (D) also exports its wheel alone as a candidate. The one the auditor scores higher at the wheel camera is mounted | The wheel now fills a frame for five seconds and the auditor scores it 5. One builder cannot fix the body and the wheel at once | `src/vehicle/wheels.ts`, Phase 3 |
| 2026-11-19 | The paint beat is a grazing view across the left front wing at 100 mm from 0.92 m out: the lens glides 0.28 m toward the nose and pans 15 degrees to stay on the wing crest, with the parapet as a horizon in the top fifth. The tall paint shot is set up on its own, looking down the wing from behind at 85 mm with the crest crease as a diagonal. The wheel beat is a 50 mm three-quarter that arcs 14 degrees around the whole wheel from 2.2 to 2.1 m, with the arch lip and the contact patch in frame for every drip. The tall wheel shot booms down 0.26 m. The detail beat tracks forward along the cam covers from 0.4 m above them, and the aim travels with the lens. The tall lamp shot pushes into the outer projector lens. The return opens on a raised three-quarter view from 1.25 m with the whole car in frame and lands at 44.6 s. The tall wide shot stands back at 7.6 to 6.6 m | Critic round 3: C5 10, C8 6 with six major issues. See `scorecards/round-003/SUMMARY.md` | `src/director/shots.ts`, `src/director/timeline.ts`, `cut/SHOTS.md` |
| 2026-11-19 | The paint anchor moves 0.27 m forward along the left wing to the outer face just under the crest crease, at z 1.55 | At its old place by the foot of the screen, any camera that held it also held the screen, the cowl and the mirror, which the critics rejected twice | `src/vehicle/body.ts`, `anchors.paint` |
| 2026-11-19 | Before a formal pack is rendered, draft sheets of the new shots go to two development agents for comment against the C8 brief. This is not a round and gives no score. Every formal round still uses fresh reviewers, the unchanged brief and the unchanged pass bar, and is logged | A formal pack costs 30 to 50 minutes. Three rounds have each failed on framing faults that a quick look would have caught | `out/work/look/` |
| 2026-11-19 | The closed five spoke wheel from `dev/wheel` is mounted | The auditor scores it 7 at the wheel camera in both detail levels, against 5 for the wheel before it and against the wheel of car D, which stays at the front three-quarter stage | `src/vehicle/wheels.ts` |
| 2026-11-19 | The draft sheets went to the two development agents twice. Their comments were answered in the camera data before the round 4 pack: the wide wheel shot holds the whole wheel again, the tall paint shot has a subject and a pan, the detail shots track further, the return starts further round to the side. Two minor notes are left as they are: the running light crosses the top and bottom edge in the wide lamp shot, and the car sits high in the wide wake frame | A boom down on the wide wheel shot lost the arch lip at the 17.9 s drip. The first tall paint frame had no line in it | `src/director/shots.ts`, `cut/SHOTS.md` |
| 2026-11-19 | The round 3 C5 answer of 10 with no issue is logged as given and is not treated as a pass that carries over | Every shot C8 faulted was rebuilt, so C5 has not seen the shots that go forward | `scorecards/round-003/` |
| 2026-11-19 | Plateau on C8 (5, 6, 6, 5). The rung taken is the first of the C8 rows in `kit/04-LOOK.md`: change the lens and the camera height. Every insert is shot again as a true macro: paint at 100 mm from 0.44 m above the wing looking down, wheel at 85 mm from 1.5 m with a boom down, lamp at 85 mm (wide) and 100 mm (tall) holding the whole fork and both projectors, detail at 85 mm from 0.6 m above a mesh | Three rounds without a gain. Each round the critic asked for the subject to fill the frame and each answer stayed a medium shot | `src/director/shots.ts`, `cut/SHOTS.md`, Plateau log |
| 2026-11-19 | The detail anchor moves to the center of the right-hand airbox grille, which is enlarged to 0.42 by 0.18 m of perforated hex mesh. The detail beat is a pass over that mesh | The kit asks for a fine repeating pattern. On the cam covers the pattern was a sliver beside large ribs, and the critic failed it in three rounds. The auditor notes that the factory bay has no hex plate of this size, so the grille gets a flush surround and is judged again against the reference in Phase 3 | `src/vehicle/engine-bay.ts`, `anchors.detail` |
| 2026-11-19 | The detail beat is shot at T11 | The lens looks 17 to 22 degrees off the mesh normal. At T2.8 only a band of the mesh was sharp and the critic read the frame as soft. A macro pass over a flat pattern is stopped down in practice | `src/director/shots.ts` |
| 2026-11-19 | The wheel beat booms down with the drips, from the arch lip to the contact patch. The arch lip leaves the frame after the first drip. Later drips start from the lower front of the arch | The critic asked for a macro with continuous motion and the tread in view. A macro frame cannot hold the arch lip and the contact patch at once | `src/director/shots.ts`, `src/weather/surface` |
| 2026-11-19 | The round 4 C5 answer of 9 is logged as given and is not carried over | Every insert is rebuilt, so C5 judges the new shots in round 5 | `scorecards/round-004/` |
| 2026-11-19 | Standing rule from the owner: a picture status is posted in the task thread at the end of every critic round and every time a numbered step of the current phase is finished. A status is two lines (phase, round, what is in work) and up to six current stills rendered with the harness at the review tier from the build as it stands: the hero frame, one frame from each of three other beats and one contact sheet. A status is not a round, not a question and not a reason to pause. The build carries on straight after it | The owner asked for it during round 5 of Phase 2, so the work can be watched without stopping it | Every task that continues this build. Files under `out/work/status/` |
| 2026-11-19 | Every picture status is shown inline in the task thread as one gallery of up to six stills, so the owner sees the pictures without opening or downloading a file. `python3 tools/status-gallery.py <out.json> "<image path>|<caption>" ...` packs the stills as 720 px JPEG data into one JSON file under `out/work/status/<name>/`, and the Builder shows that file with the inline visualization tool as a two column grid. Files are shared as downloads only when the owner asks for them | The owner could not view the shared files in the chat and asked for the pictures to be shown directly | Every task that continues this build. `tools/status-gallery.py` |
| 2026-11-19 | The brake lamp test checks the lamp only in frames where a detail camera holds it, and the crop test accepts other anchors beside the lamp at 20.5 s | The new detail cameras look down at the grille and do not see the lamp. The lamp shot is wider and holds the wing | `tests/vehicle.test.ts`, `tests/tools.test.ts` |
| 2026-11-19 | The wheel beat is on a small jib arm with a remote head, not a slider. It booms 0.59 m from 0.74 m to 0.15 m above the deck at up to 0.19 m per second, eased over 1.2 s at each end | A slider is held to 0.13 m per second in `cut/SHOTS.md`, which made the boom too short to carry the eye from the arch to the contact patch in the beat. A jib arm does this move in practice and its only limit on the board is the eased start and stop | `src/director/shots.ts`, `cut/SHOTS.md` |
| 2026-11-19 | `Shot` has an optional `roll` in degrees about the lens axis, fixed for a whole shot. The detail shots use it (3.2 degrees wide, 21.1 tall) so the grille lies level or stands square in the frame | The grille plane is tilted against the world axes. Without a levelled head its long edges ran as weak diagonals and the draft reviewers read the frame as texture without structure | `src/director/rig.ts`, `src/director/shots.ts`, `tools/look.ts` probes |
| 2026-11-19 | The lamp shots hold the whole Y-shaped running light with both projectors and nothing wider. Wide: 85 mm from 1.9 m, sliding 32 to 43 degrees round the lamp at lamp height. Tall: 100 mm from 1.3 m, 17 degrees above, with the upper arm as the spine of the frame. No tire in either | The draft reviewers found a slice of tire and a severed lower arm in the wide lamp frame and a blank strip of hood in the tall one | `src/director/shots.ts` |
| 2026-11-19 | The detail pass is levelled on the grille. Wide: a side view across the car with the grille as a level band, forward corner in at the start and aft corner in at the end. Tall: from aft and above with the grille as an upright runway, forward bar at the top at the start and aft bar at the bottom at the end | A pattern with no edge in frame gave no sense of travel. A corner entering and a corner leaving make the pass readable | `src/director/shots.ts` |
| 2026-11-19 | The round 5 draft sheets went to the same two development agents once more before the formal pack. Their severe and major notes (tire slice and cut arm on the wide lamp, tall wheel wedged in the frame, blank hood on the tall lamp, arch void on the tall paint, bezel slivers on the detail, tangent at the arch crown on the wide wheel) were answered in the camera data. No score was taken | Same reason as the earlier draft reviews: a formal pack costs about 50 minutes | `out/work/look/` |
| 2026-11-19 | Round 6 shot plan. The wide paint glide is 0.26 m with a locked head, so the vent slot on the wing top enters at 12 s and crosses to the left third while the valley beside the bonnet comes in above. The tall paint shot has its own oblique path with the crest crease as a diagonal through the middle. The lamp slides close on the lens (2.08 to 1.75 m wide, 1.48 to 1.20 m tall). The wheel jib moves over the whole beat with a 2.2 s start, 1.55 to 1.6 m out, so the arch lip holds to about 17.6 s. The detail start is eased over 1.5 s. The tall push starts at 8.9 m, ends at 5.95 m and eases its aim onto the nose and the near lamp. The tall rear shot arcs from 42 to 32 degrees off the tail at 4.9 to 4.3 m. The crane lands on the last frame (`events.pullEnd` is the film end) with a 1.3 s stop, and the push starts over 1.15 s | Critic round 5: C5 8, C8 8 with one major issue. See `scorecards/round-005/SUMMARY.md` | `src/director/shots.ts`, `src/director/timeline.ts`, `cut/SHOTS.md` |
| 2026-11-19 | The easing rule in `cut/SHOTS.md` reads: each end takes at least 15 percent of the move, the dolly and the crane keep each end to 25 percent or less, and the sliders and the jib may take longer over a start that follows a cut | The round 5 motion critic read a 25 percent start on the detail slider as abrupt and the wheel boom as leaving the arch too soon. A longer ease is always within what the rig can do. The board gives 15 to 25 percent as a working figure, not a limit of the hardware | `cut/SHOTS.md` |
| 2026-11-20 | The scripted-model car (D) is stopped and stays unmerged on `dev/vehicle-d`. The film stays on vehicle B | The auditor scores the last D build 4 to 7 per view against 7 to 8 for B at the same cameras, and B is ahead on every view | `src/vehicle/` stays with the owner of B. One fewer development agent |
| 2026-11-20 | Round 7 shot plan. The lamp beat is a dolly push into the larger projector lens: wide 1.66 m from 2.08 m to 0.43 m while coming round from 36 to 48 degrees, tall 0.79 m from 1.48 m to 0.62 m. The lamp anchor is the projector, so the lens fills a third of the frame at the end. The opening track is laid diagonally across the nose: wide from 40 degrees at 6.6 m to 26 degrees at 4.6 m, tall from 40 degrees at 7.2 m to 30 degrees at 5.95 m, and the crane returns to those openings. A wheel stop is placed on the near deck inside both opening frames. The detail pass looks along the grille 60 to 62 degrees off its normal with the edge of the panel and the bay behind it in frame, and the head roll is no longer used. The wide paint glide starts with the vent slot at the frame edge. The wide ignition head tilts down so the deck behind the tail fills the lower third. The tall return cut aims further toward the nose | Round 6: C8 7 with two major issues (the lamp never goes macro, the opening has no parallax and an empty near deck) and six minor. `kit/01-FILM.md` asks for a macro into a lit lamp | `src/director/shots.ts`, `cut/SHOTS.md`, the world deck props, the wheel clocking |
| 2026-11-20 | The lamp move is classed as a dolly, with the dolly limits | A push of 0.8 to 1.7 m in five seconds is beyond a slider at 0.13 m per second. A short dolly track at 0.24 to 0.50 m per second is the real rig for it | `cut/SHOTS.md` conventions and checks |
| 2026-11-20 | The opening of the wide format is 40 degrees off the nose with the vehicle left of center, and the aim pans to right of center during the push | At 44 degrees with the vehicle centered the billboard left the opening frame, which the world test and the kit do not allow. At 40 degrees with the vehicle at the left the billboard stands at the right of the frame as its counterweight | `openAngle`, `screen` on the wide establishing shot and the crane |
| 2026-11-20 | The loop test compares the camera rotation at 0 and at the film length component by component to 1e-12, and the operator motion takes its phase from the time as a fraction of the film | The angle between two equal rotations comes out near 3e-8 when their length is one bit short of 1, so the old check failed on equal values. The new check is tighter | `tests/camera.test.ts`, `src/director/rig.ts` |
| 2026-11-20 | The round 7 C5 answer of 10 is logged as given and is not carried over | The wheel, the tall ignition, the lamp end and the tall detail are shot again, so C5 judges them in round 8 | `scorecards/round-007/` |
| 2026-11-20 | Before the round 8 pack, draft sheets of every beat in both formats go to three draft readers on three model families (`draft_reader_a`, `_b`, `_c`, fresh agents that see only the sheets) for a list of framing faults, with the frame edges, tangents and balance named as the things to look for. This is not a round, gives no score, and the readers are not used as critics afterwards | Three rounds in a row a fresh C8 reviewer faulted shots the reviewer before had passed. A wider informal read before the pack finds those faults at the cost of minutes, not of a round | Round 8 preparation |
| 2026-11-20 | Round 8 shot plan from the round 7 scorecard and the draft readers. Master opening runs from 15 to 26 degrees off the nose (was 40 to 26) from 6.2 m. Master wheel is a jib arc at 2.5 m from 34 to 48 degrees with the arch lip, the hub and the caliper in frame and one cut of the tire at the lower border. Master lamp push ends 0.32 m from one projector with nothing else in frame. Tall detail looks down into the mesh from 0.42 m so cells fill the frame. Both ignition orbits stop at 31 degrees off the tail, the tall one on 24 mm with the whole vehicle inside the frame and the head tilted down. Paint glides are shorter so the vent slot is whole in frame from the cut to the end. Tall lamp end holds one projector whole. Tall wake and tall return have wider side margins. Master return starts at 48 degrees and 5.3 m | Round 7 C8 named the tall ignition crop and the tight, right-heavy wide wheel as major and the lamp end, the tall detail and the opening as minor. Two draft readers out of two who answered named the wide wheel crop, the tall detail margins, the left-heavy opening, the square end of the ignition orbits, the cut vent slot and the clipped second projector. At 15 degrees the vehicle needs no lead room, the billboard stays in frame and the push gains 11 degrees of swing | `src/director/shots.ts`, `cut/SHOTS.md` |
| 2026-11-20 | Draft reader notes that were not taken in the second draft: a whole-wheel framing in the master (taken later, see the third draft row), a change to the tall wheel boom, a change to the master detail pass, a different tall opening, and a different mid-push lamp frame | Round 4 C8 scored a whole-wheel framing as severe (medium, not macro). Three formal C8 reviewers passed the tall wheel, two passed the master detail, and none faulted the tall tower opening or the middle of the lamp push. A formal answer outranks a draft read | Round 8 preparation |
| 2026-11-20 | The third draft reader (`draft_reader_a`) gave no answer and is not waited for | Two readers on two families answered and agreed on every point taken. A second read of the corrected sheets goes to one reader who answered and one fresh reader | Round 8 preparation |
| 2026-11-20 | The master return crane travels 3.5 m at 0.50 m per second at most (was 2.4 m at 0.34) | The opening position moved 25 degrees round the nose, and the return has to cut in on a view that differs from the ignition frame and from the opening. The start and the stop stay eased over 1.3 s. C5 judges it in round 8 | `src/director/shots.ts` |
| 2026-11-20 | The `grazing` helper takes a side offset and a level flag that rolls the head so the rows of the mesh run level in the tall frame | Without it the cells ran on a slant in the tall detail frame and read as a tilted camera | `src/director/shots.ts`, `Shot.roll` |
| 2026-11-20 | Addendum 001 (`kit/addenda/001-phase-2-gate-and-updates.md`, main b1f81e4) is applied from this point. No more blockout critic rounds are run. The Phase 2 gate is C5 blockout at `quality.passScore` or more with no severe or major issue, and C8 blockout at `quality.blockoutCompositionPass` (7) or more with no severe issue. Round 7 meets both: C5 10 with no issue, C8 7 with two major and three minor issues and no severe one. The round 8 pack is not rendered | The kit owner's addendum beats `kit/07-QUALITY-BAR.md` and `kit/08-BUILD-ORDER.md` on the Phase 2 gate. Composition is settled with light in Phase 3, where C8 still needs `quality.passScore` with no severe or major issue | `kit/addenda/001-phase-2-gate-and-updates.md`, Phases table |
| 2026-11-20 | The film keeps the round 8 camera draft (third draft, dev/shots-r8) and not the round 7 cameras | The round 7 cameras carry two major issues the critic named: the tall ignition cuts the vehicle at the left border, and the master wheel is too tight and heavy on the right. The round 8 draft answers both and every minor issue of rounds 6 and 7 except the two listed as still open in `cut/SHOTS.md`. Two draft readers on two model families read it twice. Known cost: no critic has judged the round 8 cameras. The C5 10 of round 7 was given on the round 7 moves. The changed moves are measured against the rig limits and the loop test instead, and C5 and C8 judge them again in Phases 3 and 4 | `src/director/shots.ts`, `cut/SHOTS.md` section "Carried into Phase 3" |
| 2026-11-20 | Third draft of the round 8 cameras. Master wheel: raised jib 3.4 m out, 54 to 64 degrees off the long axis, lens 1.50 to 1.38 m high looking 18 degrees down, whole wheel with arch lip, contact patch and deck in frame, hub at 35 percent across, 0.61 m of path at 0.18 m per second. Master and tall lamp: the aim leans toward the junction of the running light at the middle of the push. Master lamp starts with the lamp in the middle of the frame. Master detail from 0.85 m with the aft end of the grille inside the frame for the whole pass, 0.10 m at 0.04 m per second. Master paint aim 0.16 to 0.28 m along the wing. Tall paint from higher and further inboard, 0.07 m of travel | Second read by two draft readers. Both chose the whole rim standing on the deck over a frame that cuts the wheel below the hub, and both faulted a top border lying between the rim and the tire crown. No tighter 16:9 frame clears the rim, the crown and the arch lip, so the frame holds the whole wheel, and the round 7 critic asked for a wider frame with a downward angle onto the tire shoulder. Seen from above the wing line the running light stays outside the left border and the mirror outside the top. The other changes remove a trim sliver, a vertex on a border, a plate tip on a border and lines ending in corners | `src/director/shots.ts`, `cut/SHOTS.md` |
| 2026-11-20 | The tall opening and return are left as they are and carried into Phase 3 | The tall frame limits the vehicle to about 70 percent of the width. Two draft readers call the lower band dead in gray. Reflections, lit signs and rain decide that in Phase 3, and the dolly moves closer if they do not | `cut/SHOTS.md` section "Carried into Phase 3" |
| 2026-11-20 | Thread updates follow addendum 001 from here: an update after every critic round, at every phase gate and when a phase starts, with the phase and round, every score, the top issue, what changes next, and images. Phase 2 images are the contact sheets. From Phase 3 they are the hero frame, the macro frame and the two judged frames that changed most since the last update. The earlier standing rule stays: a picture status also goes out when a numbered step of the phase is finished. Updates are shown inline with the gallery tool, the Builder posts and keeps working | Addendum 001 and the owner's earlier messages in the thread | every round and gate |
| 2026-11-20 | The round 6 C5 answer of 10 is logged as given and is not carried over | The lamp, detail and opening moves are rebuilt, so C5 judges them in round 7 | `scorecards/round-006/` |

## Config changes

| Date | Key | From | To | Why |
| --- | --- | --- | --- | --- |
| 2026-11-19 | `signage.invented` | QUIET HOURS CLUB | SHUTTER HUSH CLUB | A web search found an existing business with the first name |
| 2026-11-19 | `signage.invented` | NINTH CLOUD HOTEL | VAPOR SILL HOTEL | A web search found an existing business with the first name |
| 2026-11-19 | `signage.invented` | SILVERFIN SUSHI | BRINESCALE SUSHI | A web search found an existing business with the first name |
| 2026-11-20 | `quality.blockoutCompositionPass` | not present | 7 | Added by the kit owner with addendum 001 (main b1f81e4). The Builder added the key to the config type and the required key list in `src/config.ts` |

## Rounds

| Round | Phase | Gate | C1 render against control | C2 | C3 | C4 | C5 | C6 | C7 | C8 | Top issue | What changed next |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | 2 | blockout | n/a | n/a | n/a | n/a | 6 | n/a | n/a | 5 | C8 severe: the paint beat is a bare hood curve with no line and no background | Every shot reframed, crane return, tall shots set up again, cut captions |
| 2 | 2 | blockout | n/a | n/a | n/a | n/a | 7 | n/a | n/a | 6 | Both: the wheel beat is a dark low view of the front corner, not the wheel | Wheel at 50 mm and hub height, paint over the wing crease, tall wides and tall rear shot set oblique, slower crane, sun moved to the lit side |
| 3 | 2 | blockout | n/a | n/a | n/a | n/a | 10 | n/a | n/a | 6 | C8 major: the paint beat hardly moves over a blank panel, the wheel shot cuts off the contact patch, the detail beat is not a close pass | Paint as a grazing glide across the wing with a horizon, wheel whole on a 14 degree arc, detail as a forward track along the covers, tall lamp on a projector lens, return opens on the whole car from 1.25 m, tall wides further back, paint anchor moved forward, new wheel mounted |
| 4 | 2 | blockout | n/a | n/a | n/a | n/a | 9 | n/a | n/a | 5 | C8 severe: the paint frame is mostly background, the detail pass misses the fine mesh, the wheel shot is not a macro | Plateau rung: lens and camera height changed on every insert. Paint from above at 100 mm, wheel at 85 mm with a boom down, detail over an enlarged hex grille at 85 mm, lamp holding the whole fork, longer tall arrival dolly, lower return start |
| 5 | 2 | blockout | n/a | n/a | n/a | n/a | 8 | n/a | n/a | 8 | C8 major: the paint macro shows no panel landmark over the glide, and the tall paint crease sits low and flattens | Paint glide carried past a panel edge with an oblique tall path, tall ignition closer and further round, tall wake settles tighter, push added to the lamp slide, wheel boom holds on the arch then slows, longer detail ease-in, shorter stop at the loop seam |
| 6 | 2 | blockout | n/a | n/a | n/a | n/a | 10 | n/a | n/a | 7 | C8 major: the lamp beat never goes macro or into the lens, and the opening push holds one angle with no parallax over an empty near deck | Lamp as a dolly push into one projector lens, opening track laid diagonally across the nose with a near deck object, detail pass at a grazing angle with the panel edge in frame, vent slot in the wide paint frame from the cut, wide ignition tilted down for the puddle, tall opening closer, caliper clocked clear of the spokes, margin at the tall return cut |
| 7 | 2 | blockout | n/a | n/a | n/a | n/a | 10 | n/a | n/a | 7 | C8 major: the tall ignition frame cuts the front wheel and mirror at the left border, and the wide wheel macro is too tight and heavy on the right with no view onto the tread | Tall ignition holds the whole vehicle with margins, wide wheel further back and turned toward the tread, wide lamp stops with both projectors clear, tall detail lined up with the long axis of the grille and a longer pass, opening with room in front of the nose and the wheel stop clear of the corner. Draft sheets go to three development agents before the pack |

## Plateau log

| Critic | Rounds without gain | Rung tried | Result |
| --- | --- | --- | --- |
| C8 | 3 (rounds 2, 3, 4: 6, 6, 5 after 5) | Composition and lighting design, rung 1: change the lens and the camera height | Round 5: C8 8, up from 5, no severe issue. Plateau broken. The count starts again |
| C8 | 2 (rounds 6 and 7: 7, 7 after 8) | none yet. The rule applies after 3 rounds without gain. The next rung is the second of the composition row: move the key and rim sources | Rounds 6 and 7 answered in the camera data. Each round the earlier issues cleared and the reviewer named other shots |
| C8 | closed | none | Addendum 001 ended the blockout rounds after round 7. The count starts again with the first C8 round of Phase 3 |

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
| 2026-11-19 | the commit titled "Detail shot on the rebuilt engine bay" | pushed to main. Exposure test on every frame, paint slide, vehicle B through the bay rebuild, split packs and film parts tools |
| 2026-11-19 | the commit titled "Round 2 scorecards and the round 3 shot plan" | pushed to main. Round 2 scorecards, new wheel, paint, tall and crane shots, haze, surface water, vehicle B pass 3 and pass 4 through the side |
| 2026-11-19 | the commit titled "Round 3 scorecards and the round 4 shot plan" | pushed to main. Round 3 scorecards, new paint, wheel, lamp, detail and return shots in both formats, headlamp haze cones, vehicle B pass 5 rear with the moved paint anchor, the five spoke wheel |
| 2026-11-19 | the commits titled "Round 4 scorecards and the round 5 shot plan" | pushed to main. Round 4 scorecards, every insert shot again as a macro in both formats, the hex grille anchor, vehicle B grille duct and lamp fixes, wheel pass, world poles and insert lighting, headlamp haze, the status rule |
| 2026-11-19 | the commit titled "Round 6 shot plan" | pushed to main. Round 5 scorecards, the inline status tool, the round 6 cameras, vehicle B final-camera pass, wheel pass with the blockout triangle cut (380,930), world divider and pole, rivulet and drips for the round 5 cameras |
| 2026-11-19 | 75752d2 | pushed to main. Merges of the wheel triangle cut, the world pole, the vehicle B vent slot (388,566 in the blockout) and the rivulet and drips for the round 6 cameras |
| 2026-11-20 | the commit titled "Round 6 scorecards and the round 7 shot plan" | pushed to main. Round 6 scorecards, the round 7 cameras, `cut/SHOTS.md` |
| 2026-11-20 | c5e3fff, 61bf9e1, 458a48c, 7769691, a1ccf74, 22fbd5e | pushed to main. Tall return margin, opening aim, merges of the world stop and drain, vehicle B projector housings and bay wall, grille cell water, caliper clocking. 22fbd5e is the round 7 build |
| 2026-11-20 | the commit titled "Round 7 scorecards" | pushed to main. Round 7 scorecards |

## Session log

Newest first. One entry per working session: what was done, what was measured, what is next.

### 2026-11-20, session 12

- Done: round 7 cameras finished (opening at 40 degrees with the billboard in frame, tall return with the whole car inside the frame), merged the wheel stop, the projector housings, the bay wall, the grille cell water and the caliper clocking, round 7 pack rendered on build 2a02be571c6e8d84 and judged: C5 10 with no issue, C8 7 with two major issues (tall ignition cut at the left border, wide wheel too tight and heavy on the right) and three minor. Scorecards written. Status posted inline.
- Measured: 168 tests pass. Blockout vehicle 398,880 triangles, full 1,394,328. The auditor scores vehicle B lamp macro 8, detail 8, paint 8, opening 7, rear 7.
- Next: answer the round 7 notes in the camera data, read the drafts with three development agents, round 8 pack with fresh reviewers. If C8 does not gain in round 8 the plateau rule applies and the gray-box key and rim sources move.

### 2026-11-20, session 11

- Done: critic round 6 on the gray box (build 6df3fd5201954b77): C5 10 with no issue, C8 7 with two major issues (the lamp beat never goes macro, the opening push has no parallax and an empty near deck) and six minor. Scorecards written. Status posted inline. Vehicle D stopped. Every round 6 note answered in the camera data from fixed-pose probes in both formats, and `cut/SHOTS.md` updated in the same commit.
- Measured: slider peaks 0.034 to 0.057 m per second, jib 0.18, dolly 0.21 to 0.50 (the lamp push is the fastest), crane 0.26 to 0.34. Lens clearance 0.44 m at the end of the wide lamp push, 0.57 m tall, 0.34 m over the bay on the detail pass, 0.20 m on the wide dolly.
- Next: the world owner places the near deck object and checks every wide frame at the new angles, the wheel owner clocks the caliper clear of the spokes, the surface, light and vehicle owners check their work at the new cameras. Then the round 7 pack with fresh C5 and C8 reviewers, then the Phase 2 gate.

### 2026-11-19, session 10

- Done: critic round 5 on the gray box: C5 8 with four minor issues, C8 8 with one major (the paint macro showed no landmark) and two minor. Picture statuses are now shown inline in the thread. Merged vehicle B (final-camera grille, lamp, tail, diffuser, deck), the wheel pass with a blockout triangle cut on the unseen wheel, the world divider and pole fix and the surface placement. Every round 5 note answered in the camera data from fixed-pose probes, and `cut/SHOTS.md` updated in the same commit.
- Measured: 163 tests pass. Blockout vehicle 380,930 triangles. Slider peaks 0.034 to 0.127 m per second, jib 0.18, dolly 0.21 to 0.48, crane 0.38 to 0.46. Tall push 2.95 m of track.
- Next: the surface owner places the rivulet and the drips for the round 6 cameras, then the round 6 pack with fresh C5 and C8 reviewers, then the Phase 2 gate.

### 2026-11-19, session 9

- Done: critic round 4 on the gray box: C5 9, C8 5 with four severe issues. Third round without a C8 gain, so the plateau rule applied and the first C8 rung was taken: the lens and the camera height changed on every insert. Each insert was designed again from fixed-pose probes in both formats, in three drafts, with two informal reviews in between. The detail anchor moved to an enlarged hex grille with a flush duct. Merged vehicle B (grille duct, running guide and bezel fixes), the wheel pass, the world pass (poles clear of the car, the tall tower past the border, insert lighting, a grazing light on the grille) and the headlamp haze pass. `cut/SHOTS.md` rewritten for the new shots. First picture status posted, and the status rule written into the decisions.
- Measured: 158 tests pass. Lens clearance on 44 check frames: 0.15 m at the closest (the wheel jib at 19.97 s), 0.20 m on the wides. Slider peaks 0.038 to 0.123 m per second, jib 0.19, dolly 0.42 to 0.49, crane 0.45 to 0.49.
- Next: the round 5 pack with fresh C5 and C8 reviewers. Then the Phase 2 gate. The surface owner places the rivulet and the drips again for the final cameras.

### 2026-11-19, session 8

- Done: critic round 3 on the gray box: C5 10, C8 6 with six major issues (paint, tall paint, wheel, tall lamp, detail, crane opening). Each faulted shot was redesigned with fixed-pose probes in both formats. The paint anchor moved forward to the outer wing face so the paint camera holds it without the screen. Draft sheets went twice to two development agents for comment and the shots were set again after each pass. Lens clearance measured on every frame of the new shots: 0.20 m at the closest, the wide dolly above the deck. Merged the headlamp haze cones, vehicle B with the new anchor and the five spoke wheel. 150 unit tests pass.
- Seen at full detail on the world branch (not merged yet): frame 195 body reads black with sign reflections, nose haze still too broad. Frame 360 was tuned for the old paint camera and has to be set again for the new one.
- Next: the round 4 pack with fresh C5 and C8 reviewers on other families. Then the Phase 2 gate. The world, surface and wheel owners re-aim their work at the new insert cameras.

### 2026-11-19, session 7

- Done: the engine bay was rebuilt from the factory photograph and the detail shot copies that photograph. Critic round 2 on the gray box: C5 7, C8 6. Answered with a 50 mm wheel shot at hub height, a paint glide over the left wing crease, tall wides at 30 degrees off the nose, a tall rear shot off the centerline, a crane return spread over 36.3 to 44.0 s and a gray-box sun on the side the inserts are shot on. Round 3 pack rendered (build 2ce7d31f00d145ca) and sent to two fresh reviewers on two other families. Merged headlamp haze, surface water, the post curve with a lifted toe and a matched shoulder (no channel reaches 255 on the seven look frames), and vehicle B through pass 5 front and side. 145 unit tests pass.
- Measured: the auditor scores vehicle B front three-quarter 6, side 6, rear three-quarter 6, wheel 5, lamp 7, bay 7 against a bar of 8. A Phase 2 pack takes 30 to 50 minutes on two cores.
- Seen at full detail: lighting restaged by the world owner makes the body read but overshoots to pale silver. It is being pulled back so the black paint is described by reflections of sign shapes, not by fill. A review frame at 8.00 s showed a black square: one sample carries a value near 4.7 million that overflows the half-float bloom buffer. The post owner is finding the source and adding a count of non-finite pixels that a gate can read.
- Next: round 3 answers, more rounds until C5 and C8 hold at 9 with no severe or major issue, then the Phase 2 gate. Phase 3 work continues behind the detail switch: lighting, bead shading, the wheel, the body form.

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
