# 09 · QA gauntlet

Run every item at the end of Phase 5. Record the evidence for each in `kit/PROGRESS.md`. One failed item means the build is not complete.

## The film

| No. | Item | Evidence |
| --- | --- | --- |
| 1 | Frame 0 is a finished picture with no fade in | The still |
| 2 | Every beat in `beats` appears, in order, with the events `kit/01-FILM.md` lists | Contact sheets |
| 3 | The loop seam cannot be found | G6 result and the seam contact sheet |
| 4 | No people, titles, logos or interface in any frame | Contact sheets |
| 5 | Every sign string is from the config and spelled correctly | G11 result and crops of each sign |
| 6 | No real brand, logo or trademark on any sign or prop | Crops, and the search log for `signage.invented` |
| 7 | The vertical version is reframed in every beat, not cropped | One vertical still per beat beside the master still |

## The picture

| No. | Item | Evidence |
| --- | --- | --- |
| 8 | The pass bar holds for C1 to C8, and for any extra critic `kit/02-VEHICLE.md` defines, on the full judged list | Final round `SUMMARY.md` |
| 9 | The confirmation round passed with no changes in between | Confirmation round `SUMMARY.md` and the build hash of both rounds |
| 10 | Every reflection shows the scene, not a stock environment | C3 result and crops |
| 11 | No silhouette shows polygon segments in a judged frame | C4 result and `clay` crops |
| 12 | The stress encode holds up | C7 result |

## The machine

| No. | Item | Evidence |
| --- | --- | --- |
| 13 | G1 to G14 are green | `npm run gate -- --phase 5` output |
| 14 | A clean clone builds and renders frame 0 identically | Hash of frame 0 from a fresh clone against the committed still |
| 15 | `src/` takes frame rate, duration, formats, tiers, beats, thresholds and names only from `src/config.ts` | Search of `src/` for those values, with every hit explained |
| 16 | No `Math.random`, `Date.now` or `performance.now` on any path that affects a pixel | Search output with each remaining use explained |
| 17 | Export proof exists and `ffprobe` accepts the file | `ffprobe` output |
| 18 | `export` mode shows progress and time remaining, and memory stays flat in the memory test `kit/05-ARCHITECTURE.md` defines | Log of memory readings |
| 19 | `npm run build` output works from a subfolder path | A still rendered from `dist/` served under a subfolder |

## The repo

| No. | Item | Evidence |
| --- | --- | --- |
| 20 | `ASSETS.md` lists every third-party file with source and license | G12 result |
| 21 | `reference/BOARD.md`, `reference/keyframes/` and `reference/keyframes/PROMPTS.md` are committed | File list |
| 22 | `cut/SHOTS.md` and `cut/CUES.md` are committed and match the final timings | File list and a check against `beats` |
| 23 | `out/preview.mp4` and `out/stills/` are committed | File list |
| 24 | Every round has a folder in `scorecards/` | File list |
| 25 | `README.md` has the app URL and the export steps, with no em dashes and no model names | The file |
| 26 | Everything is pushed | `git status` and `git log origin/main -1` |
