# 00 · Read me first

Read `AGENTS.md` at the repo root before this file.

## Reading order

| File | What it settles |
| --- | --- |
| `config/showcase.json` | Every number |
| `kit/01-FILM.md` | What the video is, beat by beat |
| `kit/02-VEHICLE.md` | What the vehicle is. Written by Brandon |
| `kit/03-WORLD.md` | The rooftop, the city, the weather, the light sources |
| `kit/04-LOOK.md` | Rendering, materials, water, lens, grade |
| `kit/05-ARCHITECTURE.md` | Code structure, determinism, modes, capture, export, the vehicle contract |
| `kit/06-REFERENCE.md` | Reference first, key frames, third-party assets |
| `kit/07-QUALITY-BAR.md` | Gates, critics, the pass bar, the plateau rule |
| `kit/08-BUILD-ORDER.md` | The phases and what ends each one |
| `kit/09-QA-GAUNTLET.md` | The final acceptance list |
| `kit/10-KICKOFF.md` | For Brandon. Not instructions for the Builder |
| `kit/PROGRESS.md` | The Builder's memory |
| `kit/addenda/` | Numbered changes made after the first build |

## When files disagree

| Topic | The file that wins |
| --- | --- |
| Any number | `config/showcase.json` |
| What the vehicle is | `kit/02-VEHICLE.md` |
| Whether something passes | `kit/07-QUALITY-BAR.md` |
| Code structure and determinism | `kit/05-ARCHITECTURE.md` |
| How a surface, light or lens looks | `kit/04-LOOK.md`, then `kit/03-WORLD.md` |
| What happens on screen and when | `kit/01-FILM.md` |

- An addendum beats every file above on its own topic. A higher number beats a lower one.
- If `kit/02-VEHICLE.md` names a paint, add it to `paint.candidates` if it is not there and set `paint.locked` to it.
- If `kit/02-VEHICLE.md` defines checks, they run as `kit/07-QUALITY-BAR.md` describes.
- If a conflict is still open, pick the reading that gives the more believable picture and log the choice.

## Working protocol

1. Read `kit/PROGRESS.md`, then every file in `kit/addenda/`.
2. Find the current phase in `kit/08-BUILD-ORDER.md`.
3. Re-read that phase's "Read first" files from disk.
4. Do the steps. Verify the gate with evidence, not with a feeling.
5. Log, commit, push.
6. Go to the next phase without waiting.

## Vocabulary

| Word | Meaning |
| --- | --- |
| Frame | One output image of the film. Index 0 is the first |
| Beat | A named section of the film from `beats` in the config |
| Tier | A quality level from `tiers` in the config |
| Sample | One jittered sub-render. A frame is the average of its samples |
| Still | A single frame rendered for review |
| Judged frame | A still on the fixed list the critics score |
| Hero frame | The frame at `film.heroFrameSeconds` |
| Macro frame | The frame at `film.macroFrameSeconds` |
| Key frame | A generated image used as a look target. Never used in the film |
| Reference | A real photograph with written observations |
| Control | A real photograph placed in the blind test |
| Gate | A check a script can run and that must be green |
| Critic | A fresh agent that scores files against a rubric |
| Round | One pass of build, gate, pack, critics, fixes |
| Harness | The scripts in `tools/` that render frames in a headless browser |
| Export | The in-browser mode that renders and encodes the master on a GPU |
