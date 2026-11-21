# Harness tools

Every command takes `--detail blockout|full`. Without it the tools use `SHOWCASE_DETAIL`, then the build's `stageDetail`. The detail is written into every record, so a record made at one detail never stands in for the other.

## Film

```
npm run film -- --format preview --tier draft --detail blockout --budget 0
```

Renders every frame as a PNG with a record in `out/work/frames/<format>-<tier>-<detail>/`, encodes `out/work/film-<format>-<tier>-<detail>.mp4` and runs G5 on every frame. Exit 75 with a `CONTINUE` line means the chunk budget ran out. Run the same command again to resume. `npm run film -- --help` prints every flag.

### Across machines

A frame is a pure function of its index, so part K of P renders exactly the bytes a single run renders for the same frames. Checked on frames 60 to 79: a single run and two parts unpacked in a third folder gave 20 identical PNG files and a film with the same MD5.

Check out the same commit on every machine. On the machine of part K, for K = 1 to P:

```
npm run film -- --format preview --tier draft --detail blockout --parts P --part K --budget 0 --bundle
```

This writes `out/work/parts/frames-preview-draft-blockout-0-1349-part-K-of-P-NN-of-MM.tar`. Each tar holds frame PNG files, their records and a `bundle.json` naming the format, tier, detail, paint and build, and none is over 95 percent of `repo.maxFileMb`. If the budget runs out first, run the same command again until the bundles are written.

Send every tar as an attachment to the machine that assembles. There:

```
npm run film -- --format preview --tier draft --detail blockout --unbundle <folder or a,b,c.tar> --assemble
```

This unpacks each tar into the frame folder its `bundle.json` names, compares any frame that is already there byte for byte (and stops if one differs), checks each record against the current build, encodes the film and runs G5. To prove two machines agree, render one frame on both, for example the last frame of the part before with `--first` and `--last`, and unpack: the line says `already here and identical`.

Then `npm run keep -- --detail blockout` copies the film to `out/preview.mp4`.

## Packs

```
npm run pack -- --phase 2 --round N [--critic C5,C8] [--tier draft] [--detail blockout] [--split 10] [--budget 0]
```

Writes `out/work/packs/round-NNN/<critic>/` with neutral file names, `brief.txt`, `manifest.json` and `message-01.txt`, `message-02.txt` and so on. Each message file lists at most `--split` files (one per message for C1) in the order to send them: brief and the first files first, the request for the answer with the last. The key is `out/work/packs/keys/round-NNN.json` and records the detail, the tier, the sheet cell format and the build. In Phase 2 the contact sheet cells are rendered in the preview format.

## Scan

```
npm run scan -- [--frames all|a-b,c] [--every N] [--shard i/n] [--width 240] [--format 16x9] [--tier draft] [--jump 0.3]
```

Renders the frames at the width given (the height follows the format) and writes `out/work/scan/scan-<format>-<width>-<tier>[-iofn].json` after every frame, with each frame as a PNG beside it. Per frame it records mean luma, p50, p99 and the non-finite pixel count. A frame is flagged when its mean differs by more than `--jump` from both neighbours inside one beat, or when it has a non-finite pixel. Exit 2 means something is flagged. The reflection cube keeps its tier size at any width; the planar mirror scales with the frame. Run the same command again to continue. Shard i of n takes the i-th contiguous block. Merge with `npm run scan -- --merge out/work/scan` or a comma list of files; the merge refuses scans of another build, size, tier, paint or detail and flags across the shard seams again.

## Farm

```
npm run farm -- --phase P --shard i/n [--review] --budget 0
npm run farm -- --unbundle <folder or a.tar,b.tar>
```

The plan is every judged frame in the wide format at the final tier, the vertical ones in the tall format, and the plain gray and stripe views of each judged frame that has a vehicle anchor crop. With `--review` (Phase 4 only) the plan also holds the review tier cells of every contact sheet, every event run and the phone previews in both formats; a shard renders its final stills first. `--list` prints it with the shard of each still. Still k goes to shard (k mod n) + 1. Each machine renders its share into `out/work/stills/` and writes `out/work/farm/farm-pP-final-iofn-NN-of-MM.tar`, each under the attachment limit. Exit 75 with a `CONTINUE` line means the budget ran out: the same command keeps finished stills and continues the open one from its saved samples. On the assembling machine `--unbundle` puts every still into `out/work/stills/`, compares any still already there byte for byte, refuses another build and lists what the plan still misses. `npm run pack` then reuses those stills and cuts the crops from them.
