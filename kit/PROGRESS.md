# Progress

The Builder's memory. Read this first in every task. Update it before every commit.

## Status

- Current phase: 1 · Reference and key frames
- Current round: none
- Blocked: no
- Last push: c74357a (vehicle file), 2026-11-19

## Phases

| Phase | State | Gate evidence | Commit |
| --- | --- | --- | --- |
| 0 · Ground truth | done | Push c74357a and 97ddecb succeeded. `npm run gate -- --phase 0` on build 33fa88298cbaea4f: G1 PASS (build clean), G2 PASS (29 tests), G3 PASS (5 frames identical across fresh loads and reverse order, frame 195 identical when chunked across 3 page loads), G4 PASS (3 stills match their formats, frameCount 1350). Workspace record, pinned versions and render budget are below | see push log |
| 1 · Reference and key frames | in progress | | |
| 2 · Blockout in motion | not started | | |
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

Filled in Phase 1: size, date vetted, mean vetting score.

## Judged frames

| Frame index | Seconds | Beat | Why this moment | Vertical too |
| --- | --- | --- | --- | --- |

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
| 2026-11-19 | Animation is closed form wherever possible. The running sum is saved as raw Float32 through the harness endpoint | Determinism and resumable chunks | `src/core/`, `tools/lib/` |

## Config changes

| Date | Key | From | To | Why |
| --- | --- | --- | --- | --- |

## Rounds

| Round | Phase | Gate | C1 render against control | C2 | C3 | C4 | C5 | C6 | C7 | C8 | Top issue | What changed next |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |

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

## Session log

Newest first. One entry per working session: what was done, what was measured, what is next.

### 2026-11-19, session 2

- Done: finished Phase 0. Harness commands `still`, `determinism`, `gate`, plus `tools/caps.ts` (writes `config/webgl-caps.json`) and `tools/measure.ts` (timing). Unit tests for config, random, timeline and sampler. Spike stage. Render budget measured. Phase 0 gate green.
- Started Phase 1 in parallel: four board writers, two vehicle researchers, three photo scouts for control candidates, one asset scout. Three key frame directions generated on three image models and sent to three K1 jurors.
- Vehicle research found the full design grant drawings (US D1,119,686 S: top, both sides, front, rear, underside) and no car mesh with a clean license. The car is built from those drawings and photographs.
- Next: finish the board, vet the control pool, choose the key frame direction, write `cut/SHOTS.md`, start `ASSETS.md`.

### 2026-11-19, session 1

- Done: vehicle file filled and pushed. Workspace, WebGL, detached process, agent VM and image limit probes. Versions pinned and installed. Core scaffold written: config, random, sampler, tiers, renderer, accumulator, lens, engine, placeholder resolver, timeline, launch parsing, frame interface, spike stage. Harness library started: build hash, records, server with the sum endpoint, browser driver, image checks.
- Next: finish `still`, `determinism`, `gate` and the caps recorder, write the unit tests, measure seconds per sample and chunk start cost, write the render budget, run G1 to G4, push the Phase 0 gate.
