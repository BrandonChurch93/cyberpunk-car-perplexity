# Independent vehicle audit

Status: the one-time comparison is closed and A is kept. Step 0 is pinned to the first `dev/vehicle-k` push, `5d8edb0`, and moves no surface. The audit tools do not change the vehicle or the film build.

Prepare an isolated detached worktree of the exact target commit and copy in the auditor's versions of `tools/vehicle/fairness.ts`, `tools/vehicle/stills.ts` and `tools/vehicle/audit/`. Run with dependencies installed and one renderer per VM:

```sh
npx tsx tools/vehicle/stills.ts --studio true --audit true --frames 195,1060,0 --diags beauty,clay,zebra --format 16x9 --detail full --tier review --budget 0
npx tsx tools/vehicle/fairness.ts --label k-step0 --frames 195,1060,0 --formats master --detail full --sub 2
npx tsx tools/vehicle/audit/pack.ts --label k-step0
```

Use `--backfaces glass` only when the named mesh requires a diagnostic-only backface guard. Beauty restores the original materials; clay and zebra cover all vehicle meshes. The studio uses the three film camera poses on a neutral deck without film weather, so beauty is not a finish sign-off. The pack contains resized full stills at the critic image limit, native zebra crops, capture provenance, the unchanged approved hero and a labeled four-up. Do not read the native render outputs while the renderer is writing them.

`--sub 2` means a deterministic 2 by 2 grid: four rays per native pixel. The historical `--sub 4` flag still works but means 16 rays per native pixel; do not quote those measurements in this audit. The paint score is p95 of the second difference of the unit normal at 10 mm surface stations along image rows and columns, in inverse square metres; stations near measured creases under 40 mm radius are excluded. Panel names are geometric regions, not part IDs. Check high-tail or ambiguous locations against native zebra and clay, mark thin or unseen regions as insufficient, and do not assign paint p95 to unpainted parts. Native coordinates count from the top left. The table, ripple maps, and provenance are under `out/work/vehicle/fairness/<label>/`.
