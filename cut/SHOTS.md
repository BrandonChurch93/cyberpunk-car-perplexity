# Shot list

One shot per beat, in both formats. Beat times come from `beats` in the config and are quoted here only so the page can be read on its own. The camera code reads the config, not this file.

## Conventions

- World: meters, Y up. The vehicle rests on y = 0 at the origin and faces +Z. Its left side is +X.
- The bay grid of the deck is turned 12 degrees against the vehicle, so the vehicle sits across the lines.
- The large billboard is behind the vehicle on the -Z side, a little toward +X, so it sits right of the car in the opening frame and reflects along the upper body surfaces when the camera looks toward the rear.
- The single red sign is on the same side as the billboard. The stair core is on the +X side near the -Z parapet.
- Focal lengths come only from `lens.focalLengthsMm`. A focal length gives the field of view across the long side of a 36 mm gate. In `formats.master` the long side is horizontal. In `formats.vertical` the camera is turned on its side, so the long side is vertical.
- The lens is anamorphic in character: oval bokeh and a restrained streak. The squeeze does not change the field of view figures above.
- Stop: T2 on the wide shots, T2.8 on the 85 mm shots, T4 on the 100 mm macro shots. The aperture is sampled, so depth of field follows from these.
- Camera positions name the lens entrance pupil. Heights are above the deck.
- Rig limits come from `reference/board/13-camera-moves-on-vehicles.md`: slider travel up to 1 m at up to 0.13 m per second, dolly up to 3 m of track at 0.2 to 0.6 m per second, crane arm starts and stops eased over at least 1 second, pan and tilt 2 to 15 degrees per second.
- Easing: a smooth S curve. Each end of a move takes 15 to 25 percent of the move, and never less than 1 second on the dolly and the crane.
- Operator motion sits on every shot: seeded, periodic over the film, at most 0.12 degrees of rotation and 2 mm of travel on the wide shots, a quarter of that on the macro shots. Frequencies 0.2 to 1.5 Hz. It never reads as shake.
- Cuts happen only at beat boundaries. `arrival` into `wake` is one continuous move with no cut. `return` ends on the opening frame, so the loop has no cut either.
- Rain on the front element: none in this cut.
- The `detail` anchor is the exposed engine bay under the rear deck: carbon weave bracing and hexagonal mesh.

## Timeline of events

| Seconds | Event |
| --- | --- |
| 0.0 | Poster frame. Vehicle dark. Camera at rest |
| 0.0 to 2.0 | The billboard wash sweeps across the deck toward the vehicle. A gust lifts the backlit rain. The camera eases into its push |
| 4.6 | Lamp stage 1: the thin Y-shaped running lights come up |
| 5.6 | Lamp stage 2: the main beams start. Beams show in the rain |
| 6.5 | Hero frame. Running lights full, main beams about half way up |
| 7.0 | Lamp stage 3: main beams full. The deck in front of the vehicle lights up |
| 7.5 | The push settles |
| 12.0 | Macro frame. The rivulet has just broken loose and is running |
| 16.2, 17.9, 19.1 | Drips leave the wheel arch lip |
| 30.0 | The engine fires. Tail lamps flare. One short shake of the body |
| 30.0 to 31.0 | Idle settles. Beads shake loose from the rear bodywork |
| 30.5 to 33.0 | Heat shimmer builds at the exhaust outlets. Steam starts where rain meets hot metal |
| 30.2 onward | Exhaust pulses ripple the nearest puddle |
| 37.0 | Engine off |
| 38.0 to 40.0 | Lamps go out in reverse order: main beams, then running lights with a last faint glow |
| 37.5 to 43.5 | Pull back |
| 43.5 to 45.0 | Settled on the opening composition. Steam and shimmer are gone by 44.0 |

## Master, `formats.master`

| Beat | Lens | Rig | Move | Start framing | End framing | Focus plan | In frame |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `arrival` 0 to 4 | 24 mm | Dolly on straight track, low mode, lens 0.20 m high | Push toward the vehicle along a line 20 degrees off its nose on the +X side. Starts from rest at 7.5 m from the vehicle center and reaches 6.6 m at the cut point, still moving at about 0.3 m per second | Wide. Vehicle centered, 33 percent of frame width, nose to frame left, left flank visible. Horizon at 42 percent of frame height. Long puddle in the foreground mirrors the vehicle and the city | Vehicle 38 percent of frame width, same angle | Focus on the nose at 5 m and held on it as the distance closes. Foreground puddle edge soft. City soft but readable | Dark vehicle, wet deck, bay lines, a drain grate, an expansion joint, parapet and rail, one light pole at frame left, stair core doorway at far right, towers, billboard right of the vehicle, the red sign, rain where backlit, haze layers, cloud base |
| `wake` 4 to 9 | 24 mm | Same dolly, same track | The push continues without a cut, slows from 6.0 s and settles at 7.5 s, 5.3 m from the vehicle center. Holds to 9.0 s | As the end of `arrival` | Hero framing. Vehicle 45 percent of frame width, front three-quarter, nose left. Both beams cross the frame toward the lower left | Focus stays on the nose and lamp. At 7.5 s it rests on the near headlamp | Everything in `arrival`, plus the running lights, the main beams as cones in rain and haze, lit rain in the beams, the deck brightening in front of the nose, lamp reflections in the puddle |
| `paint` 9 to 15 | 100 mm | Slider, 1 m rail, parallel to the vehicle's long axis, above the left front wing | Travels 0.55 m toward the rear at about 0.09 m per second. Lens 0.12 m above the panel, looking 35 degrees off the rail toward the rear and inward, 12 degrees down | Beads on the front wing fill the frame. The crease line enters from lower left. Billboard reflection is a stretched bright shape across the upper third | Door shoulder. The rivulet track crosses the lower half from upper right to lower left. Red sign reflection slides in at the right edge | Focus at 0.45 m on the beads nearest the crease. From 11.4 s it is pulled 6 cm deeper to meet the rivulet, and it rests there at 12.0 s. Depth of field a few centimeters. Background is oval bokeh | Clearcoat, flake where the billboard reflection lies, beads of mixed size, the rivulet and its trail, one body crease, a panel gap at the door edge, sign reflections, city bokeh |
| `wheel` 15 to 20 | 85 mm | Slider on low legs beside the front left wheel, lens at hub height, 1.7 m from the wheel face | Slides 0.40 m from ahead of the wheel toward the hub at 0.08 m per second, with a 4 degree pan that keeps the hub in the middle third | Tire shoulder, tread and contact patch at frame left. Rim edge and three spokes. Wet deck across the lower quarter | Hub centered. Caliper at the right of the disc. Arch lip across the top with a drip in the air. Rim mirrored in the deck | Focus on the caliper face at 1.75 m. At 17.6 s it is pulled 12 cm nearer to the arch lip for the drip at 17.9 s, then back to the caliper by 19.0 s | Forged spokes, disc with its drilled face, plain caliper, sidewall relief, tread with water in the grooves, contact patch, arch lip, drips, wing above, rain in the background, red reflection on the deck |
| `lamp` 20 to 25 | 100 mm | Slider aimed at the left headlamp, lens 0.62 m high, on the lamp's axis but 15 degrees to its outboard side | Push in 0.30 m, from 0.90 m to 0.60 m from the outer lens, at 0.06 m per second | The whole lamp and the Y of the running light fill two thirds of the frame. Wing edge above, bumper edge below | Inside the lamp. Projector modules right of center. The junction of the Y at lower center | Starts on the beads on the outer lens. From 21.5 s to 23.5 s it is pulled 5 cm through the lens to the projector modules | Outer lens with beads and short rivulets, running light guide, projector modules, bezels, ribbed light guides, halation, wet paint around the lamp, bright rain in the lamp's light |
| `detail` 25 to 29 | 85 mm | Crane arm with a remote head over the rear deck | The head travels 0.80 m from above the left rear haunch toward the centerline at 0.2 m per second, 0.38 m above the deck surface, looking 32 degrees down and toward the cabin. A 3 degree tilt keeps the mesh in frame | Carbon bracing runs diagonally from lower left. The mesh grille takes the lower right | The center of the bay. The cross brace over the engine covers, mesh at the bottom edge, rear window edge at the top | Focus at 0.75 m on the weave, held on the plane of the bracing for the whole pass. No pull | Carbon weave under clear resin, hexagonal mesh with drops in its cells, engine covers, cross brace, wet edges, the raking billboard light, a red glint, parapet and city as bokeh at the top |
| `ignition` 29 to 36 | 35 mm | Dolly on curved track behind the vehicle on its left, lens 0.25 m high | Arcs 1.2 m around the rear corner, from 38 degrees off the tail to 26 degrees off it, while closing from 5.2 m to 4.7 m from the tail center. At rest for the first 0.8 s so the start reads | Rear three-quarter. Vehicle 55 percent of frame width, tail toward frame right. Exhaust outlets at 58 percent across and 45 percent up. Puddle in the lower right | A little more behind the vehicle. Both tail lamps visible. Steam rising through the upper middle | Focus on the exhaust outlets at 4.9 m, held on them through the arc | Rear haunches, tail lamps, exhaust outlets with heat tint, diffuser, rear wheel, shimmer, steam, beads shaking loose, the puddle with pulse ripples, red sheen on the deck, the cool sign group and towers beyond the parapet |
| `return` 36 to 45 | 24 mm | The dolly and track of `arrival` | Starts at rest on the hero position, 5.3 m from the vehicle center. Pulls back from 37.5 s to 43.5 s to 7.5 m. Holds to 45.0 s | Hero framing with lamps on and the engine running | The opening frame exactly: every camera value equals its value at 0 | Focus on the nose, held as the distance opens, and equal to the opening focus distance from 43.5 s | Everything in `wake`, then the lamps going out, the last glow of the running lights, a thin wisp of steam behind the vehicle that is gone by 44.0 s |

## Vertical, `formats.vertical`

Same beats, same events, same frame count. Each shot is set up again for the tall frame. The subject stays between 30 and 72 percent of frame height, clear of the top and bottom bands.

| Beat | Lens | Rig | Move | Start framing | End framing | Focus plan | In frame |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `arrival` 0 to 4 | 24 mm | Dolly on straight track, low mode, lens 0.20 m high | Push along a line 10 degrees off the nose on the +X side, from 8.6 m to 7.7 m | Vehicle nearly head-on, 56 percent of frame width, centered at 60 percent down the frame. Towers stack above it to the top. The puddle reflection runs below it to 78 percent down | Vehicle 62 percent of frame width | Focus on the nose, held | Dark vehicle, deck and puddle below, parapet, the billboard above and right of the roof line, the red sign, towers to the top of frame, rain where backlit, cloud base |
| `wake` 4 to 9 | 24 mm | Same dolly | Continues without a cut and settles at 7.5 s, 6.2 m out | As the end of `arrival` | Vehicle 76 percent of frame width, lamps at 62 percent down. Beams reach the lower corners | Focus on the nose, resting on the near headlamp at 7.5 s | As the master, with more tower height above and more reflection below |
| `paint` 9 to 15 | 100 mm | Slider above the left door shoulder, rail parallel to the vehicle | Travels 0.45 m toward the rear at 0.075 m per second, looking down the side of the door at 40 degrees below level | Shoulder crease across the upper third. Beads above it, the door face falling away below | The rivulet runs down the middle of the frame from the crease to the lower third | Focus on the crease at 0.45 m, then pulled to the head of the rivulet from 11.4 s | Clearcoat, flake, beads, the rivulet and its trail, the crease, sign reflections bending over the shoulder |
| `wheel` 15 to 20 | 50 mm | Slider stood upright as a short lift beside the front left wheel, 1.5 m from the wheel face | Rises 0.30 m at 0.06 m per second, from 0.22 m to 0.52 m high | Contact patch and its mirror image in the lower middle. Lower half of the rim | Whole wheel in the middle band. Arch lip at 30 percent down with a drip in the air | Focus on the tread at the contact patch, pulled to the caliper by 17.0 s, to the arch lip for the drip at 17.9 s, then back | Tread, contact patch, sidewall, rim, disc, caliper, arch lip, drips, the wing above, wet deck below |
| `lamp` 20 to 25 | 100 mm | Slider aimed at the left headlamp | Push in 0.30 m, from 0.95 m to 0.65 m | The Y of the running light runs corner to corner through the middle band. The lamp sits at 50 percent down | Projector modules at center. The junction of the Y at 62 percent down | Outer lens beads first, pulled through to the modules from 21.5 s to 23.5 s | As the master |
| `detail` 25 to 29 | 85 mm | Crane arm with a remote head over the rear deck | The head travels 0.70 m forward along the centerline from the tail toward the cabin at 0.175 m per second, 0.40 m above the deck surface, looking 38 degrees down | Mesh grille across the lower middle. Bracing converges upward | Cross brace at center. Rear window edge at 30 percent down | Focus on the weave at 0.80 m, held | As the master, with the bracing running up the frame |
| `ignition` 29 to 36 | 35 mm | Dolly on curved track behind the vehicle on its left, lens 0.25 m high | Arcs 0.9 m, from 24 degrees off the tail to 14 degrees off it, closing from 6.4 m to 5.9 m | Tail fills 80 percent of frame width at 58 percent down. Steam has room to rise through the upper half. Puddle below | Nearly square to the tail. Both lamps and both outlets in the middle band | Focus on the exhaust outlets, held | As the master, with more sky above for steam and more deck below for the red sheen |
| `return` 36 to 45 | 24 mm | The dolly and track of the vertical `arrival` | Starts at rest 6.2 m out. Pulls back from 37.5 s to 43.5 s to 8.6 m. Holds to 45.0 s | The vertical hero framing | The vertical opening frame exactly | Focus on the nose, equal to the opening focus distance from 43.5 s | As the master |

## Checks this list has to pass

- No camera position is inside geometry or closer than 0.10 m to a surface. The nearest pass is the `paint` slider at 0.12 m.
- No frame shows the edge of the world. The parapet and the towers close every sight line used here.
- The camera values at 45.0 s equal those at 0.0 s in both formats, and the speed at both ends is zero.
- Every lens is in `lens.focalLengthsMm`.
- Framing numbers are targets for the blockout. Where the blockout critics ask for a change, the change is made in the camera data and this file is updated in the same commit.
