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
