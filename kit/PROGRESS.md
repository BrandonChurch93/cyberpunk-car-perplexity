# Progress

The Builder's memory. Read this first in every task. Update it before every commit.

## Status

- Current phase: 0 · Ground truth, steps 9 to 14 in progress
- Current round: none
- Blocked: no
- Last push: c74357a (vehicle file), 2026-11-19

## Phases

| Phase | State | Gate evidence | Commit |
| --- | --- | --- | --- |
| 0 · Ground truth | in progress | | |
| 1 · Reference and key frames | not started | | |
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
- Encoder support: `VideoEncoder` was undefined on about:blank (an insecure context). Retest on http://localhost is pending. TODO fill in.
- Supporting agents: a default spawn shares the Builder's VM (same boot id), so `sandbox.maxRenderProcesses` covers the Builder and every default agent together. A spawn with sandbox isolation gets its own VM: 4 cores, 7.9 GB RAM, 25 GB disk, the same Node, ffmpeg and chromium-1217, and it can clone and push to the repo. The limit applies per VM, so sandbox agents can render in parallel with the Builder. Only the Builder can spawn agents.
- Agent attachments arrive under `/home/user/.perplexity/attachments/<id>/`, at most 10 per message.
- Image limit: landscape and portrait test cards with numbered marks arrive downscaled to a 1430 px long edge. A 1400 px long edge arrives at native size. `critics.maxImageLongEdgePx` stays as it is. Every family tested read 7 px text at 1400 px.
- Agent model families with image input verified: Claude, GPT, GLM, Kimi, Grok. Gemini was spawned for the same probe and had not answered when this was written. One listed id (deepseek) is not available.
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

Chunking strategy:

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

### 2026-11-19, session 1

- Done: vehicle file filled and pushed. Workspace, WebGL, detached process, agent VM and image limit probes. Versions pinned and installed. Core scaffold written: config, random, sampler, tiers, renderer, accumulator, lens, engine, placeholder resolver, timeline, launch parsing, frame interface, spike stage. Harness library started: build hash, records, server with the sum endpoint, browser driver, image checks.
- Next: finish `still`, `determinism`, `gate` and the caps recorder, write the unit tests, measure seconds per sample and chunk start cost, write the render budget, run G1 to G4, push the Phase 0 gate.
