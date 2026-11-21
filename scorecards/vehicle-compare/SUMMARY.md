# Vehicle build comparison, addendum 003

One comparison, 2026-11-20. Every vehicle build that exists, `clay` and `zebra` from the hero camera (frame 195), the rear three quarter (frame 1060) and the wide front (frame 0), with a native `zebra` crop of each. 45 files under neutral names, scored by one fresh C4 (Claude family) that received the C4 section word for word, the return format and the files.

| Name in the pack | Build | Pin | Triangles | C4 |
| --- | --- | --- | --- | --- |
| car-4 | A | `dev/vehicle-a` d418ea9 | 664,778 | 5 |
| car-3 | D | `dev/vehicle-d` 249d6dd | 1,310,489 | 4 |
| car-1 | C | `dev/vehicle-c` adf31a2 | 255,336 | 2 |
| car-2 | B, the film car | `dev/p3` 60e0969 | 1,468,120 | 2 |
| car-5 | B2 | `dev/vehicle-b-onedomain` 76ad60b | 1,480,900 | 2 |

The critic's last line: cleanest surfaces car-4, then car-3, car-1, car-2, car-5 (car-2 and car-5 are effectively the same build).

Kept: A. Its open issues are the work list for the surface passes: paper-thin diffuser blades (severe), a pole in the nose, intakes and lamp surrounds drawn as lines without openings, wheels outside the clay view, the mirror seam at the rear, a mild wobble on the hood.

Diagnostic-only changes made for the stills, no geometry moved: A, C and D render existing glass, liners and outlets double sided in `clay` and `zebra`; A gets a face normal where a stored normal has no direction.
